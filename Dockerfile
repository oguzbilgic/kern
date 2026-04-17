FROM ubuntu:24.04

# System packages
RUN apt-get update && apt-get install -y \
    curl wget jq git openssh-client \
    python3 python3-pip \
    unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22 via NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Build kern from source
WORKDIR /app
COPY . .
RUN npm ci && cd web && npm ci && cd .. \
    && npm run build \
    && npm pack && npm install -g kern-ai-*.tgz \
    && rm -rf /app

# Create non-root user with user-space package paths
RUN useradd -m kern \
    && mkdir -p /home/kern/agent /home/kern/.npm-global /home/kern/.local \
    && chown -R kern:kern /home/kern

USER kern

# npm global installs to user space
ENV NPM_CONFIG_PREFIX=/home/kern/.npm-global
# pip installs to user space
ENV PIP_USER=1
ENV PIP_BREAK_SYSTEM_PACKAGES=1
# All user-space binaries on PATH
ENV PATH=/home/kern/.npm-global/bin:/home/kern/.local/bin:$PATH

WORKDIR /home/kern/agent

EXPOSE 4100
ENV KERN_PORT=4100
CMD ["kern", "run", "--init-if-needed", "."]
