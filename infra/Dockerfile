# OpenClaw gateway container
# Clones the openclaw repo and builds from source

FROM node:22-bookworm AS builder

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"
RUN corepack enable

WORKDIR /app

# Clone openclaw pinned to v2026.2.9 (v2026.2.18 has model discovery regression)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN git clone --branch v2026.2.9 --depth 1 https://github.com/openclaw/openclaw.git .

RUN pnpm install --frozen-lockfile
RUN OPENCLAW_A2UI_SKIP_MISSING=1 pnpm build
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

# --- Runtime ---
FROM node:22-bookworm-slim AS runner

RUN apt-get update && apt-get install -y curl jq && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY --from=builder /app /app

# Copy entrypoint that writes config + starts gateway (fix Windows CRLF)
COPY infra/entrypoint.sh /app/entrypoint.sh
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Config will be written by entrypoint from env or mounted volume
RUN mkdir -p /app/skills /root/.openclaw

ENV NODE_ENV=production
ENV OPENCLAW_CONFIG_PATH=/app/openclaw.config.json

EXPOSE 18789

ENTRYPOINT ["/app/entrypoint.sh"]
