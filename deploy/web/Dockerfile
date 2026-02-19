# Multi-stage build for Next.js standalone output
# Build context: repo root

# --- Stage 1: Install dependencies ---
FROM node:20-slim AS deps
WORKDIR /app/web
COPY web/package.json web/yarn.lock* ./
RUN yarn install --frozen-lockfile 2>/dev/null || yarn install

# --- Stage 2: Build Next.js ---
FROM node:20-slim AS builder
WORKDIR /app/web

COPY --from=deps /app/web/node_modules ./node_modules
COPY web/ ./

# These must be available at build time for Next.js to inline them
ARG NEXT_PUBLIC_CHAIN_ID=97
ARG NEXT_PUBLIC_GUILD_REGISTRY_ADDRESS
ARG NEXT_PUBLIC_GOLDSKY_ENDPOINT
ARG NEXT_PUBLIC_MONAD_RPC=https://data-seed-prebsc-1-s1.bnbchain.org:8545
ARG NEXT_PUBLIC_EXPLORER_URL=https://testnet.bscscan.com
ARG NEXT_PUBLIC_API_URL

ENV NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID
ENV NEXT_PUBLIC_GUILD_REGISTRY_ADDRESS=$NEXT_PUBLIC_GUILD_REGISTRY_ADDRESS
ENV NEXT_PUBLIC_GOLDSKY_ENDPOINT=$NEXT_PUBLIC_GOLDSKY_ENDPOINT
ENV NEXT_PUBLIC_MONAD_RPC=$NEXT_PUBLIC_MONAD_RPC
ENV NEXT_PUBLIC_EXPLORER_URL=$NEXT_PUBLIC_EXPLORER_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN yarn build

# --- Stage 3: Production runtime ---
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy standalone server + static assets
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./.next/static
COPY --from=builder /app/web/public ./public

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
