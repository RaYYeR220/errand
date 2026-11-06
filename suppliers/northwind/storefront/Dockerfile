# syntax=docker/dockerfile:1.7
# Northwind Supply storefront: Next.js storefront of the Medusa B2B starter plus
# the Northwind overlay (runtime config, contract pricing display, PO checkout).
ARG NODE_IMAGE=node:20.20.2-bookworm-slim

FROM ${NODE_IMAGE} AS starter
ARG STARTER_REF=e7358f11e9fca8d8069b16f4c0d84f4fec9e50e8
ADD --keep-git-dir=false https://github.com/medusajs/b2b-starter-medusa.git#${STARTER_REF} /starter

FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN corepack enable
COPY --from=starter /starter/storefront/ ./
# Same Yarn checksum caveat as the backend image; versions come from yarn.lock.
RUN yarn install
COPY . ./
RUN node tools/prepare-starter.mjs . && yarn build

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:8000/favicon.ico').then(()=>process.exit(0)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
