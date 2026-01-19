FROM oven/bun:alpine
WORKDIR /app

# Copy server and HTML files only
COPY server.ts ./
COPY *.html ./

EXPOSE 3333

CMD ["bun", "run", "server.ts"]
