FROM node:22-slim

RUN useradd -m kern
RUN npm i -g kern-ai

USER kern
WORKDIR /home/kern/agent
EXPOSE 4100
ENV KERN_PORT=4100

ENTRYPOINT ["kern", "run", "--init-if-needed", "."]
