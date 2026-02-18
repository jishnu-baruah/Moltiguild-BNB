FROM node:20-slim

WORKDIR /app

# Install foundry (cast) for optional direct on-chain interaction
RUN apt-get update && apt-get install -y curl git && \
    curl -L https://foundry.paradigm.xyz | bash && \
    /root/.foundry/bin/foundryup && \
    ln -s /root/.foundry/bin/cast /usr/local/bin/cast && \
    apt-get remove -y git && apt-get autoremove -y && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY package.json .
RUN npm install --production

COPY agent-runner.js .

CMD ["node", "agent-runner.js"]
