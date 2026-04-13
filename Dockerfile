FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm run build:server \
    && npm pack \
    && npm install -g kern-ai-*.tgz \
    && rm -rf /app

RUN chown -R node:node /home/node
USER node
WORKDIR /home/node/agent

EXPOSE 4100
ENV KERN_PORT=4100
ENTRYPOINT ["kern", "run", "--init-if-needed", "."]
