FROM node:20-slim

WORKDIR /app

COPY scripts/package.json ./
RUN npm install --production

COPY scripts/agent-worker.js scripts/monad.js ./

EXPOSE 10000
CMD ["node", "agent-worker.js"]
