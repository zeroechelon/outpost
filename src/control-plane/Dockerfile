# Outpost V2 Control Plane Service
# Multi-stage build for production optimization

# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# Production stage
FROM node:22-alpine AS production

# Set production environment
ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup -g 1001 -S outpost && \
    adduser -S outpost -u 1001 -G outpost

WORKDIR /app

# Copy built assets from builder
COPY --from=builder --chown=outpost:outpost /app/dist ./dist
COPY --from=builder --chown=outpost:outpost /app/node_modules ./node_modules
COPY --from=builder --chown=outpost:outpost /app/package.json ./

# Switch to non-root user
USER outpost

# Expose application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start application
CMD ["node", "dist/index.js"]
