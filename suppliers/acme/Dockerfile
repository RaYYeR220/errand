# Acme Office & Tech: WordPress + WooCommerce (classic shortcode checkout) with
# the Storefront theme and the acme-b2b must-use plugin. Code lives in the
# image; the database and uploads are the only persistent state.
FROM wordpress:7.1.4-php8.3-apache

ARG WOOCOMMERCE_VERSION=11.2.2
ARG STOREFRONT_VERSION=4.6.2
ARG WP_CLI_VERSION=2.12.0

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends unzip less; \
    rm -rf /var/lib/apt/lists/*; \
    curl -fsSL -o /tmp/woocommerce.zip "https://downloads.wordpress.org/plugin/woocommerce.${WOOCOMMERCE_VERSION}.zip"; \
    unzip -q /tmp/woocommerce.zip -d /usr/src/wordpress/wp-content/plugins; \
    curl -fsSL -o /tmp/storefront.zip "https://downloads.wordpress.org/theme/storefront.${STOREFRONT_VERSION}.zip"; \
    unzip -q /tmp/storefront.zip -d /usr/src/wordpress/wp-content/themes; \
    rm /tmp/woocommerce.zip /tmp/storefront.zip; \
    curl -fsSL -o /usr/local/bin/wp "https://github.com/wp-cli/wp-cli/releases/download/v${WP_CLI_VERSION}/wp-cli-${WP_CLI_VERSION}.phar"; \
    chmod +x /usr/local/bin/wp

COPY mu-plugins/ /usr/src/wordpress/wp-content/mu-plugins/
COPY seed/ /usr/local/share/acme/
COPY bin/ /usr/local/bin/
RUN set -eux; \
    chown -R www-data:www-data /usr/src/wordpress/wp-content; \
    chmod +x /usr/local/bin/apache2-acme /usr/local/bin/acme-seed

# WordPress runs only under the configured public URL.
ENV WORDPRESS_CONFIG_EXTRA="\
define('WP_HOME', getenv('ACME_PUBLIC_URL')); \
define('WP_SITEURL', getenv('ACME_PUBLIC_URL')); \
define('WP_ENVIRONMENT_TYPE', 'production'); \
define('DISALLOW_FILE_EDIT', true); \
define('DISALLOW_FILE_MODS', true); \
define('AUTOMATIC_UPDATER_DISABLED', true);"

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
  CMD curl -fsS -o /dev/null http://127.0.0.1/wp-includes/images/blank.gif || exit 1

# The name must start with "apache2" so the stock entrypoint prepares
# wp-config.php before handing over.
CMD ["apache2-acme"]
