# syntax=docker/dockerfile:1.7
# Northwind Supply backend: Medusa v2 B2B starter plus the Northwind overlay
# (config, seed, contract-pricing hooks). The upstream starter is pinned to a
# commit; files in this directory replace or extend it.
ARG NODE_IMAGE=node:20.20.2-bookworm-slim

FROM ${NODE_IMAGE} AS starter
ARG STARTER_REF=e7358f11e9fca8d8069b16f4c0d84f4fec9e50e8
ADD --keep-git-dir=false https://github.com/medusajs/b2b-starter-medusa.git#${STARTER_REF} /starter

FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_OPTIONS=--max-old-space-size=4096 \
    MEDUSA_DISABLE_TELEMETRY=true
WORKDIR /app
RUN corepack enable
COPY --from=starter /starter/backend/ ./
# The lockfile pins every package; only the TypeScript compat-patch checksum
# differs between Yarn releases, so the install is not run with --immutable.
RUN yarn install
COPY . ./
RUN yarn build \
 && ln -s /app/node_modules /app/.medusa/server/node_modules

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    MEDUSA_DISABLE_TELEMETRY=true \
    PORT=9000
WORKDIR /app/.medusa/server
COPY --from=build /app /app
RUN chmod +x /app/docker-entrypoint.sh
EXPOSE 9000
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=30 \
  CMD node -e "fetch('http://127.0.0.1:9000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["start"]
