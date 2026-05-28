FROM node:20-slim

# System deps for mupdf (PDF rendering) and sharp (image processing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev \
    libglib2.0-0 \
    libexpat1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install root deps first (mupdf, sharp, pdf-lib needed by shared pipeline)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Install worker deps
COPY worker/package.json worker/package-lock.json* ./worker/
RUN cd worker && npm install

# Copy shared source (the worker imports from ../src via tsconfig paths)
COPY src/ ./src/
COPY worker/ ./worker/
COPY tsconfig.json ./

WORKDIR /app/worker
CMD ["npm", "start"]
