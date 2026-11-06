#!/usr/bin/env bash
# Creates .env from .env.example and fills every empty value with a random
# secret. Existing values are kept, so the script is safe to re-run after
# .env.example gains new variables.
set -euo pipefail

cd "$(dirname "$0")/.."

random_secret() {
  local length="${1:-32}"
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$length" || true
}

touch .env

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[A-Z0-9_]+= ]] || continue
  key="${line%%=*}"
  default="${line#*=}"
  if grep -q "^${key}=" .env; then
    continue
  fi
  value="$default"
  if [[ -z "$value" ]]; then
    case "$key" in
      NORTHWIND_PUBLISHABLE_KEY) value="pk_$(random_secret 48)" ;;
      *) value="$(random_secret 32)" ;;
    esac
  fi
  printf '%s=%s\n' "$key" "$value" >>.env
  echo "init-env: set $key"
done <.env.example

echo "init-env: .env is ready"
