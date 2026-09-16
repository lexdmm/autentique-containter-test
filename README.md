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
  `must_be_a_file`, `rate_limit`, `document_not_found`, `signature_not_found`.
- `document` query (covers both `GetDocumentFiles` and `GetDocumentSignatureInfo`) and
  `GET /files/:id/original.pdf` / `signed.pdf` to serve the stored PDFs.
- `signDocument` mutation, for contract completeness. Note: px-torre-core's own driver-signing flow
  never actually calls it (`AutentiqueDocumentService::signDocument` only updates its local DB row);
  it's only exercised by the company co-sign flow, which this mock doesn't cover yet.
- `POST /simulate/:documentId/sign` (body: `{"cpf": "..."}`) stands in for the driver signing for
  real on Autentique's side: marks the document signed, appends a fake "SIMULATED" audit page to
  the PDF (signer info, timestamp, a hash of the original file — approximating what Autentique
  embeds, not its actual visual layout, since there's no real sample to copy from), saves the result
  to `~/Downloads/autentique-mock/`, and fires a `signature.accepted` webhook to px-torre-core,
  HMAC-signed the same way `AutentiqueWebhookMiddleware` verifies it.

Not implemented yet: wiring the webhook URL to px-torre-core's real Sail network (still points at a
placeholder), and the `signature.viewed` / `document.finished` webhook variants.

## Running

```bash
docker compose up --build -d
curl http://localhost:4100/health
```

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

| Variable            | Default                 | Description                                                                 |
|----------------------|-------------------------|-------------------------------------------------------------------------------|
| `SIMULATE_TIMEOUT`         | `false`                 | When `true`, every request hangs with no response, simulating a real outage.        |
| `PUBLIC_BASE_URL`          | `http://localhost:4100` | Base URL used to build each signer's `link.short_link` and the `files.*` URLs.       |
| `WEBHOOK_SECRET`           | `local-mock-secret`     | Must match px-torre-core's `AUTENTIQUE_WEBHOOK_SECRET` exactly.                      |
| `PX_TORRE_CORE_WEBHOOK_URL`| _(placeholder)_         | Where the simulated `signature.accepted` webhook is POSTed. Not wired up for real yet.|

Changing `.env` requires recreating the container: `docker compose up -d`.

## Wiring up px-torre-core

Point px-torre-core's local `.env` at this mock:

```
AUTENTIQUE_API_URL=http://localhost:4100/graphql
AUTENTIQUE_API_TOKEN=fake-local-token
AUTENTIQUE_WEBHOOK_SECRET=local-mock-secret
```

The actual Docker networking between the two projects (so the mock can reach px-torre-core's webhook
endpoint, and px-torre-core can reach the mock, without relying on the host machine) is not set up
yet - that's the next step.
