FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ make gdb python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

ENV PORT=4173 \
    CVIS_SOURCE_DIR=/workspace/source \
    CVIS_RUNTIME_DIR=/workspace/run \
    CVIS_EXECUTABLE=./push_swap \
    CVIS_ADAPTER=push_swap

EXPOSE 4173
CMD ["npm", "start"]
