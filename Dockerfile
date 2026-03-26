FROM node:22-slim AS builder

WORKDIR /opt/kern-ai
COPY package.json package-lock.json ./
RUN npm ci
COPY src/ src/
COPY tsconfig.json ./
COPY templates/ templates/
RUN npx tsc

FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /opt/kern-ai
COPY --from=builder /opt/kern-ai/dist/ dist/
COPY --from=builder /opt/kern-ai/package.json .
COPY --from=builder /opt/kern-ai/package-lock.json .
COPY --from=builder /opt/kern-ai/templates/ templates/
RUN npm ci --omit=dev && npm link

# Agent directory — mount or copy your agent folder here
WORKDIR /agent

ENTRYPOINT ["kern"]
CMD ["daemon", "/agent"]
