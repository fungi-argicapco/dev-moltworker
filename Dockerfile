FROM docker.io/cloudflare/sandbox:0.7.0

# Install Node.js 22 (required by OpenClaw)
# The base image has Node 20, we need to replace it with Node 22
# Using direct binary download for reliability
ENV NODE_VERSION=22.13.1
RUN ARCH="$(dpkg --print-architecture)" \
    && case "${ARCH}" in \
         amd64) NODE_ARCH="x64" ;; \
         arm64) NODE_ARCH="arm64" ;; \
         *) echo "Unsupported architecture: ${ARCH}" >&2; exit 1 ;; \
       esac \
    && apt-get update && apt-get install -y xz-utils ca-certificates \
    && curl -fsSLk https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && node --version \
    && npm --version

# Install pnpm globally
RUN npm install -g pnpm

# Install OpenClaw (formerly clawdbot/moltbot)
# Pin to specific version for reproducible builds
RUN npm install -g openclaw@2026.2.3 \
    && openclaw --version

# Create OpenClaw directories
# Legacy .clawdbot paths are kept for R2 backup migration
RUN mkdir -p /root/.openclaw \
    && mkdir -p /root/clawd \
    && mkdir -p /root/clawd/skills

# ============================================================
# MULTI-TENANT SUPPORT
# All client workspaces are baked into the image.
# At runtime, AGENT_MODE + CLIENT_NAME env vars (set via wrangler
# secrets) determine which workspace files start-openclaw.sh loads.
#   AGENT_MODE=omega (default)  → Omega orchestrator
#   AGENT_MODE=client           → Client agent (requires CLIENT_NAME)
# ============================================================

# Copy startup script
# Build cache bust: 2026-02-27-v42-multi-tenant-platforms
COPY start-openclaw.sh /usr/local/bin/start-openclaw.sh
RUN chmod +x /usr/local/bin/start-openclaw.sh

# Copy custom skills (ClawHub and legacy)
COPY skills/ /root/clawd/skills/

# Copy agents (skills library — available to all containers)
COPY agents/ /root/clawd/agents/

# Copy Omega workspace (default)
COPY SOUL.md /root/clawd/SOUL.md
COPY workspace/ /root/clawd/

# Copy all client workspaces (selected at runtime via CLIENT_NAME)
COPY clients/ /root/clawd/clients/

# Default agent mode: omega (override at deploy time for clients)
ENV AGENT_MODE=omega
ENV CLIENT_NAME=""

# Set working directory
WORKDIR /root/clawd

# Expose the gateway port
EXPOSE 18789
