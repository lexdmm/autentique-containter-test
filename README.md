# autentique-mock

A local, standalone mock of the [Autentique](https://www.autentique.com.br) GraphQL API. It exists
so [px-torre-core](https://github.com/lexdmm/px-torre-core) can be developed and tested against a
document-signing flow **without** touching the real Autentique cloud, without a real account, and
without any risk of sending a real document to a real person.

> **This is not a real Autentique environment.** Autentique is a closed, paid SaaS product with no
> self-hosted or Docker version available anywhere - there is nothing to "install" locally. What
> this repo does instead is reproduce, as closely as the public API docs allow, the exact requests
> and responses px-torre-core sends and expects: same GraphQL fields, same error shapes, same
> webhook signature. It's a stand-in, not a copy.

## Contents

- [Quick start](#quick-start)
- [What's implemented](#whats-implemented)
- [Endpoints](#endpoints)
- [Simulating errors](#simulating-errors)
- [Configuration](#configuration)
- [Connecting to px-torre-core](#connecting-to-px-torre-core)
- [Project structure](#project-structure)

## Quick start

You do **not** need px-torre-core running to use this on its own.

```bash
docker compose up --build -d
curl http://localhost:4100/health
# => {"status":"ok"}
```

That's it - the mock is now listening on `http://localhost:4100`.

## What's implemented

- [x] `createDocument` mutation - accepts the same multipart upload px-torre-core sends, validates
      the file and each signer's phone number, and saves a copy of the original PDF to
      `~/Downloads/autentique-mock/`.
- [x] `document` query - covers both shapes px-torre-core asks for (`GetDocumentFiles` and
      `GetDocumentSignatureInfo`).
- [x] `signDocument` mutation - implemented for contract completeness, even though px-torre-core's
      own driver-signing flow never actually calls it. (`AutentiqueDocumentService::signDocument`
      only updates px-torre-core's own database row; the GraphQL mutation is only used by the
      company co-sign flow, which this mock doesn't cover.)
- [x] Signature simulation (`POST /simulate/:documentId/sign`) - stands in for a driver actually
      opening the link and signing: marks the document signed, stamps a fake "SIMULATED" audit page
      onto the PDF, saves it to `~/Downloads/autentique-mock/`, and fires the same `signature.accepted`
      webhook Autentique would send, signed the same way px-torre-core verifies it.
- [x] `SIMULATE_TIMEOUT` - makes every request hang with no response, to test how px-torre-core
      behaves during a real Autentique outage.
- [x] `X-Simulate-Error` header - forces any of the error responses listed below on demand.
- [ ] `signature.viewed` / `document.finished` webhook variants.
- [ ] The company co-sign flow.

## Endpoints

| Method | Path                          | Purpose                                                  |
|--------|-------------------------------|-----------------------------------------------------------|
| GET    | `/health`                     | Liveness check.                                            |
| POST   | `/graphql`                    | The mock's GraphQL endpoint (`createDocument`, `signDocument`, `document` query). |
| GET    | `/files/:documentId/original.pdf` | The original PDF, as it was uploaded.                  |
| GET    | `/files/:documentId/signed.pdf`   | The signed PDF (404 until the document is signed).     |
| POST   | `/simulate/:documentId/sign`  | Simulates the driver signing. Body: `{"cpf": "12345678901"}`. |

## Simulating errors

Send an `X-Simulate-Error` header on any request to force one of these responses instead of the
normal flow - useful for testing how px-torre-core reacts to a real Autentique failure:

| Header value          | What it forces                                              |
|------------------------|--------------------------------------------------------------|
| `unauthorized`         | GraphQL error, invalid/expired API token.                    |
| `invalid_phone`        | Validation error on a signer's phone number.                 |
| `must_be_a_file`       | Validation error, missing/invalid file.                      |
| `document_not_found`   | GraphQL error, unknown document id.                           |
| `signature_not_found`  | GraphQL error, `signDocument` on an unknown document.         |
| `rate_limit`           | HTTP 429, "Too Many Attempts".                                |

```bash
curl http://localhost:4100/graphql -H "X-Simulate-Error: rate_limit" -F "operations=..." -F "map=..."
```

## Configuration

Copy `.env.example` to `.env`, then adjust as needed. Recreate the container after any change:
`docker compose up -d`.

| Variable                   | Default                                              | What it's for                                                          |
|-----------------------------|-------------------------------------------------------|-------------------------------------------------------------------------|
| `SIMULATE_TIMEOUT`          | `false`                                               | `true` makes every request hang forever - simulates an outage.        |
| `PUBLIC_BASE_URL`           | `http://localhost:4100`                               | Used to build each signer's `link.short_link` and the `files.*` URLs. |
| `HOST_UID` / `HOST_GID`     | `1000` / `1000`                                       | Your own `id -u` / `id -g` - keeps files written to Downloads owned by you, not root. |
| `WEBHOOK_SECRET`            | `local-mock-secret`                                   | Must match px-torre-core's `AUTENTIQUE_WEBHOOK_SECRET` exactly.       |
| `PX_TORRE_CORE_WEBHOOK_URL` | `http://host.docker.internal:8080/api/webhooks/documents/signature` | Where the simulated webhook is sent. See below.       |

## Connecting to px-torre-core

**This repo is fully independent of px-torre-core.** It doesn't join px-torre-core's Docker
network, and it doesn't know px-torre-core's container names - if you never touch the section
below, this mock still works standalone for anything that doesn't need px-torre-core to react to
it (inspecting requests, checking the PDF stamp, etc.).

To let the two projects actually talk to each other for a full local test, they connect through
ports each one already exposes on your machine - not through Docker's internal networking. Think
of it like two separate apps on your laptop talking over `localhost`:

```
┌───────────────────────────── your machine ─────────────────────────────┐
│                                                                          │
│   ┌─────────────────────┐                    ┌─────────────────────┐   │
│   │   px-torre-core      │                    │   autentique-mock    │   │
│   │   (its own Docker)   │                    │   (this repo)        │   │
│   │                       │  ── webhook ──►    │                       │   │
│   │   app :80 → :8080     │  ◄── API calls ──  │   server :4000 → :4100│   │
│   └─────────────────────┘                    └─────────────────────┘   │
│                                                                          │
│   Neither project needs to know how the other one is set up.           │
│   They only need each other's host port.                               │
└──────────────────────────────────────────────────────────────────────────┘
```

### Setup (one-time)

1. **Point px-torre-core at this mock.** Add these three lines to px-torre-core's own local `.env`
   (that file is gitignored there too, so this is just for your machine):

   ```bash
   AUTENTIQUE_API_URL=http://host.docker.internal:4100/graphql
   AUTENTIQUE_API_TOKEN=fake-local-token
   AUTENTIQUE_WEBHOOK_SECRET=local-mock-secret
   ```

   > `host.docker.internal` is how a container reaches a port published on your machine. For
   > px-torre-core's Sail containers to resolve that name on Linux, they need an `extra_hosts:
   > host.docker.internal:host-gateway` entry in px-torre-core's `docker-compose.yml` - check if
   > it's already there before adding it.

2. **Clear px-torre-core's config cache**, if it has one (`php artisan config:cache` was run at some
   point): `sail artisan config:clear`. Otherwise the new `.env` values won't be picked up.

3. **Point this mock back at px-torre-core.** In this repo's own `.env`, set
   `PX_TORRE_CORE_WEBHOOK_URL` to wherever px-torre-core's app is reachable from your machine. The
   default already assumes Sail's usual `8080:80` mapping - only change it if your px-torre-core
   setup uses a different port.

### Checking it actually works

Run these before trusting the full flow - each one should come back non-empty / with a status code,
proving the two sides can reach each other:

```bash
# the mock is up
curl http://localhost:4100/health

# px-torre-core's webhook route is reachable (405 is correct: this is a GET
# against a route that only accepts POST - it just proves the route exists)
curl -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/webhooks/documents/signature
```

Then do a real round-trip: create a document against the mock, `POST` to `/simulate/:documentId/sign`,
and look at the `webhook` field in the response:

- `"status":401` means the webhook *reached* px-torre-core, but its signature didn't match -
  double-check `WEBHOOK_SECRET` (here) and `AUTENTIQUE_WEBHOOK_SECRET` (there) are identical.
- `"status":200` means it worked: px-torre-core accepted the webhook.

Whether a specific driver/document actually gets updated afterwards depends on px-torre-core's own
local data (a seeded driver matching the `cpf` you send, the Autentique feature flag turned on for
that driver's company, etc.) - that part lives entirely in px-torre-core and has nothing to do with
this mock.

### Troubleshooting

| Symptom                                                   | Likely cause                                                                 |
|-------------------------------------------------------------|-------------------------------------------------------------------------------|
| `curl: (7) Failed to connect` to `localhost:4100`          | The mock isn't running - `docker compose up -d`.                            |
| Webhook `"delivered": false, "error": "fetch failed"`     | `PX_TORRE_CORE_WEBHOOK_URL` is wrong, or px-torre-core isn't running.        |
| Webhook `"status": 401`                                    | `WEBHOOK_SECRET` here doesn't match `AUTENTIQUE_WEBHOOK_SECRET` there.       |
| Files in `~/Downloads/autentique-mock/` owned by `root`    | `HOST_UID` / `HOST_GID` in `.env` don't match your real `id -u` / `id -g`.   |

## Project structure

```
src/
  server.js               entry point: routes, request dispatch
  store.js                in-memory "database" of created documents
  middleware/
    simulateTimeout.js     the SIMULATE_TIMEOUT behavior
  graphql/
    createDocument.js      createDocument mutation
    documentQuery.js       document query
    signDocument.js        signDocument mutation
  lib/
    errors.js               all error shapes, incl. X-Simulate-Error
    pdfStamp.js             builds the fake "SIMULATED" audit page
    signing.js              marks a document signed (stamp + save)
    webhook.js              builds and signs the signature.accepted webhook
    downloads.js            saves PDFs to ~/Downloads/autentique-mock/
```
