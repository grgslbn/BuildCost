FROM node:20-slim

# mupdf native deps (for PDF rendering)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install worker deps
COPY worker/package.json worker/package-lock.json* ./worker/
RUN cd worker && npm install

# Copy shared source (the worker imports from ../src via tsconfig paths)
COPY src/ ./src/
COPY worker/ ./worker/
COPY package.json tsconfig.json ./

# Install root deps (needed for shared imports)
RUN npm install --omit=dev

WORKDIR /app/worker
CMD ["npm", "start"]
