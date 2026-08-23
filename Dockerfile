FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ make gdb python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY vite.config.js index.html ./
COPY src ./src
COPY server ./server
RUN npm run build

ENV PORT=4173 \
    CVIS_HOST=0.0.0.0 \
    CVIS_RUNTIME_MODE=docker \
    CVIS_WORKSPACE_ROOT=/workspace/projects \
    CVIS_TRACE_LIMIT=5000 \
    CVIS_GDB_STOP_TIMEOUT_MS=30000 \
    CVIS_MAX_UPLOAD_BYTES=36700160

EXPOSE 4173
CMD ["npm", "start"]
