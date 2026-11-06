#!/bin/sh
# Runs database migrations, then the Medusa server.
#   start  - migrate and serve (default)
#   seed   - load the Northwind catalog, buyer company and contract pricing
set -eu
cd /app/.medusa/server

case "${1:-start}" in
  start)
    ./node_modules/.bin/medusa db:migrate
    exec ./node_modules/.bin/medusa start
    ;;
  seed)
    exec ./node_modules/.bin/medusa exec ./src/scripts/seed-northwind.js
    ;;
  *)
    exec "$@"
    ;;
esac
