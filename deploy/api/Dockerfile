FROM node:20-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only what the API needs
COPY scripts/package.json ./
RUN npm install --omit=dev 2>/dev/null || yarn install --production

COPY scripts/api.js scripts/monad.js scripts/coordinator.js scripts/guild-matcher.js scripts/world-state.js ./

# Static district map (generated once, committed to repo)
# Stored at /app/data/ — the entrypoint copies it to DATA_DIR at runtime
# so it survives Docker volume mounts that overlay /data
RUN mkdir -p /app/data /data
COPY data/district-map.json /app/data/

EXPOSE 3001

# Copy district-map.json into DATA_DIR at startup (volume may be empty)
CMD ["sh", "-c", "cp -n /app/data/district-map.json ${DATA_DIR:-/app/data}/district-map.json 2>/dev/null; exec node api.js"]
