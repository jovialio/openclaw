FROM node:22-bookworm

# Install Bun (required for build scripts)
# RUN curl -fsSL https://bun.sh/install | bash

# Guide for docker setup
# cat .openclaw/openclaw.json
# Grab token and paste into control ui
# # run the following command to list the device
# docker compose exec -T \
#   -e OPENCLAW_GATEWAY_TOKEN=<token> \
#   openclaw-gateway \
#   node dist/index.js devices list
# # Then approve the device
# docker compose exec -T \
#   -e OPENCLAW_GATEWAY_TOKEN=<token> \
#   openclaw-gateway \
#   node dist/index.js devices approve <REQUEST_ID>

# Base OS deps to replicate the host dev environment inside Docker.
# Includes:
# - tmux (dev-tmux.sh)
# - python/pip (helper scripts)
# - git/curl/jq/rsync/unzip (ops/debug)
# - redis-server (celery local default; you can still use a separate redis container)
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates \
      vim \
      nano \
      curl \
      git \
      jq \
      rsync \
      tmux \
      unzip \
      zip \
      procps \
      lsof \
      netcat-openbsd \
      python3 \
      python3-pip \
      python3-venv \
      redis-server \
      build-essential \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Vendor uv release asset in repo
COPY uv-x86_64-unknown-linux-gnu.tar /tmp/uv.tar

RUN set -eux; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates; \
    mkdir -p /tmp/uv; \
    tar -xf /tmp/uv.tar -C /tmp/uv; \
    install -m 0755 /tmp/uv/uv-x86_64-unknown-linux-gnu/uv  /usr/local/bin/uv; \
    install -m 0755 /tmp/uv/uv-x86_64-unknown-linux-gnu/uvx /usr/local/bin/uvx; \
    rm -rf /tmp/uv /tmp/uv.tar; \
    rm -rf /var/lib/apt/lists/*

# Install Bun from vendored zip (no network needed here)
COPY bun-linux-x64.zip /tmp/bun-linux-x64.zip

RUN apt-get update \
  && apt-get install -y --no-install-recommends unzip \
  && mkdir -p /root/.bun/bin \
  && unzip /tmp/bun-linux-x64.zip -d /tmp/bun \
  && mv /tmp/bun/bun-linux-x64/bun /root/.bun/bin/bun \
  && chmod +x /root/.bun/bin/bun \
  && rm -rf /tmp/bun /tmp/bun-linux-x64.zip \
  && apt-get purge -y unzip \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
  
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

ENV NODE_ENV=production

# Allow non-root user to write temp files during runtime/tests.
RUN chown -R node:node /app

# Security hardening: Run as non-root user
# The node:22-bookworm image includes a 'node' user (uid 1000)
# This reduces the attack surface by preventing container escape via root privileges
USER node

# Start gateway server with default config.
# Binds to loopback (127.0.0.1) by default for security.
#
# For container platforms requiring external health checks:
#   1. Set OPENCLAW_GATEWAY_TOKEN or OPENCLAW_GATEWAY_PASSWORD env var
#   2. Override CMD: ["node","openclaw.mjs","gateway","--allow-unconfigured","--bind","lan"]
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
