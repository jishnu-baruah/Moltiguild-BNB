FROM node:22-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app/scripts

# Copy package files and install deps
COPY scripts/package.json scripts/yarn.lock* ./
RUN yarn install --production 2>/dev/null || npm install --omit=dev

# Copy scripts
COPY scripts/monad.js scripts/agent-fleet.js scripts/seeder.js scripts/guild-matcher.js ./

# Data directory for seeder state
RUN mkdir -p /app/data

WORKDIR /app/scripts
ENTRYPOINT ["node", "agent-fleet.js"]
