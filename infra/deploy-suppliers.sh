#!/usr/bin/env bash
# Deploy the demo supplier network to its Vultr host.
#   infra/deploy-suppliers.sh <supplier-host-ip>
set -euo pipefail

HOST="${1:?usage: deploy-suppliers.sh <supplier-host-ip>}"
KEY="${SSH_KEY:-$HOME/.ssh/errand_vultr}"
DOMAIN="${HOST//./-}.sslip.io"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "root@$HOST")

cd "$(dirname "$0")/.."

echo "deploy: copying suppliers/ to $HOST"
tar --exclude=node_modules --exclude=smoke-artifacts --exclude=.env --exclude=.next -czf - suppliers \
  | "${SSH[@]}" "mkdir -p /opt/errand && tar -xzf - -C /opt/errand"

echo "deploy: configuring for $DOMAIN (Let's Encrypt via Caddy)"
"${SSH[@]}" "cd /opt/errand/suppliers && chmod +x scripts/*.sh && scripts/init-env.sh >/dev/null \
  && sed -i 's/^BASE_DOMAIN=.*/BASE_DOMAIN=$DOMAIN/; s/^CADDY_GLOBAL_OPTIONS=.*/CADDY_GLOBAL_OPTIONS=/' .env"

echo "deploy: building and starting containers"
"${SSH[@]}" "cd /opt/errand/suppliers && docker compose up -d --build"

echo "deploy: seeding catalog, prices and buyer accounts"
"${SSH[@]}" "cd /opt/errand/suppliers && scripts/seed.sh"

echo "deploy: restock every 5 minutes (stock only), so the public demo keeps its reference answer"
"${SSH[@]}" "chmod +x /opt/errand/suppliers/scripts/restock.sh && printf '%s\n' '*/5 * * * * root /opt/errand/suppliers/scripts/restock.sh >> /var/log/errand-restock.log 2>&1' > /etc/cron.d/errand-restock && chmod 644 /etc/cron.d/errand-restock"

echo "deploy: done — https://northwind.$DOMAIN  https://acme.$DOMAIN"
