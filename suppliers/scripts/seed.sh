#!/usr/bin/env bash
# Seeds both suppliers from catalog/catalog.json: catalog, stock, contract price
# lists, shipping, payment terms, the Lumen Labs buyer accounts and the admin
# users. Safe to run repeatedly; stock and contract prices are reset each time.
#
#   scripts/seed.sh              # both suppliers
#   scripts/seed.sh northwind    # one supplier
set -euo pipefail

cd "$(dirname "$0")/.."
# Git Bash on Windows would otherwise rewrite container paths such as /app.
export MSYS_NO_PATHCONV=1

set -a
# shellcheck disable=SC1091
. ./.env
set +a

wait_healthy() {
  local service="$1" container status
  container="$(docker compose ps -q "$service")"
  if [[ -z "$container" ]]; then
    echo "seed: $service is not running; start it with 'docker compose up -d'" >&2
    exit 1
  fi
  for _ in $(seq 1 90); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$container")"
    [[ "$status" == "healthy" ]] && return 0
    sleep 2
  done
  echo "seed: $service did not become healthy" >&2
  exit 1
}

seed_northwind() {
  wait_healthy northwind-backend
  echo "seed: Northwind Supply"
  docker compose exec -T northwind-backend /app/docker-entrypoint.sh seed
  # The pricing module caches known rule attributes per process; a restart
  # picks up tier rules for newly added variants.
  docker compose restart northwind-backend >/dev/null
  wait_healthy northwind-backend
}

seed_acme() {
  wait_healthy acme
  echo "seed: Acme Office & Tech"
  docker compose exec -T acme acme-seed
}

targets=("$@")
[[ ${#targets[@]} -eq 0 ]] && targets=(northwind acme)

for target in "${targets[@]}"; do
  case "$target" in
    northwind) seed_northwind ;;
    acme) seed_acme ;;
    *) echo "seed: unknown supplier '$target'" >&2; exit 1 ;;
  esac
done

scheme="${PUBLIC_SCHEME:-https}"
cat <<EOF
seed: done
  Northwind storefront  ${scheme}://northwind.${BASE_DOMAIN}
  Northwind admin       ${scheme}://api.northwind.${BASE_DOMAIN}/app  (${NORTHWIND_ADMIN_EMAIL})
  Acme storefront       ${scheme}://acme.${BASE_DOMAIN}
  Acme admin            ${scheme}://acme.${BASE_DOMAIN}/wp-admin/  (${ACME_ADMIN_USER})
EOF
