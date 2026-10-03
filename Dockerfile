# One image for both compose services: `app` (site + /api) and `bot` (npm run bot).
FROM node:22-bookworm-slim
WORKDIR /app

# devDependencies are needed at runtime too: tsx runs the server, vite/typescript build the site.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV HOST=0.0.0.0 PORT=8787 DB_PATH=/app/data/moneyflow.sqlite
EXPOSE 8787
CMD ["npm", "run", "start"]
