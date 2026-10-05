FROM node:22-bookworm-slim

ARG OPENCODE_VERSION=1.18.34

# git + GitHub CLI (gh is used by the agent for PRs) + common tooling the agent expects
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates openssh-client ripgrep build-essential python3 \
 && mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g opencode-ai@${OPENCODE_VERSION}

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src
COPY public ./public

# non-root; /workspaces and home are ephemeral by design
RUN useradd -m -u 1001 app && mkdir /workspaces && chown app:app /workspaces
USER app
ENV HOME=/home/app WORKSPACES_DIR=/workspaces PORT=8080

EXPOSE 8080
CMD ["node", "src/server.js"]
