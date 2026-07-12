# Frontend: Vite build → static files served by nginx, /api proxied to backend.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# VITE_* vars are baked at build time (FB App ID etc.). Pass overrides:
#   docker compose build --build-arg VITE_FACEBOOK_APP_ID=...
ARG VITE_FACEBOOK_APP_ID=
ENV VITE_FACEBOOK_APP_ID=$VITE_FACEBOOK_APP_ID
RUN npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
