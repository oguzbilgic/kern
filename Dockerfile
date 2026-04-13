# Multi-stage build: compile TypeScript, prune dev deps, copy minimal runtime.

# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:server
RUN npm prune --production

# ── Stage 2: Runtime ────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json .
COPY --from=build /app/templates ./templates

# Expose CLI globally via symlink
RUN ln -sf /app/dist/index.js /usr/local/bin/kern \
    && chmod 755 /app/dist/index.js

RUN chown -R node:node /app
USER node

WORKDIR /home/node/agent
EXPOSE 4100
ENV KERN_PORT=4100

ENTRYPOINT ["kern", "run", "--init-if-needed", "."]
