<?php
/**
 * Plugin Name: Acme B2B
 * Description: Contract pricing for business customers (role-based price meta with volume tiers), purchase-order checkout fields and invoice terms for Acme Office & Tech.
 * Version: 1.0.0
 *
 * Price meta, per product and per role:
 *   _role_price_{role}  contract unit price, e.g. 199.00
 *   _role_tiers_{role}  JSON list of volume tiers, e.g. [{"min_qty":10,"price":189}]
 * Product facts meta:
 *   _acme_lead_time_days  business days to delivery
 *   _acme_specs           JSON object of label => value
 */

defined( 'ABSPATH' ) || exit;

const ACME_B2B_ROLE = 'business_customer';

/* -------------------------------------------------------------------------
 * Roles
 * ---------------------------------------------------------------------- */

add_action(
	'init',
	static function () {
		if ( wp_installing() || ! is_blog_installed() ) {
			return;
		}
		if ( ! get_role( ACME_B2B_ROLE ) ) {
			add_role( ACME_B2B_ROLE, 'Business customer', array( 'read' => true ) );
		}
	}
);

/**
 * Roles of the signed-in user that carry contract pricing.
 *
 * @return string[]
 */
function acme_b2b_pricing_roles() {
	if ( ! is_user_logged_in() ) {
		return array();
	}
	$user = wp_get_current_user();
	return array_values( array_intersect( (array) $user->roles, array( ACME_B2B_ROLE ) ) );
}

/**
 * Contract terms of a product for the current user, or null for list pricing.
 *
 * @param WC_Product $product Product (variations fall back to their parent).
 * @return array{price: float, tiers: array<int, array{min_qty: int, price: float}>}|null
 */
function acme_b2b_contract_terms( $product ) {
	if ( ! $product instanceof WC_Product ) {
		return null;
	}
	$product_id = $product->get_parent_id() ? $product->get_parent_id() : $product->get_id();

	foreach ( acme_b2b_pricing_roles() as $role ) {
		$price = get_post_meta( $product_id, '_role_price_' . $role, true );
		if ( '' === $price || null === $price ) {
			continue;
		}
		$tiers = json_decode( (string) get_post_meta( $product_id, '_role_tiers_' . $role, true ), true );
		$tiers = is_array( $tiers ) ? $tiers : array();
		$tiers = array_map(
			static fn( $tier ) => array(
				'min_qty' => (int) $tier['min_qty'],
				'price'   => (float) $tier['price'],
			),
			$tiers
		);
		usort( $tiers, static fn( $a, $b ) => $a['min_qty'] <=> $b['min_qty'] );
		return array(
			'price' => (float) $price,
			'tiers' => $tiers,
		);
	}
	return null;
}

/**
 * Unit price for a quantity under the given contract terms.
 */
function acme_b2b_unit_price( array $terms, $quantity ) {
	$price = $terms['price'];
	foreach ( $terms['tiers'] as $tier ) {
		if ( $quantity >= $tier['min_qty'] ) {
			$price = min( $price, $tier['price'] );
		}
	}
	return $price;
}

/* -------------------------------------------------------------------------
 * Contract pricing
 * ---------------------------------------------------------------------- */

// Shop and product pages: contract price against the struck-through list price.
add_filter(
	'woocommerce_get_price_html',
	static function ( $html, $product ) {
		$terms = acme_b2b_contract_terms( $product );
		if ( ! $terms ) {
			return $html;
		}
		return sprintf(
			'<span class="acme-price-label">%s</span> %s',
			esc_html__( 'Your contract price', 'acme-b2b' ),
			wc_format_sale_price(
				wc_get_price_to_display( $product, array( 'price' => $product->get_regular_price() ) ),
				wc_get_price_to_display( $product, array( 'price' => $terms['price'] ) )
			) . $product->get_price_suffix()
		);
	},
	10,
	2
);

// Cart: contract price per line, with the volume tier for that line's quantity.
add_action(
	'woocommerce_before_calculate_totals',
	static function ( $cart ) {
		if ( is_admin() && ! wp_doing_ajax() ) {
			return;
		}
		$quantities = array();
		foreach ( $cart->get_cart() as $item ) {
			$id                = $item['data']->get_id();
			$quantities[ $id ] = ( $quantities[ $id ] ?? 0 ) + (int) $item['quantity'];
		}
		foreach ( $cart->get_cart() as $item ) {
			$product = $item['data'];
			$terms   = acme_b2b_contract_terms( $product );
			if ( $terms ) {
				$product->set_price( acme_b2b_unit_price( $terms, $quantities[ $product->get_id() ] ) );
			}
		}
	},
	20
);

/* -------------------------------------------------------------------------
 * Product page facts: stock, lead time, shipping terms, tiers, specs
 * ---------------------------------------------------------------------- */

add_action(
	'woocommerce_single_product_summary',
	static function () {
		global $product;
		if ( ! $product instanceof WC_Product ) {
			return;
		}
		$lead_time = (int) $product->get_meta( '_acme_lead_time_days' );
		$specs     = json_decode( (string) $product->get_meta( '_acme_specs' ), true );
		$terms     = acme_b2b_contract_terms( $product );
		$stock     = $product->managing_stock() ? (int) $product->get_stock_quantity() : null;

		echo '<div class="acme-facts" data-testid="product-facts">';
		echo '<ul class="acme-facts__list">';
		if ( null !== $stock ) {
			printf(
				'<li data-testid="product-stock" data-value="%1$d">%2$s</li>',
				$stock,
				esc_html( sprintf( _n( 'Stock: %d unit', 'Stock: %d units', $stock, 'acme-b2b' ), $stock ) )
			);
		}
		if ( $lead_time > 0 ) {
			printf(
				'<li data-testid="product-lead-time" data-value="%1$d">%2$s</li>',
				$lead_time,
				esc_html( sprintf( _n( 'Lead time: %d business day to delivery', 'Lead time: %d business days to delivery', $lead_time, 'acme-b2b' ), $lead_time ) )
			);
		}
		printf( '<li data-testid="product-shipping">%s</li>', esc_html( acme_b2b_shipping_terms() ) );
		echo '</ul>';

		if ( $terms ) {
			echo '<div class="acme-tiers" data-testid="volume-tiers"><h4>' . esc_html__( 'Contract volume pricing', 'acme-b2b' ) . '</h4><table class="shop_table"><tbody>';
			$first_tier = $terms['tiers'][0]['min_qty'] ?? null;
			printf(
				'<tr><th>%1$s</th><td data-testid="tier-price" data-min-qty="1" data-value="%2$s">%3$s</td></tr>',
				esc_html( $first_tier ? sprintf( '1–%d units', $first_tier - 1 ) : '1+ units' ),
				esc_attr( wc_format_decimal( $terms['price'], 2 ) ),
				wp_kses_post( wc_price( $terms['price'] ) . ' / unit' )
			);
			foreach ( $terms['tiers'] as $tier ) {
				printf(
					'<tr><th>%1$s</th><td data-testid="tier-price" data-min-qty="%2$d" data-value="%3$s">%4$s</td></tr>',
					esc_html( sprintf( '%d+ units', $tier['min_qty'] ) ),
					$tier['min_qty'],
					esc_attr( wc_format_decimal( $tier['price'], 2 ) ),
					wp_kses_post( wc_price( $tier['price'] ) . ' / unit' )
				);
			}
			echo '</tbody></table><p class="acme-tiers__note">' . esc_html__( 'A tier price applies to a cart line once its quantity reaches the tier.', 'acme-b2b' ) . '</p></div>';
		} else {
			echo '<p class="acme-signin-hint" data-testid="contract-pricing-hint">' . esc_html__( 'Sign in with your business account to see contract and volume pricing.', 'acme-b2b' ) . '</p>';
		}

		if ( is_array( $specs ) && $specs ) {
			echo '<div class="acme-specs" data-testid="product-specs"><h4>' . esc_html__( 'Key specifications', 'acme-b2b' ) . '</h4><table class="shop_table"><tbody>';
			foreach ( $specs as $label => $value ) {
				printf( '<tr><th>%s</th><td>%s</td></tr>', esc_html( $label ), esc_html( $value ) );
			}
			echo '</tbody></table></div>';
		}
		echo '</div>';
	},
	25
);

/**
 * Human-readable shipping terms from the flat-rate and free-shipping methods.
 */
function acme_b2b_shipping_terms() {
	$rate      = (float) get_option( 'acme_shipping_rate_per_unit', 0 );
	$threshold = (float) get_option( 'acme_free_shipping_threshold', 0 );
	return sprintf(
		/* translators: 1: per-unit shipping price, 2: free shipping threshold */
		__( 'Shipping: Ground freight %1$s per unit, free on orders of %2$s or more.', 'acme-b2b' ),
		html_entity_decode( wp_strip_all_tags( wc_price( $rate ) ) ),
		html_entity_decode( wp_strip_all_tags( wc_price( $threshold, array( 'decimals' => 0 ) ) ) )
	);
}

add_action(
	'wp_head',
	static function () {
		if ( ! is_product() ) {
			return;
		}
		echo '<style>.acme-facts{margin:1.5em 0}.acme-facts__list{margin:0 0 1em 1.2em}.acme-facts table{margin:.5em 0 1em}.acme-facts th{width:45%}.acme-tiers__note{font-size:.85em;opacity:.8}.acme-price-label{display:block;font-size:.75em;text-transform:uppercase;letter-spacing:.04em;opacity:.75}</style>';
	}
);

/* -------------------------------------------------------------------------
 * Checkout: purchase order number and cost center, invoice terms
 * ---------------------------------------------------------------------- */

add_filter(
	'woocommerce_checkout_fields',
	static function ( $fields ) {
		$fields['order'] = array(
			'po_number'   => array(
				'type'        => 'text',
				'label'       => __( 'Purchase order (PO) number', 'acme-b2b' ),
				'required'    => true,
				'class'       => array( 'form-row-first' ),
				'priority'    => 5,
				'maxlength'   => 64,
			),
			'cost_center' => array(
				'type'        => 'text',
				'label'       => __( 'Cost center', 'acme-b2b' ),
				'required'    => true,
				'class'       => array( 'form-row-last' ),
				'priority'    => 6,
				'maxlength'   => 64,
			),
		) + $fields['order'];
		return $fields;
	}
);

add_action(
	'woocommerce_checkout_create_order',
	static function ( $order, $data ) {
		foreach ( array( 'po_number', 'cost_center' ) as $key ) {
			if ( isset( $data[ $key ] ) ) {
				$order->update_meta_data( '_' . $key, sanitize_text_field( $data[ $key ] ) );
			}
		}
		$order->update_meta_data( '_payment_terms', 'Net 30' );
	},
	10,
	2
);

/**
 * PO number, cost center and payment terms of an order, keyed by label.
 */
function acme_b2b_order_reference( $order ) {
	return array_filter(
		array(
			__( 'PO number', 'acme-b2b' )     => $order->get_meta( '_po_number' ),
			__( 'Cost center', 'acme-b2b' )   => $order->get_meta( '_cost_center' ),
			__( 'Payment terms', 'acme-b2b' ) => $order->get_meta( '_payment_terms' ),
		)
	);
}

add_action(
	'woocommerce_admin_order_data_after_billing_address',
	static function ( $order ) {
		foreach ( acme_b2b_order_reference( $order ) as $label => $value ) {
			printf( '<p class="acme-order-ref"><strong>%s:</strong> %s</p>', esc_html( $label ), esc_html( $value ) );
		}
	}
);

add_action(
	'woocommerce_order_details_after_order_table',
	static function ( $order ) {
		$reference = acme_b2b_order_reference( $order );
		if ( ! $reference ) {
			return;
		}
		echo '<section class="acme-order-ref" data-testid="order-reference"><h2>' . esc_html__( 'Order reference', 'acme-b2b' ) . '</h2><table class="shop_table"><tbody>';
		foreach ( $reference as $label => $value ) {
			printf( '<tr><th>%s</th><td>%s</td></tr>', esc_html( $label ), esc_html( $value ) );
		}
		echo '</tbody></table></section>';
	}
);

add_filter(
	'woocommerce_email_order_meta_fields',
	static function ( $fields, $sent_to_admin, $order ) {
		foreach ( acme_b2b_order_reference( $order ) as $label => $value ) {
			$fields[] = array(
				'label' => $label,
				'value' => $value,
			);
		}
		return $fields;
	},
	10,
	3
);

// When free shipping applies, offer only the free rate.
add_filter(
	'woocommerce_package_rates',
	static function ( $rates ) {
		$free = array_filter( $rates, static fn( $rate ) => 'free_shipping' === $rate->get_method_id() );
		return $free ? $free : $rates;
	},
	100
);

/* -------------------------------------------------------------------------
 * Outgoing mail: the demo has no mail transport, so messages are dropped.
 * Remove this filter once SMTP is configured.
 * ---------------------------------------------------------------------- */

add_filter( 'pre_wp_mail', static fn( $short_circuit ) => $short_circuit ?? true );

/* -------------------------------------------------------------------------
 * Self-contained storefront: no third-party asset hosts
 * ---------------------------------------------------------------------- */

add_action(
	'wp_enqueue_scripts',
	static function () {
		wp_dequeue_style( 'storefront-fonts' );
	},
	100
);
remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
remove_action( 'wp_print_styles', 'print_emoji_styles' );
add_filter( 'emoji_svg_url', '__return_false' );
add_filter( 'get_avatar_url', static fn() => includes_url( 'images/blank.gif' ) );
add_filter( 'storefront_credit_link', '__return_false' );
