FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# One image runs both the portal (default) and the telemetry worker
# (`node workers/telemetryConsumer.js`). Configuration comes from environment
# variables only; src/app_config.json is a local-development fallback.
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/services ./services
COPY --from=build /app/messaging ./messaging
COPY --from=build /app/workers ./workers
USER node
EXPOSE 3000
CMD ["node", "server.js"]
