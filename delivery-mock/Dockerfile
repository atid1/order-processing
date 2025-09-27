FROM node:20-slim
WORKDIR /app

COPY package*.json ./
RUN npm install --only=production
COPY server.js ./

EXPOSE 4000
ENV NODE_ENV=production
ENV PORT=4000

CMD ["node", "server.js"]
