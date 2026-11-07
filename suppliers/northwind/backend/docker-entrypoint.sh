#!/bin/sh
# Runs database migrations, then the Medusa server.
#   start  - migrate and serve (default)
#   seed   - load the Northwind catalog, buyer company and contract pricing
#   restock - top stock back up to the catalog numbers (stock only)
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
  restock)
    exec ./node_modules/.bin/medusa exec ./src/scripts/restock-northwind.js
    ;;
  *)
    exec "$@"
    ;;
esac
