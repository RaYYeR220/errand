#!/usr/bin/env bash
# Tops both stores' stock back up to the catalog numbers, so a public demo keeps
# its reference answer after buyers place orders. Stock only; prices, products
# and accounts are untouched. Run from cron on the supplier host:
#
#   */5 * * * * root /opt/errand/suppliers/scripts/restock.sh >> /var/log/errand-restock.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

echo "restock: $(date -u +%FT%TZ)"
docker compose exec -T northwind-backend /app/docker-entrypoint.sh restock 2>&1 | grep -E 'restock' || true
docker compose exec -T acme wp --path=/var/www/html --allow-root eval-file /usr/local/share/acme/restock.php 2>&1 | grep -E 'restock' || true
