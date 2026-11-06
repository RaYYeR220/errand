#!/bin/sh
# Acme Office & Tech seed: installs WordPress and WooCommerce on first run,
# then (re)applies store settings, catalog, contract pricing and accounts.
# Every step is idempotent.
set -eu

: "${ACME_PUBLIC_URL:?}" "${ACME_ADMIN_USER:?}" "${ACME_ADMIN_EMAIL:?}" "${ACME_ADMIN_PASSWORD:?}"

wp() {
  command wp --path=/var/www/html --allow-root "$@"
}

if ! wp core is-installed 2>/dev/null; then
  wp core install --quiet \
    --url="$ACME_PUBLIC_URL" \
    --title="Acme Office & Tech" \
    --admin_user="$ACME_ADMIN_USER" \
    --admin_email="$ACME_ADMIN_EMAIL" \
    --admin_password="$ACME_ADMIN_PASSWORD" \
    --skip-email
  echo "acme-seed: WordPress installed"
fi

wp plugin activate woocommerce --quiet
wp theme activate storefront --quiet
wp rewrite structure '/%postname%/' --hard --quiet
wp option update blogdescription "Office hardware for business accounts" --quiet
wp option update timezone_string "America/Los_Angeles" --quiet

# WooCommerce creates its tables and pages on activation; make sure the pages
# exist before the catalog is written.
wp wc tool run install_pages --user="$ACME_ADMIN_USER" --quiet

wp eval-file /usr/local/share/acme/seed.php
