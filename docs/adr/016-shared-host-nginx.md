# ADR-016: Hosting on a shared host behind its nginx

## Status
Accepted. Supersedes the Caddy setup used on the previous, now-retired, server.

## Context
The backend moved to a shared Ubuntu 24.04 host (103.118.158.129, SSH on a
non-standard port) that already serves many unrelated projects. A host nginx
owns ports 80/443 and manages certificates with certbot; ports 3000, 5432,
6379 and 8000 are already taken by other projects. The previous server ran
Caddy on 80/443 and is gone (its test data was not migrated).

## Decision
- Compose project `posturepulse` (`infra/docker-compose.server.yml` over
  `infra/docker-compose.yml`). Only backend-api is published, on
  `127.0.0.1:3100`; postgres and ml-service stay on the compose network; the
  unused redis service is excluded. Each service has CPU/memory limits so it
  cannot starve the other projects.
- TLS and routing by the host nginx site `infra/nginx/posture.beaive.com.conf`
  (WebSocket upgrade for `/socket.io/`, 100 MB body limit for clip uploads,
  per-IP rate limit), certificate via `certbot --nginx`. Every change is
  applied with `nginx -t` before reload.
- Secrets (`POSTGRES_PASSWORD`, `JWT_SECRET`) live only in `infra/.env` on the
  host, mode 600.

## Consequences
- Deploys must not touch other projects' containers, ports or nginx sites;
  check them before and after each deploy.
- Sudo on the host needs a password; nginx/certbot steps are run deliberately,
  not by automated deploys.
- Encryption at rest is not configured on this host. Real subject data stays
  out until it is (docs/consent-and-retention.md).
