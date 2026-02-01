FROM oven/bun:alpine
WORKDIR /app

# Copy server and HTML files only
COPY server.ts ./
COPY *.html *.js ./
COPY deps ./deps/


EXPOSE 3333

CMD ["bun", "run", "server.ts"]
