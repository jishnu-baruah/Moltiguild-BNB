FROM node:20-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only what the API needs
COPY scripts/package.json ./
RUN npm install --production

COPY scripts/api.js scripts/monad.js scripts/coordinator.js scripts/guild-matcher.js scripts/world-state.js ./

# Data directory + static district map (generated once, committed to repo)
RUN mkdir -p /app/data
COPY data/district-map.json /app/data/
ENV DATA_DIR=/app/data

EXPOSE 3001

CMD ["node", "api.js"]
