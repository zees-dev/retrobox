FROM oven/bun:latest AS base
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies (minimal - only types for dev)
RUN bun install --production

# Copy server and HTML files only
COPY server.ts ./
COPY *.html ./

EXPOSE 3333

CMD ["bun", "run", "server.ts"]
