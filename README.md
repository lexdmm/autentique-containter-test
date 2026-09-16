# autentique-mock

Local mock of the Autentique GraphQL API (`https://api.autentique.com.br/v2/graphql`), built to let
[px-torre-core](https://github.com/lexdmm/px-torre-core) exercise its document generation and
signature flow locally without depending on the real Autentique cloud.

This is **not** a real Autentique environment: Autentique is a closed SaaS with no self-hosted or
Docker distribution. This mock only reproduces the request/response contracts and webhook behavior
that px-torre-core actually relies on.

## Status

Work in progress. Implemented so far:

- Project scaffold (Express + Docker).
- `SIMULATE_TIMEOUT` toggle to reproduce a real Autentique outage (the server holds the connection
  open and never responds).
- `createDocument` mutation: accepts the same multipart upload px-torre-core sends, validates the
  file and signer phone numbers, stores the document in memory, and saves a copy of the original
  PDF to `~/Downloads/autentique-mock/`.
- Error simulation via the `X-Simulate-Error` request header: `unauthorized`, `invalid_phone`,
  `must_be_a_file`, `rate_limit`.

Not implemented yet: `signDocument`, the `document` query, file serving, the signed-document
audit-page stamp, and the signature webhook.

## Running

```bash
docker compose up --build -d
curl http://localhost:4100/health
```

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

| Variable            | Default                 | Description                                                                 |
|----------------------|-------------------------|-------------------------------------------------------------------------------|
| `SIMULATE_TIMEOUT`   | `false`                 | When `true`, every request hangs with no response, simulating a real outage. |
| `PUBLIC_BASE_URL`    | `http://localhost:4100` | Base URL used to build each signer's `link.short_link`.                      |

Changing `.env` requires recreating the container: `docker compose up -d`.

## Wiring up px-torre-core

Point px-torre-core's local `.env` at this mock:

```
AUTENTIQUE_API_URL=http://localhost:4100/graphql
AUTENTIQUE_API_TOKEN=fake-local-token
AUTENTIQUE_WEBHOOK_SECRET=<shared secret, once the webhook simulation is implemented>
```
