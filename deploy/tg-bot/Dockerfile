FROM node:20-slim

WORKDIR /app

COPY tg-bot/package.json tg-bot/yarn.lock* ./
RUN npm install --production 2>/dev/null || yarn install --production

COPY tg-bot/bot.js ./

CMD ["node", "bot.js"]
