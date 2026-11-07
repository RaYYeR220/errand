<?php
/**
 * Restock: tops the stock of every catalog product back up to the catalog
 * number. Touches stock only (no products, prices or accounts), so it is safe
 * to run while buyers are browsing.
 *
 *   docker compose exec -T acme wp --path=/var/www/html --allow-root eval-file /usr/local/share/acme/restock.php
 */

defined( 'ABSPATH' ) || exit;

$path    = getenv( 'CATALOG_PATH' ) ? getenv( 'CATALOG_PATH' ) : '/catalog/catalog.json';
$catalog = json_decode( file_get_contents( $path ), true );
$offers  = $catalog['suppliers']['acme']['offers'];
$changed = array();

foreach ( $catalog['products'] as $item ) {
	if ( empty( $offers[ $item['key'] ] ) ) {
		continue;
	}
	$offer      = $offers[ $item['key'] ];
	$product_id = wc_get_product_id_by_sku( $offer['sku'] );
	if ( ! $product_id ) {
		continue;
	}
	$product = wc_get_product( $product_id );
	$current = (int) $product->get_stock_quantity();
	if ( $current >= (int) $offer['stock'] ) {
		continue;
	}
	wc_update_product_stock( $product, (int) $offer['stock'], 'set' );
	$changed[] = sprintf( '%s %d→%d', $offer['sku'], $current, (int) $offer['stock'] );
}

WP_CLI::log( $changed ? 'Acme restocked: ' . implode( ', ', $changed ) : 'Acme restock: nothing to do' );
