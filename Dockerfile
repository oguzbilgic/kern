FROM node:22-slim

RUN useradd -m kern

COPY . /tmp/kern-src
RUN cd /tmp/kern-src && npm ci && npm run build:server && npm pack && npm i -g kern-ai-*.tgz && rm -rf /tmp/kern-src

USER kern
WORKDIR /home/kern/agent
EXPOSE 4100
ENV KERN_PORT=4100

ENTRYPOINT ["kern", "run", "--init-if-needed", "."]
