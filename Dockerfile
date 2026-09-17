FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY src ./src
COPY tsconfig.json ./
RUN npm run build
COPY src/dashboard/index.html ./dist/dashboard/index.html
COPY src/dashboard/assets/styles.css ./dist/dashboard/assets/styles.css

EXPOSE 4000

CMD ["node", "dist/server.js"]
