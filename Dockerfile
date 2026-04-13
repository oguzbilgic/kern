FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm ci \
    && cd web && npm ci && cd .. \
    && npm run build \
    && npm pack \
    && npm install -g kern-ai-*.tgz \
    && rm -rf /app

RUN useradd -m kern
USER kern
WORKDIR /home/kern/agent

EXPOSE 4100
ENV KERN_PORT=4100
ENTRYPOINT ["kern", "run", "--init-if-needed", "."]
