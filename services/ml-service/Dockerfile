# Build context is the repo root (see infra/docker-compose.yml) because this
# service depends on packages/schemas/generated/python (beaive-schemas).
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      libegl1 libgles2 libgl1-mesa-dri libglx-mesa0 libgbm1 \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY packages/schemas/generated/python /srv/packages/schemas/generated/python
COPY services/ml-service /srv/services/ml-service

RUN pip install --no-cache-dir -e /srv/packages/schemas/generated/python \
    && pip install --no-cache-dir -e /srv/services/ml-service

WORKDIR /srv/services/ml-service
RUN bash scripts/fetch-pose-model.sh

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
