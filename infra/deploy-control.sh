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
git archive --format=tar HEAD | "${SSH[@]}" "rm -rf /opt/errand.new && mkdir -p /opt/errand.new && tar -xf - -C /opt/errand.new"

# System files come from the root-owned copy, before the service account touches the tree.
echo "deploy: installing service units and TLS config"
"${SSH[@]}" "install -m 644 /opt/errand.new/infra/control/errand-orchestrator.service /opt/errand.new/infra/control/errand-web.service /etc/systemd/system/ \
  && sed 's/{\$ERRAND_HOST}/$ERRAND_HOST/' /opt/errand.new/infra/control/Caddyfile.template > /etc/caddy/Caddyfile \
  && systemctl daemon-reload"

echo "deploy: handing the tree to the service account"
"${SSH[@]}" "mkdir -p /opt/errand && rsync -a --delete --exclude node_modules --exclude .next --exclude dist /opt/errand.new/ /opt/errand/ \
  && rm -rf /opt/errand.new && chown -R errand:errand /opt/errand \
  && mkdir -p /var/lib/errand /etc/errand && chown errand:errand /var/lib/errand"

echo "deploy: writing /etc/errand/errand.env"
SUPPLIER_SECRETS="$(ssh -i "$KEY" "root@$SUPPLIER_HOST" "grep -E '^(NORTHWIND|ACME)_BUYER[0-9]*_PASSWORD=' /opt/errand/suppliers/.env")"
EXISTING_TOKENS="$("${SSH[@]}" "grep -E '^(ADMIN_TOKEN|MCP_TOKEN)=' /etc/errand/errand.env 2>/dev/null || true")"
{
  echo "NODE_ENV=production"
  echo "PORT=4000"
  echo "DATA_DIR=/var/lib/errand"
  echo "PUBLIC_URL=https://$ERRAND_HOST"
  echo "WEB_ORIGIN=https://$ERRAND_HOST"
  echo "INFERENCE_API_KEY=$VULTR_INFERENCE_API_KEY"
  echo "SUPPLIERS_FILE=/opt/errand/suppliers/suppliers.json"
  echo "BASE_DOMAIN=$SUPPLIER_DOMAIN"
  echo "MAX_CONCURRENT_RUNS=${MAX_CONCURRENT_RUNS:-3}"
  if [ -n "$EXISTING_TOKENS" ]; then echo "$EXISTING_TOKENS"; else
    echo "ADMIN_TOKEN=$(openssl rand -hex 24)"
    echo "MCP_TOKEN=$(openssl rand -hex 24)"
  fi
  echo "$SUPPLIER_SECRETS"
} | "${SSH[@]}" "umask 077 && cat > /etc/errand/errand.env && chown root:errand /etc/errand/errand.env && chmod 640 /etc/errand/errand.env"

echo "deploy: installing dependencies and building (as the service account)"
"${SSH[@]}" "su - errand -c 'cd /opt/errand && pnpm install --frozen-lockfile && pnpm -r build'"

echo "deploy: starting services"
"${SSH[@]}" "systemctl enable --now errand-orchestrator errand-web && systemctl restart errand-orchestrator errand-web && systemctl reload caddy"

echo "deploy: done — https://$ERRAND_HOST"
