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

Not implemented yet: `createDocument`, `signDocument`, the `document` query, file serving, the
signed-document audit-page stamp, the signature webhook, and error simulation.

## Running

```bash
docker compose up --build -d
curl http://localhost:4100/health
```

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

| Variable          | Default | Description                                                                 |
|--------------------|---------|-------------------------------------------------------------------------------|
| `SIMULATE_TIMEOUT` | `false` | When `true`, every request hangs with no response, simulating a real outage. |

Changing `.env` requires recreating the container: `docker compose up -d`.

## Wiring up px-torre-core

Point px-torre-core's local `.env` at this mock:

```
AUTENTIQUE_API_URL=http://localhost:4100/graphql
AUTENTIQUE_API_TOKEN=fake-local-token
AUTENTIQUE_WEBHOOK_SECRET=<shared secret, once the webhook simulation is implemented>
```
