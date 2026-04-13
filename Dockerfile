FROM node:22-slim

RUN apt-get update && apt-get install -y git openssh-client && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN npm ci && cd web && npm ci && cd .. \
    && npm run build \
    && npm pack && npm install -g kern-ai-*.tgz \
    && rm -rf /app

RUN useradd -m kern \
    && mkdir -p /home/kern/agent \
    && chown -R kern:kern /home/kern
USER kern
WORKDIR /home/kern/agent
VOLUME ["/home/kern/agent"]

EXPOSE 4100
ENV KERN_PORT=4100
CMD ["kern", "run", "--init-if-needed", "."]
