# Build context is the repo root (see infra/docker-compose.yml) because this
# service depends on packages/schemas (npm workspace) and protocols/*.json.
FROM node:22-slim

# Prisma's query/schema engines need libssl at runtime; the slim image lacks it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY package.json /srv/package.json
COPY packages/schemas /srv/packages/schemas
COPY services/backend-api /srv/services/backend-api
COPY protocols /srv/protocols

RUN npm install --workspaces --include-workspace-root --no-audit --no-fund \
    && npx prisma generate --schema services/backend-api/prisma/schema.prisma

WORKDIR /srv/services/backend-api
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node -r ts-node/register/transpile-only src/main.ts"]
