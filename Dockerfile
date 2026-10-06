FROM node:20-alpine AS build
WORKDIR /app
# Slow or flaky links: retry downloads patiently, and share one npm cache across
# stages and builds (BuildKit cache mount) so packages download only once.
ENV npm_config_fetch_retries=6     npm_config_fetch_retry_mintimeout=20000     npm_config_fetch_retry_maxtimeout=180000     npm_config_fetch_timeout=600000
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline
COPY . .
RUN npm run build

# One image runs both the portal (default) and the telemetry worker
# (`node workers/telemetryConsumer.js`). Configuration comes from environment
# variables only; src/app_config.json is a local-development fallback.
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production     npm_config_fetch_retries=6     npm_config_fetch_retry_mintimeout=20000     npm_config_fetch_retry_maxtimeout=180000     npm_config_fetch_timeout=600000
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --prefer-offline
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/services ./services
COPY --from=build /app/messaging ./messaging
COPY --from=build /app/workers ./workers
USER node
EXPOSE 3000
CMD ["node", "server.js"]
