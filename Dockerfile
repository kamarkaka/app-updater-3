# Stage 1: Build frontend
FROM node:20-bookworm AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM node:20-bookworm AS backend-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npx tsc

# Stage 3: Production image
FROM node:20-bookworm

# Install Chromium dependencies for Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxss1 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Mirror dev layout: /app/backend/{dist,drizzle,node_modules} + /app/frontend/dist
WORKDIR /app/backend

# Install production backend dependencies
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled backend + migrations
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/drizzle ./drizzle

# Copy built frontend (sibling of backend, matching dev layout)
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# Create data directory
RUN mkdir -p /data/downloads

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
