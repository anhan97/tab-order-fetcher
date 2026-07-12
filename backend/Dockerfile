# Backend: Express + Prisma (PostgreSQL)
# Build: tsc → dist, prisma client generated in-image.
# Start: apply pending migrations, then run the server.

FROM node:20-slim AS build
WORKDIR /app
# Prisma engines need OpenSSL on slim images
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json server.ts ./
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl curl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
# Full node_modules from the builder: the generated Prisma client lives there,
# and the prisma CLI (devDep) is needed at boot for `migrate deploy`.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY package.json ./

EXPOSE 3001
# Migrations first so a fresh Postgres container bootstraps itself.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
