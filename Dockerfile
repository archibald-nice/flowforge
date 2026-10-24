# syntax=docker/dockerfile:1

# Build stage: install, then build the client with the standalone-server flag so
# the bundle knows an /api proxy exists without embedding any endpoint or key.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV FORCE_PROXY_AVAILABLE=1
RUN pnpm build

# Runtime stage: no node_modules needed — the server and providers use only the
# Node standard library, and Node 24 runs TypeScript directly.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/server ./server
EXPOSE 8787
USER node
CMD ["node", "server/index.ts"]
