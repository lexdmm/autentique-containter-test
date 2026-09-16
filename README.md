# autentique-mock

Um mock local e independente da API GraphQL da [Autentique](https://www.autentique.com.br). Ele
existe para que qualquer aplicação que integre com a Autentique possa ser desenvolvida e testada
contra um fluxo de geração e assinatura de documentos **sem** depender da nuvem real da Autentique,
sem precisar de uma conta de verdade, e sem nenhum risco de enviar um documento real pra uma pessoa
real.

> **Isto não é um ambiente real da Autentique.** A Autentique é um SaaS fechado e pago, sem versão
> self-hosted ou Docker disponível em lugar nenhum — não existe nada pra "instalar" localmente. O
> que este repositório faz, em vez disso, é reproduzir, o mais fielmente possível conforme a
> documentação pública, os requests e responses exatos que a API real usa: mesmos campos GraphQL,
> mesmo formato de erro, mesma assinatura de webhook. É um substituto, não uma cópia — e serve pra
> qualquer projeto que fale com a Autentique, não só um específico.

## Conteúdo

- [Começando rápido](#começando-rápido)
- [O que já está implementado](#o-que-já-está-implementado)
- [Fidelidade à documentação real](#fidelidade-à-documentação-real)
- [Endpoints](#endpoints)
- [Simulando erros](#simulando-erros)
- [Configuração](#configuração)
- [Testes](#testes)
- [Conectando com sua aplicação](#conectando-com-sua-aplicação)
- [Estrutura do projeto](#estrutura-do-projeto)

## Começando rápido

Você **não** precisa de nenhuma outra aplicação rodando pra usar isso sozinho.

```bash
docker compose up --build -d
curl http://localhost:4100/health
# => {"status":"ok"}
```

Só isso — o mock já está escutando em `http://localhost:4100`.

## O que já está implementado

- [x] Mutation `createDocument` — aceita o mesmo upload multipart que qualquer client GraphQL da
      Autentique envia (padrão `operations` + `map` + `file`), valida tamanho, MIME, extensão e
      estrutura do PDF, além do telefone de
      cada signatário, e salva uma cópia do PDF original em `~/Downloads/autentique-mock/`.
- [x] Query `document` — cobre tanto pedir só os arquivos (`files`) quanto só o status de
      assinatura (`signatures`), na mesma resposta combinada.
- [x] Mutation `signDocument` — assina somente o signatário cujo e-mail corresponde à conta da
      chave de API, configurada por `AUTENTIQUE_API_USER_EMAIL`.
- [x] Simulação de assinatura (`POST /simulate/:publicId/sign`) — substitui um signatário abrindo
      o link e assinando de verdade: marca somente aquele signatário, dispara seu webhook
      `signature.accepted` e finaliza/carimba o PDF quando todos tiverem assinado.
- [x] `SIMULATE_TIMEOUT` — faz toda requisição ficar pendurada sem resposta, pra testar como sua
      aplicação se comporta durante uma queda real da Autentique.
- [x] Header `X-Simulate-Error` — força qualquer uma das respostas de erro listadas abaixo, sob
      demanda.
- [x] `GET /sign/:publicId` — a página que o `link.short_link` de um signatário de fato abre: mostra
      o documento e o signatário, e tem um botão que chama `/simulate/:publicId/sign` por você, em
      vez de precisar montar a requisição HTTP na mão.
- [ ] Variações de webhook `signature.viewed` / `document.finished`.

## Fidelidade à documentação real

Reconferido campo a campo contra [docs.autentique.com.br/api](https://docs.autentique.com.br/api).
As limitações e os desvios conhecidos estão descritos abaixo:

- **Confirmado batendo exatamente**: o formato de request/response das mutations `createDocument` /
  `signDocument` e da query `document`, o envelope de erro do GraphQL (`errors[].message` +
  `extensions.validation`), o envelope do webhook, o esquema do HMAC-SHA256 sobre o corpo bruto
  (`x-autentique-signature`), e o `data` do webhook `signature.accepted` (reflete o recurso
  Signature documentado: `object, public_id, document, action, viewed, rejected, biometric_*,
  user{name, email, cpf, birthday}`).
- **Desvio deliberado** (ver `lib/webhook.js`): `data.signed` é um timestamp ISO simples, não o
  objeto Event aninhado que a documentação mostra. Muitas aplicações leem esse campo direto pra uma
  coluna de data/hora — seguir o formato literal da doc quebraria esse padrão comum, então este mock
  mantém o formato mais fácil de consumir.
- **Não existe na documentação pública, veio de uma aplicação real em produção**: o código de erro
  `must_be_a_valid_phone_number` e o path `signers.N.phone`. Implementado exatamente como uma
  aplicação Laravel real em produção já processa esse erro — a única evidência real disponível, já
  que a documentação da Autentique nunca menciona essa validação.
- **Escopo de arquivos**: embora a Autentique aceite outros formatos em alguns fluxos, este mock
  aceita somente PDFs válidos, pois a simulação de assinatura adiciona a página de auditoria
  diretamente ao PDF. Arquivos acima de `MAX_UPLOAD_BYTES` também são rejeitados antes de serem
  persistidos.

## Endpoints

| Método | Caminho                       | Pra que serve                                             |
|--------|-------------------------------|-------------------------------------------------------------|
| GET    | `/health`                     | Checagem de que o servidor está no ar.                       |
| POST   | `/graphql`                    | Endpoint GraphQL do mock (`createDocument`, `signDocument`, query `document`). |
| GET    | `/files/:documentId/original.pdf` | O PDF original, exatamente como foi enviado.           |
| GET    | `/files/:documentId/signed.pdf`   | O PDF assinado (404 até o documento ser assinado).     |
| POST   | `/simulate/:publicId/sign`    | Simula a assinatura daquele signatário. Corpo: `{"cpf": "12345678901"}`. |
| GET    | `/sign/:publicId`             | A página que o `link.short_link` do signatário abre — tem um botão que chama o endpoint acima. |

## Simulando erros

Envie um header `X-Simulate-Error` em qualquer requisição pra forçar uma dessas respostas em vez do
fluxo normal — útil pra testar como sua aplicação reage a uma falha real da Autentique:

| Valor do header        | O que ele força                                              |
|-------------------------|----------------------------------------------------------------|
| `unauthorized`          | Erro GraphQL, token de API inválido/expirado.                  |
| `invalid_phone`         | Erro de validação no telefone de um signatário.                |
| `must_be_a_file`        | Erro de validação, arquivo ausente/inválido.                   |
| `document_not_found`    | Erro GraphQL, id de documento desconhecido.                    |
| `signature_not_found`   | Erro GraphQL, `signDocument` num documento desconhecido.       |
| `document_signed`       | Erro GraphQL, signatário da conta da API já assinou.            |
| `rate_limit`            | HTTP 429, "Too Many Attempts".                                  |

```bash
curl http://localhost:4100/graphql -H "X-Simulate-Error: rate_limit" -F "operations=..." -F "map=..."
```

## Configuração

Copie `.env.example` pra `.env` e ajuste o que precisar. Depois de qualquer mudança, recrie o
container: `docker compose up -d`.

| Variável                | Padrão                                          | Pra que serve                                                          |
|--------------------------|---------------------------------------------------|--------------------------------------------------------------------------|
| `SIMULATE_TIMEOUT`       | `false`                                            | `true` faz toda requisição ficar pendurada pra sempre — simula uma queda. |
| `AUTENTIQUE_API_TOKEN`   | `fake-local-token`                                 | Token Bearer aceito pelo endpoint GraphQL local.                          |
| `AUTENTIQUE_API_USER_EMAIL` | `api-owner@example.test`                       | E-mail da conta dona da chave; `signDocument` assina esse signatário.     |
| `MAX_UPLOAD_BYTES`       | `10485760`                                         | Tamanho máximo do PDF enviado, em bytes (10 MiB por padrão).              |
| `PUBLIC_BASE_URL`        | `http://localhost:4100`                            | Usado pra montar o `link.short_link` de cada signatário e as URLs de `files.*`. |
| `HOST_UID` / `HOST_GID`  | `1000` / `1000`                                    | O seu próprio `id -u` / `id -g` — mantém os arquivos salvos em Downloads como seus, não de `root`. |
| `WEBHOOK_SECRET`         | `local-mock-secret`                                | Precisa ser exatamente igual ao segredo que sua aplicação usa pra validar a assinatura do webhook. |
| `WEBHOOK_TARGET_URL`     | `http://host.docker.internal:8080/api/webhooks/autentique` | Pra onde o webhook simulado é enviado. Ver seção abaixo. |

## Testes

Não precisa de Node instalado na sua máquina — a suíte roda dentro do próprio container, igual o
resto do projeto:

```bash
docker compose exec autentique-mock npm test
```

A suíte usa `node --test`, o runner nativo do Node, e cobre a lógica que
realmente importa: validação de telefone e arquivo no `createDocument`, os dois formatos da query
`document`, todos os erros simuláveis, a assinatura HMAC do webhook (inclusive o caso de falha de
rede), e o carimbo de PDF — incluindo o teste que reproduz exatamente o bug de PDF inválido
derrubando o processo inteiro, encontrado e corrigido durante o desenvolvimento deste mock.

## Conectando com sua aplicação

**Este repositório é totalmente independente.** Ele não entra em nenhuma rede Docker de outro
projeto, e não sabe o nome de nenhum container externo — se você nunca tocar na seção abaixo, este
mock continua funcionando sozinho pra qualquer coisa que não precise da sua aplicação reagir a ele
(inspecionar requisições, checar o carimbo no PDF, etc).

Pra que os dois lados realmente conversem entre si num teste local completo, eles se conectam
através de portas que cada um já expõe na sua máquina — não pela rede interna do Docker. Pense
como dois apps separados no seu notebook conversando via `localhost`:

```
┌───────────────────────────── sua máquina ───────────────────────────────┐
│                                                                          │
│   ┌─────────────────────┐                    ┌─────────────────────┐   │
│   │   sua aplicação      │                    │   autentique-mock    │   │
│   │   (Docker próprio)   │                    │   (este repo)        │   │
│   │                       │  ── webhook ──►    │                       │   │
│   │   app :80 → :8080     │  ◄── chamadas ──   │   server :4000 → :4100│   │
│   └─────────────────────┘                    └─────────────────────┘   │
│                                                                          │
│   Nenhum dos dois lados precisa saber como o outro está montado.       │
│   Eles só precisam da porta do host um do outro.                       │
└──────────────────────────────────────────────────────────────────────────┘
```

### Configuração (uma vez só)

1. **Aponte sua aplicação pra este mock.** Configure as variáveis de ambiente que ela usa pra
   falar com a Autentique (os nomes variam por projeto, mas a ideia é a mesma):

   ```bash
   AUTENTIQUE_API_URL=http://host.docker.internal:4100/graphql
   AUTENTIQUE_API_TOKEN=fake-local-token
   AUTENTIQUE_WEBHOOK_SECRET=local-mock-secret
   ```

   > `host.docker.internal` é como um container alcança uma porta publicada na sua máquina. Se sua
   > aplicação também roda em containers Docker no Linux, eles precisam de uma entrada
   > `extra_hosts: host.docker.internal:host-gateway` no `docker-compose.yml` dela pra resolver esse
   > nome — confira se já existe antes de adicionar.

2. **Limpe qualquer cache de configuração da sua aplicação**, se ela tiver algum (ex.: em apps
   Laravel, `php artisan config:cache` já rodou em algum momento — nesse caso, `config:clear`).
   Sem isso, os novos valores de ambiente não são lidos.

3. **Aponte este mock de volta pra sua aplicação.** No `.env` deste repositório, ajuste
   `WEBHOOK_TARGET_URL` pra onde o endpoint de webhook da sua aplicação está acessível pela sua
   máquina. O padrão assume a porta `8080`; ajuste pra porta e caminho reais do seu setup.

### Confirmando que funciona

Rode isto antes de confiar no fluxo completo — cada comando deve voltar com conteúdo ou um código
de status, provando que os dois lados se alcançam:

```bash
# o mock está no ar
curl http://localhost:4100/health

# a rota de webhook da sua aplicação está alcançável (um 404/405 pode ser o
# esperado aqui, dependendo do método/caminho exatos — o que importa é não
# dar erro de conexão)
curl -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/webhooks/autentique
```

Depois faça um teste completo de ponta a ponta: crie um documento contra o mock, copie o
`signatures[].public_id` retornado, dê `POST` em `/simulate/:publicId/sign`, e olhe o campo
`webhook` na resposta:

- `"status":401` (ou equivalente) significa que o webhook *chegou* na sua aplicação, mas a
  assinatura não bateu — confira se `WEBHOOK_SECRET` (aqui) e o segredo configurado lá são
  idênticos.
- `"status":200` significa que funcionou: sua aplicação aceitou o webhook.

Se um registro específico é realmente atualizado depois disso depende dos dados locais da própria
aplicação (um usuário de teste com o `cpf` que você mandou, alguma feature flag ligada, etc) — essa
parte é inteiramente da aplicação que você está testando e não tem nada a ver com este mock.

### Resolvendo problemas comuns

| Sintoma                                                     | Causa provável                                                              |
|---------------------------------------------------------------|--------------------------------------------------------------------------------|
| `curl: (7) Failed to connect` em `localhost:4100`             | O mock não está rodando — `docker compose up -d`.                              |
| Webhook `"delivered": false, "error": "fetch failed"`        | `WEBHOOK_TARGET_URL` está errado, ou sua aplicação não está rodando.           |
| Webhook `"status": 401`                                       | `WEBHOOK_SECRET` aqui não bate com o segredo configurado na sua aplicação.     |
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
    signing.js                assina um signatário e finaliza o documento quando todos assinarem
    webhook.js                monta e assina o webhook signature.accepted
    downloads.js              salva os PDFs em ~/Downloads/autentique-mock/
    signPage.js               renderiza a página HTML de /sign/:publicId

  *.test.js                 um teste ao lado de cada arquivo que testa
                             (node --test src, sem dependência de teste nova)
```
