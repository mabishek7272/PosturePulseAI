# Build context is the repo root (see infra/docker-compose.yml) because this
# service depends on packages/schemas/generated/python (beaive-schemas).
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      libegl1 libgles2 libgl1 libgl1-mesa-dri libglx-mesa0 libgbm1 libglib2.0-0 \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY packages/schemas/generated/python /srv/packages/schemas/generated/python
COPY services/ml-service /srv/services/ml-service

# app/main.py imports app/detection and app/movement unconditionally, so both
# torch extras are required at runtime. CPU wheels: these models are small.
# PyAV (clip decoding, HEVC included in its bundled FFmpeg) comes in through
# pyproject's base dependencies.
RUN pip install --no-cache-dir -e /srv/packages/schemas/generated/python \
    && pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
         -e "/srv/services/ml-service[detection,movement]"

WORKDIR /srv/services/ml-service
# Fetches both the lite (per-frame) and full (clip analysis) models.
RUN bash scripts/fetch-pose-model.sh

# Shared clip volume (mounted by infra; backend-api writes clips here and this
# service writes landmark series under landmarks/).
ENV CLIP_DIR=/data/clips

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
