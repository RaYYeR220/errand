#!/usr/bin/env bash
# Deploy the Errand control plane (web app + orchestrator + microVM sandboxes) to the VX1 host.
#   infra/deploy-control.sh <control-host-ip> <supplier-host-ip>
# Reads VULTR_INFERENCE_API_KEY from the environment; supplier buyer passwords are copied
# host-to-host and never printed.
set -euo pipefail

HOST="${1:?usage: deploy-control.sh <control-ip> <supplier-ip>}"
SUPPLIER_HOST="${2:?usage: deploy-control.sh <control-ip> <supplier-ip>}"
KEY="${SSH_KEY:-$HOME/.ssh/errand_vultr}"
: "${VULTR_INFERENCE_API_KEY:?set VULTR_INFERENCE_API_KEY}"
ERRAND_HOST="errand.${HOST//./-}.sslip.io"
SUPPLIER_DOMAIN="${SUPPLIER_HOST//./-}.sslip.io"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "root@$HOST")

cd "$(dirname "$0")/.."

echo "deploy: copying the committed tree to $HOST"
git archive --format=tar HEAD | "${SSH[@]}" "mkdir -p /opt/errand.new && tar -xf - -C /opt/errand.new \
  && rsync -a --delete --exclude node_modules --exclude .next /opt/errand.new/ /opt/errand/ && rm -rf /opt/errand.new \
  && chown -R errand:errand /opt/errand && mkdir -p /var/lib/errand /etc/errand && chown errand:errand /var/lib/errand"

echo "deploy: writing /etc/errand/errand.env"
SUPPLIER_SECRETS="$(ssh -i "$KEY" "root@$SUPPLIER_HOST" "grep -E '^(NORTHWIND_BUYER_PASSWORD|ACME_BUYER_PASSWORD)=' /opt/errand/suppliers/.env")"
{
  echo "NODE_ENV=production"
  echo "PORT=4000"
  echo "DATA_DIR=/var/lib/errand"
  echo "PUBLIC_URL=https://$ERRAND_HOST"
  echo "WEB_ORIGIN=https://$ERRAND_HOST"
  echo "INFERENCE_API_KEY=$VULTR_INFERENCE_API_KEY"
  echo "SUPPLIERS_FILE=/opt/errand/suppliers/suppliers.json"
  echo "BASE_DOMAIN=$SUPPLIER_DOMAIN"
  echo "MAX_CONCURRENT_RUNS=1"
  echo "ADMIN_TOKEN=$(openssl rand -hex 24)"
  echo "MCP_TOKEN=$(openssl rand -hex 24)"
  echo "$SUPPLIER_SECRETS"
} | "${SSH[@]}" "umask 077 && cat > /etc/errand/errand.env && chown root:errand /etc/errand/errand.env && chmod 640 /etc/errand/errand.env"

echo "deploy: installing dependencies and building"
"${SSH[@]}" "su - errand -c 'cd /opt/errand && pnpm install --frozen-lockfile && pnpm -r build'"

echo "deploy: services and TLS"
"${SSH[@]}" "cp /opt/errand/infra/control/errand-*.service /etc/systemd/system/ \
  && sed 's/{\$ERRAND_HOST}/$ERRAND_HOST/' /opt/errand/infra/control/Caddyfile.template > /etc/caddy/Caddyfile \
  && systemctl daemon-reload && systemctl enable --now errand-orchestrator errand-web && systemctl restart errand-orchestrator errand-web && systemctl reload caddy"

echo "deploy: done — https://$ERRAND_HOST"
