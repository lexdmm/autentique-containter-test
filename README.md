# autentique-mock

Um mock local e independente da API GraphQL da [Autentique](https://www.autentique.com.br). Ele
existe para que o [px-torre-core](https://github.com/lexdmm/px-torre-core) possa ser desenvolvido e
testado contra um fluxo de geração e assinatura de documentos **sem** depender da nuvem real da
Autentique, sem precisar de uma conta de verdade, e sem nenhum risco de enviar um documento real
pra uma pessoa real.

> **Isto não é um ambiente real da Autentique.** A Autentique é um SaaS fechado e pago, sem versão
> self-hosted ou Docker disponível em lugar nenhum — não existe nada pra "instalar" localmente. O
> que este repositório faz, em vez disso, é reproduzir, o mais fielmente possível conforme a
> documentação pública, os requests e responses exatos que o px-torre-core envia e espera: mesmos
> campos GraphQL, mesmo formato de erro, mesma assinatura de webhook. É um substituto, não uma
> cópia.

## Conteúdo

- [Começando rápido](#começando-rápido)
- [O que já está implementado](#o-que-já-está-implementado)
- [Fidelidade à documentação real](#fidelidade-à-documentação-real)
- [Endpoints](#endpoints)
- [Simulando erros](#simulando-erros)
- [Configuração](#configuração)
- [Testes](#testes)
- [Conectando com o px-torre-core](#conectando-com-o-px-torre-core)
- [Estrutura do projeto](#estrutura-do-projeto)

## Começando rápido

Você **não** precisa do px-torre-core rodando pra usar isso sozinho.

```bash
docker compose up --build -d
curl http://localhost:4100/health
# => {"status":"ok"}
```

Só isso — o mock já está escutando em `http://localhost:4100`.

## O que já está implementado

- [x] Mutation `createDocument` — aceita o mesmo upload multipart que o px-torre-core envia, valida
      o arquivo e o telefone de cada signatário, e salva uma cópia do PDF original em
      `~/Downloads/autentique-mock/`.
- [x] Query `document` — cobre os dois formatos que o px-torre-core pede (`GetDocumentFiles` e
      `GetDocumentSignatureInfo`).
- [x] Mutation `signDocument` — implementada por completude do contrato, mesmo o fluxo real de
      assinatura do motorista no px-torre-core nunca chamando ela de fato.
      (`AutentiqueDocumentService::signDocument` só atualiza a própria linha no banco do
      px-torre-core; a mutation GraphQL só é usada no fluxo de co-assinatura da empresa, que este
      mock não cobre.)
- [x] Simulação de assinatura (`POST /simulate/:documentId/sign`) — substitui o motorista abrindo o
      link e assinando de verdade: marca o documento como assinado, carimba uma página de auditoria
      falsa "SIMULATED" no PDF, salva em `~/Downloads/autentique-mock/`, e dispara o mesmo webhook
      `signature.accepted` que a Autentique enviaria, assinado do mesmo jeito que o px-torre-core
      verifica.
- [x] `SIMULATE_TIMEOUT` — faz toda requisição ficar pendurada sem resposta, pra testar como o
      px-torre-core se comporta durante uma queda real da Autentique.
- [x] Header `X-Simulate-Error` — força qualquer uma das respostas de erro listadas abaixo, sob
      demanda.
- [x] `GET /sign/:publicId` — a página que o `link.short_link` de um signatário de fato abre: mostra
      o documento e o signatário, e tem um botão que chama `/simulate/:documentId/sign` por você, em
      vez de precisar montar a requisição HTTP na mão.
- [ ] Variações de webhook `signature.viewed` / `document.finished`.
- [ ] O fluxo de co-assinatura da empresa.

## Fidelidade à documentação real

Reconferido campo a campo contra [docs.autentique.com.br/api](https://docs.autentique.com.br/api).
Tudo abaixo foi confirmado batendo exatamente, com duas exceções explicadas:

- **Confirmado batendo exatamente**: o formato de request/response das mutations `createDocument` /
  `signDocument` e da query `document`, o envelope de erro do GraphQL (`errors[].message` +
  `extensions.validation`), o envelope do webhook, o esquema do HMAC-SHA256 sobre o corpo bruto
  (`x-autentique-signature`), e o `data` do webhook `signature.accepted` (reflete o recurso
  Signature documentado: `object, public_id, document, action, viewed, rejected, biometric_*,
  user{name, email, cpf, birthday}`).
- **Desvio deliberado** (ver `lib/webhook.js`): `data.signed` é um timestamp ISO simples, não o
  objeto Event aninhado que a documentação mostra. O `AutentiqueSignatureService` do próprio
  px-torre-core lê esse campo direto pra uma coluna `signed_at` — seguir o formato literal da doc
  aí alimentaria o único consumidor real desse campo com um valor que ele não sabe processar, então
  este mock mantém o formato que realmente funciona.
- **Não existe na documentação pública, veio direto do código do px-torre-core**: o código de erro
  `must_be_a_valid_phone_number` e o path `signers.N.phone`. Implementado exatamente como o
  `AutentiqueIntegrationService::validateAutentiqueErrors` já processa isso — a única evidência
  real disponível, já que a documentação da Autentique nunca menciona essa validação.
- **Lacuna conhecida e assumida**: respostas de erro reais podem carregar um campo
  `extensions.category` junto de `extensions.validation`. A documentação menciona que ele existe
  mas não dá nenhum exemplo de valor, então ficou de fora em vez de eu chutar um valor.

## Endpoints

| Método | Caminho                       | Pra que serve                                             |
|--------|-------------------------------|-------------------------------------------------------------|
| GET    | `/health`                     | Checagem de que o servidor está no ar.                       |
| POST   | `/graphql`                    | Endpoint GraphQL do mock (`createDocument`, `signDocument`, query `document`). |
| GET    | `/files/:documentId/original.pdf` | O PDF original, exatamente como foi enviado.           |
| GET    | `/files/:documentId/signed.pdf`   | O PDF assinado (404 até o documento ser assinado).     |
| POST   | `/simulate/:documentId/sign`  | Simula a assinatura do motorista. Corpo: `{"cpf": "12345678901"}`. |
| GET    | `/sign/:publicId`             | A página que o `link.short_link` do signatário abre — tem um botão que chama o endpoint acima. |

## Simulando erros

Envie um header `X-Simulate-Error` em qualquer requisição pra forçar uma dessas respostas em vez do
fluxo normal — útil pra testar como o px-torre-core reage a uma falha real da Autentique:

| Valor do header        | O que ele força                                              |
|-------------------------|----------------------------------------------------------------|
| `unauthorized`          | Erro GraphQL, token de API inválido/expirado.                  |
| `invalid_phone`         | Erro de validação no telefone de um signatário.                |
| `must_be_a_file`        | Erro de validação, arquivo ausente/inválido.                   |
| `document_not_found`    | Erro GraphQL, id de documento desconhecido.                    |
| `signature_not_found`   | Erro GraphQL, `signDocument` num documento desconhecido.       |
| `rate_limit`            | HTTP 429, "Too Many Attempts".                                  |

```bash
curl http://localhost:4100/graphql -H "X-Simulate-Error: rate_limit" -F "operations=..." -F "map=..."
```

## Configuração

Copie `.env.example` pra `.env` e ajuste o que precisar. Depois de qualquer mudança, recrie o
container: `docker compose up -d`.

| Variável                    | Padrão                                               | Pra que serve                                                          |
|------------------------------|--------------------------------------------------------|--------------------------------------------------------------------------|
| `SIMULATE_TIMEOUT`           | `false`                                                | `true` faz toda requisição ficar pendurada pra sempre — simula uma queda. |
| `PUBLIC_BASE_URL`            | `http://localhost:4100`                                | Usado pra montar o `link.short_link` de cada signatário e as URLs de `files.*`. |
| `HOST_UID` / `HOST_GID`      | `1000` / `1000`                                        | O seu próprio `id -u` / `id -g` — mantém os arquivos salvos em Downloads como seus, não de `root`. |
| `WEBHOOK_SECRET`             | `local-mock-secret`                                    | Precisa ser exatamente igual ao `AUTENTIQUE_WEBHOOK_SECRET` do px-torre-core. |
| `PX_TORRE_CORE_WEBHOOK_URL`  | `http://host.docker.internal:8080/api/webhooks/documents/signature` | Pra onde o webhook simulado é enviado. Ver seção abaixo. |

## Testes

Não precisa de Node instalado na sua máquina — a suíte roda dentro do próprio container, igual o
resto do projeto:

```bash
docker compose exec autentique-mock npm test
```

São 21 testes (`node --test`, o runner nativo do Node, sem dependência nova) cobrindo a lógica que
realmente importa: validação de telefone e arquivo no `createDocument`, os dois formatos da query
`document`, todos os erros simuláveis, a assinatura HMAC do webhook (inclusive o caso de falha de
rede), e o carimbo de PDF — incluindo o teste que reproduz exatamente o bug de PDF inválido
derrubando o processo inteiro, encontrado e corrigido durante o desenvolvimento deste mock.

## Conectando com o px-torre-core

**Este repositório é totalmente independente do px-torre-core.** Ele não entra na rede Docker do
px-torre-core, e não sabe os nomes dos containers dele — se você nunca tocar na seção abaixo, este
mock continua funcionando sozinho pra qualquer coisa que não precise do px-torre-core reagir a ele
(inspecionar requisições, checar o carimbo no PDF, etc).

Pra que os dois projetos realmente conversem entre si num teste local completo, eles se conectam
através de portas que cada um já expõe na sua máquina — não pela rede interna do Docker. Pense
como dois apps separados no seu notebook conversando via `localhost`:

```
┌───────────────────────────── sua máquina ───────────────────────────────┐
│                                                                          │
│   ┌─────────────────────┐                    ┌─────────────────────┐   │
│   │   px-torre-core      │                    │   autentique-mock    │   │
│   │   (Docker próprio)   │                    │   (este repo)        │   │
│   │                       │  ── webhook ──►    │                       │   │
│   │   app :80 → :8080     │  ◄── chamadas ──   │   server :4000 → :4100│   │
│   └─────────────────────┘                    └─────────────────────┘   │
│                                                                          │
│   Nenhum dos dois projetos precisa saber como o outro está montado.     │
│   Eles só precisam da porta do host um do outro.                       │
└──────────────────────────────────────────────────────────────────────────┘
```

### Configuração (uma vez só)

1. **Aponte o px-torre-core pra este mock.** Adicione estas três linhas no `.env` local do
   px-torre-core (esse arquivo também é ignorado pelo git lá, então isso é só pra sua máquina):

   ```bash
   AUTENTIQUE_API_URL=http://host.docker.internal:4100/graphql
   AUTENTIQUE_API_TOKEN=fake-local-token
   AUTENTIQUE_WEBHOOK_SECRET=local-mock-secret
   ```

   > `host.docker.internal` é como um container alcança uma porta publicada na sua máquina. Pros
   > containers Sail do px-torre-core resolverem esse nome no Linux, eles precisam de uma entrada
   > `extra_hosts: host.docker.internal:host-gateway` no `docker-compose.yml` do px-torre-core —
   > confira se ela já existe antes de adicionar.

2. **Limpe o cache de config do px-torre-core**, se ele tiver algum (`php artisan config:cache` já
   rodou em algum momento): `sail artisan config:clear`. Sem isso, os novos valores do `.env` não
   são lidos.

3. **Aponte este mock de volta pro px-torre-core.** No `.env` deste repositório, ajuste
   `PX_TORRE_CORE_WEBHOOK_URL` pra onde o app do px-torre-core está acessível pela sua máquina. O
   padrão já assume o mapeamento usual do Sail (`8080:80`) — só mude se o seu px-torre-core usar
   outra porta.

### Confirmando que funciona

Rode isto antes de confiar no fluxo completo — cada comando deve voltar com conteúdo ou um código
de status, provando que os dois lados se alcançam:

```bash
# o mock está no ar
curl http://localhost:4100/health

# a rota de webhook do px-torre-core está alcançável (405 é o esperado: é um
# GET numa rota que só aceita POST — isso só prova que a rota existe)
curl -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/webhooks/documents/signature
```

Depois faça um teste completo de ponta a ponta: crie um documento contra o mock, dê `POST` em
`/simulate/:documentId/sign`, e olhe o campo `webhook` na resposta:

- `"status":401` significa que o webhook *chegou* no px-torre-core, mas a assinatura não bateu —
  confira se `WEBHOOK_SECRET` (aqui) e `AUTENTIQUE_WEBHOOK_SECRET` (lá) são idênticos.
- `"status":200` significa que funcionou: o px-torre-core aceitou o webhook.

Se um motorista/documento específico é realmente atualizado depois disso depende dos dados locais
do próprio px-torre-core (um motorista de teste com o `cpf` que você mandou, a feature flag da
Autentique ligada pra empresa dele, etc) — essa parte é inteiramente do px-torre-core e não tem
nada a ver com este mock.

### Resolvendo problemas comuns

| Sintoma                                                     | Causa provável                                                              |
|---------------------------------------------------------------|--------------------------------------------------------------------------------|
| `curl: (7) Failed to connect` em `localhost:4100`             | O mock não está rodando — `docker compose up -d`.                              |
| Webhook `"delivered": false, "error": "fetch failed"`        | `PX_TORRE_CORE_WEBHOOK_URL` está errado, ou o px-torre-core não está rodando.  |
| Webhook `"status": 401`                                       | `WEBHOOK_SECRET` aqui não bate com `AUTENTIQUE_WEBHOOK_SECRET` lá.             |
| Arquivos em `~/Downloads/autentique-mock/` pertencendo a `root` | `HOST_UID` / `HOST_GID` no `.env` não batem com seu `id -u` / `id -g` real.  |

## Estrutura do projeto

```
src/
  server.js               ponto de entrada: rotas, despacho das requisições
  store.js                 "banco de dados" em memória dos documentos criados
  middleware/
    simulateTimeout.js      o comportamento do SIMULATE_TIMEOUT
  graphql/
    createDocument.js       mutation createDocument
    documentQuery.js        query document
    signDocument.js          mutation signDocument
  lib/
    config.js                lê e centraliza todas as variáveis de ambiente
    errors.js                todos os formatos de erro, incl. X-Simulate-Error
    pdfStamp.js               monta a página falsa de auditoria "SIMULATED"
    signing.js                marca um documento como assinado (carimba + salva)
    webhook.js                monta e assina o webhook signature.accepted
    downloads.js              salva os PDFs em ~/Downloads/autentique-mock/
    signPage.js               renderiza a página HTML de /sign/:publicId

  *.test.js                 um teste ao lado de cada arquivo que testa
                             (node --test src, sem dependência de teste nova)
```
