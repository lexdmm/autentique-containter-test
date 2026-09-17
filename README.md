# autentique-mock

Mock local da API GraphQL da Autentique para desenvolvimento e testes. Ele permite criar PDFs,
simular assinaturas e enviar webhooks sem usar uma conta real da Autentique.

## Início rápido

Requisito: Docker com Docker Compose.

```bash
cp .env.example .env
mkdir -p ~/Downloads/autentique-mock
docker compose up --build -d
curl http://localhost:4100/health
```

Resposta esperada:

```json
{"status":"ok"}
```

O endpoint GraphQL estará em `http://localhost:4100/graphql` e aceitará o token
`fake-local-token`.

Abra `http://localhost:4100/dashboard` para visualizar requests, responses e webhooks em tempo
real, sem login. Por segurança, o Docker expõe esse serviço somente no computador local. Os dados
sensíveis são mascarados antes de aparecerem na tela.

<img width="1726" height="916" alt="image" src="https://github.com/user-attachments/assets/1dfe60a1-88b2-48c8-8a6f-e75ebbb85137" />

## Fluxo básico de teste

### 1. Crie um documento

Coloque um PDF válido chamado `documento.pdf` no diretório atual e execute:

```bash
curl http://localhost:4100/graphql \
  -H 'Authorization: Bearer fake-local-token' \
  -F 'operations={"query":"mutation Create($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) { createDocument(document: $document, signers: $signers, file: $file) { id signatures { public_id email link { short_link } } } }","variables":{"document":{"name":"Documento de teste"},"signers":[{"name":"QA","email":"qa@example.test","action":"SIGN"}],"file":null}}' \
  -F 'map={"0":["variables.file"]}' \
  -F '0=@documento.pdf;type=application/pdf'
```

Guarde o `id` do documento e o `public_id` do signatário retornados.

### 2. Simule a assinatura

Abra o `short_link` retornado no navegador e clique em **Sign document**, ou use:

```bash
curl -X POST http://localhost:4100/simulate/PUBLIC_ID/sign \
  -H 'Content-Type: application/json' \
  -d '{"cpf":"12345678901","email":"qa@example.test"}'
```

Substitua `PUBLIC_ID`. Cada chamada assina somente aquele signatário. O PDF final é criado depois
que todos assinarem e fica em `~/Downloads/autentique-mock/`.

### 3. Consulte o documento

```bash
curl http://localhost:4100/graphql \
  -H 'Authorization: Bearer fake-local-token' \
  -H 'Content-Type: application/json' \
  -d '{"query":"query Document($id: UUID!) { document(id: $id) { id refusable sortable created_at files { original signed } signatures { public_id email signed { created_at } } } }","variables":{"id":"DOCUMENT_ID"}}'
```

Substitua `DOCUMENT_ID`. Antes da última assinatura, `files.signed` será `null`.

## Conectar outra aplicação

Se sua aplicação roda em outro container, configure:

```env
AUTENTIQUE_API_URL=http://host.docker.internal:4100/graphql
AUTENTIQUE_API_TOKEN=fake-local-token
AUTENTIQUE_WEBHOOK_SECRET=local-mock-secret
```

No Linux, o Compose da aplicação consumidora pode precisar de:

```yaml
extra_hosts:
  - 'host.docker.internal:host-gateway'
```

Configure no `.env` deste mock a rota que receberá o webhook:

```env
WEBHOOK_TARGET_URL=http://host.docker.internal:8080/api/webhooks/autentique
```

O mock envia `signature.accepted` em JSON e assina o corpo bruto com HMAC-SHA256 no header
`x-autentique-signature`, seguindo o formato atual da documentação da Autentique.

## Coassinatura da conta da API

A mutation `signDocument` assina o signatário cujo e-mail corresponde a
`AUTENTIQUE_API_USER_EMAIL`:

```bash
curl http://localhost:4100/graphql \
  -H 'Authorization: Bearer fake-local-token' \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation Sign($id: UUID!, $organizationId: Int) { signDocument(id: $id, organization_id: $organizationId) }","variables":{"id":"DOCUMENT_ID","organizationId":null}}'
```

O documento precisa ter um signatário com esse e-mail. A assinatura também envia o webhook
`signature.accepted`.

## Configuração

| Variável | Padrão | Uso |
|---|---|---|
| `AUTENTIQUE_API_TOKEN` | `fake-local-token` | Token Bearer do GraphQL. |
| `AUTENTIQUE_API_USER_EMAIL` | `api-owner@example.test` | Conta assinada por `signDocument`. |
| `WEBHOOK_TARGET_URL` | `http://host.docker.internal:8080/api/webhooks/autentique` | Destino dos webhooks. |
| `WEBHOOK_SECRET` | `local-mock-secret` | Segredo da assinatura HMAC. |
| `MAX_UPLOAD_BYTES` | `10485760` | Limite do PDF, em bytes. |
| `PUBLIC_BASE_URL` | `http://localhost:4100` | Base dos links retornados. |
| `SIMULATE_TIMEOUT` | `false` | `true` deixa as requisições pendentes. |
| `HOST_UID` / `HOST_GID` | `1000` / `1000` | Dono dos PDFs gravados no host. |

Depois de alterar o `.env`, recrie o serviço:

```bash
docker compose up -d --force-recreate
```

## Simular erros

Adicione `X-Simulate-Error` a uma requisição. Valores disponíveis:

- `unauthorized`
- `invalid_phone`
- `must_be_a_file`
- `document_not_found`
- `signature_not_found`
- `document_signed`
- `rate_limit`

Exemplo:

```bash
curl http://localhost:4100/graphql \
  -H 'Authorization: Bearer fake-local-token' \
  -H 'X-Simulate-Error: rate_limit' \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ document(id: \"test\") { id } }"}'
```

## Endpoints

| Método | Caminho | Uso |
|---|---|---|
| `GET` | `/health` | Verifica se o mock está ativo. |
| `GET` | `/dashboard` | Abre o painel de monitoramento no navegador. |
| `GET` | `/dashboard/api/activity` | Lista os eventos recentes do painel. |
| `GET` | `/dashboard/api/stream` | Envia eventos do painel em tempo real via SSE. |
| `POST` | `/graphql` | API GraphQL autenticada. |
| `GET` | `/sign/:publicId` | Página local de assinatura. |
| `POST` | `/simulate/:publicId/sign` | Simula uma assinatura. |
| `GET` | `/files/:documentId/original.pdf` | PDF original. |
| `GET` | `/files/:documentId/signed.pdf` | PDF final ou 404 enquanto incompleto. |

## Testes e logs

```bash
docker compose build autentique-mock
docker compose run --rm autentique-mock npm run typecheck
docker compose run --rm autentique-mock npm test
docker compose logs -f autentique-mock
docker compose down
```

Os contratos e as regras centrais usam TypeScript em modo estrito. A orquestração HTTP e os
arquivos do painel permanecem em JavaScript nesta migração incremental, sem exigir um bundler.

Se o webhook retornar `delivered: false`, confira se a aplicação de destino está ativa e se
`WEBHOOK_TARGET_URL` está correto. Depois de resolver a falha, repita o mesmo `POST /simulate` para
reenviar o evento sem assinar novamente. Se retornar HTTP 401, confira se os dois projetos usam o
mesmo `WEBHOOK_SECRET`.

## Limites conhecidos

- Os dados ficam somente em memória e são apagados ao reiniciar o container.
- Apenas PDFs válidos são aceitos.
- O mock implementa o fluxo principal, não todos os recursos da Autentique.
- Ainda não envia `signature.viewed` nem `document.finished`.

Referência do contrato: [documentação oficial da API Autentique](https://docs.autentique.com.br/api).
