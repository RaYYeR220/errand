<?php
/**
 * Acme Office & Tech catalog, contract pricing, shipping, payment and accounts.
 * Run with `wp eval-file`; idempotent (records are matched by SKU, username,
 * zone name or page and updated in place; stock is reset to the catalog).
 */

defined( 'ABSPATH' ) || exit;

$env = static function ( $name, $default = null ) {
	$value = getenv( $name );
	if ( false === $value || '' === $value ) {
		if ( null === $default ) {
			WP_CLI::error( "Missing environment variable {$name}" );
		}
		return $default;
	}
	return $value;
};

$catalog  = json_decode( file_get_contents( $env( 'CATALOG_PATH', '/catalog/catalog.json' ) ), true );
$supplier = $catalog['suppliers']['acme'];
$buyer    = $catalog['buyer'];
$role     = 'business_customer';

if ( ! get_role( $role ) ) {
	add_role( $role, 'Business customer', array( 'read' => true ) );
}

/* Store settings ------------------------------------------------------------ */

$options = array(
	'blogname'                                   => $supplier['name'],
	'woocommerce_store_address'                  => '2250 Glendale Ave',
	'woocommerce_store_city'                     => 'Reno',
	'woocommerce_default_country'                => 'US:NV',
	'woocommerce_store_postcode'                 => '89502',
	'woocommerce_allowed_countries'              => 'specific',
	'woocommerce_specific_allowed_countries'     => array( 'US' ),
	'woocommerce_ship_to_countries'              => 'specific',
	'woocommerce_specific_ship_to_countries'     => array( 'US' ),
	'woocommerce_currency'                       => strtoupper( $catalog['currency'] ),
	'woocommerce_price_num_decimals'             => 2,
	'woocommerce_calc_taxes'                     => 'no',
	'woocommerce_enable_coupons'                 => 'no',
	'woocommerce_manage_stock'                   => 'yes',
	'woocommerce_stock_format'                   => '',
	'woocommerce_hold_stock_minutes'             => '',
	'woocommerce_enable_guest_checkout'          => 'no',
	'woocommerce_enable_checkout_login_reminder' => 'yes',
	'woocommerce_enable_signup_and_login_from_checkout' => 'no',
	'woocommerce_enable_myaccount_registration'  => 'no',
	'woocommerce_enable_order_comments'          => 'yes',
	'woocommerce_checkout_company_field'         => 'optional',
	'woocommerce_checkout_address_2_field'       => 'optional',
	'woocommerce_checkout_phone_field'           => 'required',
	'woocommerce_ship_to_destination'            => 'shipping',
	'woocommerce_coming_soon'                    => 'no',
	'woocommerce_store_pages_only'               => 'no',
	'woocommerce_feature_order_attribution_enabled' => 'no',
	'woocommerce_allow_tracking'                 => 'no',
	'woocommerce_show_marketplace_suggestions'   => 'no',
	'woocommerce_task_list_hidden'               => 'yes',
	'woocommerce_onboarding_profile'             => array( 'skipped' => true ),
	'acme_shipping_rate_per_unit'                => (float) $supplier['shipping']['rate'],
	'acme_free_shipping_threshold'               => (float) $supplier['shipping']['free_threshold'],
);
foreach ( $options as $name => $value ) {
	update_option( $name, $value );
}

/* Pages: classic shortcode cart and checkout, shop on the front page --------- */

$page_content = array(
	'cart'      => '<!-- wp:shortcode -->[woocommerce_cart]<!-- /wp:shortcode -->',
	'checkout'  => '<!-- wp:shortcode -->[woocommerce_checkout]<!-- /wp:shortcode -->',
	'myaccount' => '<!-- wp:shortcode -->[woocommerce_my_account]<!-- /wp:shortcode -->',
);
foreach ( $page_content as $page => $content ) {
	$page_id = wc_get_page_id( $page );
	if ( $page_id <= 0 ) {
		WP_CLI::error( "WooCommerce page {$page} is missing" );
	}
	wp_update_post(
		array(
			'ID'           => $page_id,
			'post_content' => $content,
		)
	);
}
update_option( 'show_on_front', 'page' );
update_option( 'page_on_front', wc_get_page_id( 'shop' ) );

// No blog widgets: the store pages render full width.
$sidebars = get_option( 'sidebars_widgets', array() );
foreach ( $sidebars as $sidebar => $widgets ) {
	if ( is_array( $widgets ) && 'wp_inactive_widgets' !== $sidebar ) {
		$sidebars[ $sidebar ] = array();
	}
}
update_option( 'sidebars_widgets', $sidebars );

foreach ( array( 'hello-world' => 'post', 'sample-page' => 'page' ) as $slug => $type ) {
	$post = get_page_by_path( $slug, OBJECT, $type );
	if ( $post ) {
		wp_delete_post( $post->ID, true );
	}
}

/* Payment: invoice on account via the cheque gateway --------------------------- */

update_option(
	'woocommerce_cheque_settings',
	array(
		'enabled'      => 'yes',
		'title'        => 'Invoice / pay on account (net 30)',
		'description'  => 'Your company is invoiced on net-30 terms against the PO number above. No payment is taken now.',
		'instructions' => 'We will email an invoice on net-30 terms quoting your PO number.',
	)
);
foreach ( array( 'bacs', 'cod' ) as $gateway ) {
	$settings            = get_option( "woocommerce_{$gateway}_settings", array() );
	$settings['enabled'] = 'no';
	update_option( "woocommerce_{$gateway}_settings", $settings );
}
update_option( 'woocommerce_gateway_order', array( 'cheque' => 0 ) );

/* Shipping: per-unit ground freight, free above the threshold ------------------ */

$zone = null;
foreach ( WC_Shipping_Zones::get_zones() as $data ) {
	if ( 'United States' === $data['zone_name'] ) {
		$zone = new WC_Shipping_Zone( $data['id'] );
	}
}
if ( ! $zone ) {
	$zone = new WC_Shipping_Zone();
	$zone->set_zone_name( 'United States' );
	$zone->add_location( 'US', 'country' );
	$zone->save();
}
foreach ( $zone->get_shipping_methods() as $instance_id => $method ) {
	$zone->delete_shipping_method( $instance_id );
}
$free_id = $zone->add_shipping_method( 'free_shipping' );
update_option(
	"woocommerce_free_shipping_{$free_id}_settings",
	array(
		'title'            => 'Free ground freight',
		'requires'         => 'min_amount',
		'min_amount'       => wc_format_decimal( $supplier['shipping']['free_threshold'] ),
		'ignore_discounts' => 'no',
	)
);
$flat_id = $zone->add_shipping_method( 'flat_rate' );
update_option(
	"woocommerce_flat_rate_{$flat_id}_settings",
	array(
		'title'      => $supplier['shipping']['label'],
		'tax_status' => 'none',
		'cost'       => wc_format_decimal( $supplier['shipping']['rate'] ) . ' * [qty]',
		'type'       => 'class',
	)
);
WC_Cache_Helper::get_transient_version( 'shipping', true );

/* Catalog ----------------------------------------------------------------------- */

$category = get_term_by( 'slug', 'docking-stations', 'product_cat' );
if ( ! $category ) {
	$created  = wp_insert_term( 'Docking stations', 'product_cat', array( 'slug' => 'docking-stations' ) );
	$category = get_term( $created['term_id'], 'product_cat' );
}

$spec_labels = array(
	'host_connection'     => 'Host connection',
	'external_displays'   => 'External displays (max)',
	'dual_display_max'    => 'Dual-display max resolution',
	'single_display_max'  => 'Single-display max resolution',
	'power_delivery_w'    => 'Host power delivery',
	'power_delivery_note' => 'Power delivery details',
	'ports'               => 'Ports',
);

$count = 0;
foreach ( $catalog['products'] as $item ) {
	$offer = $supplier['offers'][ $item['key'] ] ?? null;
	if ( ! $offer ) {
		continue;
	}

	$specs = array( 'Manufacturer part' => $item['mpn'] );
	foreach ( $item['specs'] as $key => $value ) {
		$specs[ $spec_labels[ $key ] ?? $key ] = 'power_delivery_w' === $key ? "{$value} W" : (string) $value;
	}

	$rows = '';
	foreach ( $specs as $label => $value ) {
		$rows .= sprintf( '<tr><th>%s</th><td>%s</td></tr>', esc_html( $label ), esc_html( $value ) );
	}
	$description = sprintf(
		"<p>%s</p>\n<h3>Specifications</h3>\n<table>%s</table>\n<p>Lead time: %d business day%s to delivery. Ships from %s.</p>",
		esc_html( $item['summary'] ),
		$rows,
		$offer['lead_time_days'],
		1 === $offer['lead_time_days'] ? '' : 's',
		esc_html( $supplier['warehouse'] )
	);

	$product_id = wc_get_product_id_by_sku( $offer['sku'] );
	$product    = $product_id ? wc_get_product( $product_id ) : new WC_Product_Simple();

	$product->set_name( $item['title'] );
	$product->set_slug( $item['key'] );
	$product->set_sku( $offer['sku'] );
	$product->set_status( 'publish' );
	$product->set_catalog_visibility( 'visible' );
	$product->set_short_description( esc_html( $item['summary'] ) );
	$product->set_description( $description );
	$product->set_regular_price( wc_format_decimal( $offer['list_price'], 2 ) );
	$product->set_sale_price( '' );
	$product->set_manage_stock( true );
	$product->set_stock_quantity( (int) $offer['stock'] );
	$product->set_backorders( 'no' );
	$product->set_sold_individually( false );
	$product->set_category_ids( array( $category->term_id ) );
	$product->update_meta_data( '_role_price_' . $role, wc_format_decimal( $offer['contract_price'], 2 ) );
	$product->update_meta_data( '_role_tiers_' . $role, wp_json_encode( $offer['tiers'] ) );
	$product->update_meta_data( '_acme_lead_time_days', (int) $offer['lead_time_days'] );
	$product->update_meta_data( '_acme_specs', wp_json_encode( $specs ) );
	$product->update_meta_data( '_acme_brand', $item['brand'] );
	$product->save();
	++$count;
}

/* Accounts ---------------------------------------------------------------------- */

$admin = get_user_by( 'login', $env( 'ACME_ADMIN_USER' ) );
if ( $admin ) {
	wp_set_password( $env( 'ACME_ADMIN_PASSWORD' ), $admin->ID );
}

$username = $env( 'ACME_BUYER_USERNAME' );
$email    = strtolower( $env( 'ACME_BUYER_EMAIL' ) );
$password = $env( 'ACME_BUYER_PASSWORD' );

$user_id = username_exists( $username );
if ( ! $user_id ) {
	$user_id = wp_insert_user(
		array(
			'user_login' => $username,
			'user_email' => $email,
			'user_pass'  => $password,
			'role'       => 'customer',
		)
	);
	if ( is_wp_error( $user_id ) ) {
		WP_CLI::error( $user_id->get_error_message() );
	}
} else {
	wp_set_password( $password, $user_id );
}

$user = new WP_User( $user_id );
$user->set_role( 'customer' );
$user->add_role( $role );
wp_update_user(
	array(
		'ID'           => $user_id,
		'user_email'   => $email,
		'first_name'   => $buyer['contact']['first_name'],
		'last_name'    => $buyer['contact']['last_name'],
		'display_name' => $buyer['contact']['first_name'] . ' ' . $buyer['contact']['last_name'],
	)
);

$customer = new WC_Customer( $user_id );
$address  = $buyer['address'];
foreach ( array( 'billing', 'shipping' ) as $type ) {
	$customer->{"set_{$type}_first_name"}( $buyer['contact']['first_name'] );
	$customer->{"set_{$type}_last_name"}( $buyer['contact']['last_name'] );
	$customer->{"set_{$type}_company"}( $address['company'] );
	$customer->{"set_{$type}_address_1"}( $address['address_1'] );
	$customer->{"set_{$type}_address_2"}( $address['address_2'] );
	$customer->{"set_{$type}_city"}( $address['city'] );
	$customer->{"set_{$type}_state"}( strtoupper( $address['province'] ) );
	$customer->{"set_{$type}_postcode"}( $address['postal_code'] );
	$customer->{"set_{$type}_country"}( strtoupper( $address['country_code'] ) );
}
$customer->set_billing_email( $email );
$customer->set_billing_phone( $buyer['contact']['phone'] );
$customer->save();

wc_delete_product_transients();
WP_CLI::success( sprintf( 'Acme seeded: %d products, buyer %s, admin %s', $count, $username, $env( 'ACME_ADMIN_USER' ) ) );
