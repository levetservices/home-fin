# Home Fin accounts service — no npm dependencies, just Node.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production \
    HOMEFIN_DB=/data/homefin.db \
    PORT=8097
VOLUME ["/data"]
EXPOSE 8097
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.mjs"]
