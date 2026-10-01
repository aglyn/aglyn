/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The starter sites plugins offer (AGL-3080): what each plugin's
 * `starterTemplates` entry returned when this file was generated, in
 * config order. `STARTER_TEMPLATES` in `starter-templates.ts` is the
 * platform's own starters followed by these.
 * Source of truth: plugins.config.json and the entries it names.
 */

import type { StarterTemplate } from './starter-template-nodes'

export const PLUGIN_STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    "id": "physical-shop",
    "displayName": "Shop (physical products)",
    "description": "Storefront starter: home with featured products, filterable shop, product page, cart, and customer accounts. After applying, set the Product page as the product template in Store settings.",
    "category": "Commerce",
    "screens": [
      {
        "key": "home",
        "displayName": "Home",
        "slug": "/",
        "seo": {
          "title": "Shop",
          "description": "Browse our products."
        },
        "nodes": {
          "_@_": {
            "$id": "_@_",
            "componentId": "div",
            "nodes": [
              "ps_h_heroSection",
              "ps_h_gridSection",
              "ps_h_newsSection"
            ]
          },
          "ps_h_heroSection": {
            "$id": "ps_h_heroSection",
            "componentId": "muiContainer",
            "pluginId": "mui",
            "parentId": "_@_",
            "props": {
              "maxWidth": "xl"
            },
            "sx": {
              "paddingTop": 10,
              "paddingBottom": 10
            },
            "nodes": [
              "ps_h_hero"
            ]
          },
          "ps_h_hero": {
            "$id": "ps_h_hero",
            "componentId": "muiStack",
            "pluginId": "mui",
            "parentId": "ps_h_heroSection",
            "props": {
              "spacing": 2
            },
            "sx": {
              "alignItems": "center"
            },
            "nodes": [
              "ps_h_heroTitle",
              "ps_h_heroSub",
              "ps_h_heroCta"
            ]
          },
          "ps_h_heroTitle": {
            "$id": "ps_h_heroTitle",
            "componentId": "muiTypography",
            "pluginId": "mui",
            "parentId": "ps_h_hero",
            "props": {
              "variant": "h2",
              "children": "Gear you can trust",
              "align": "center"
            },
            "nodes": []
          },
          "ps_h_heroSub": {
            "$id": "ps_h_heroSub",
            "componentId": "muiTypography",
            "pluginId": "mui",
            "parentId": "ps_h_hero",
            "props": {
              "variant": "h6",
              "children": "Quality parts, shipped fast.",
              "align": "center"
            },
            "nodes": []
          },
          "ps_h_heroCta": {
            "$id": "ps_h_heroCta",
            "componentId": "muiButton",
            "pluginId": "mui",
            "parentId": "ps_h_hero",
            "props": {
              "variant": "contained",
              "size": "large",
              "children": "Get in touch"
            },
            "nodes": []
          },
          "ps_h_gridSection": {
            "$id": "ps_h_gridSection",
            "componentId": "muiContainer",
            "pluginId": "mui",
            "parentId": "_@_",
            "props": {
              "maxWidth": "xl"
            },
            "sx": {
              "paddingTop": 6,
              "paddingBottom": 6
            },
            "nodes": [
              "ps_h_grid"
            ]
          },
          "ps_h_grid": {
            "$id": "ps_h_grid",
            "componentId": "product-grid",
            "pluginId": "commerce",
            "parentId": "ps_h_gridSection",
            "props": {
              "source": "all",
              "sort": "newest",
              "columns": 3,
              "maxItems": 6
            },
            "nodes": []
          },
          "ps_h_newsSection": {
            "$id": "ps_h_newsSection",
            "componentId": "muiContainer",
            "pluginId": "mui",
            "parentId": "_@_",
            "props": {
              "maxWidth": "md"
            },
            "sx": {
              "paddingTop": 6,
              "paddingBottom": 6
            },
            "nodes": [
              "ps_h_news"
            ]
          },
          "ps_h_news": {
            "$id": "ps_h_news",
            "componentId": "newsletter-signup",
            "pluginId": "commerce",
            "parentId": "ps_h_newsSection",
            "props": {
              "heading": "Get updates and offers"
            },
            "nodes": []
          }
        }
      },
      {
        "key": "shop",
        "displayName": "Shop",
        "slug": "shop",
        "seo": {
          "title": "All products"
        },
        "nodes": {
          "_@_": {
            "$id": "_@_",
            "componentId": "div",
            "nodes": [
              "ps_s_section"
            ]
          },
          "ps_s_section": {
            "$id": "ps_s_section",
            "componentId": "muiContainer",
            "pluginId": "mui",
            "parentId": "_@_",
            "props": {
              "maxWidth": "xl"
            },
            "sx": {
              "paddingTop": 6,
              "paddingBottom": 6
            },
            "nodes": [
              "ps_s_title",
              "ps_s_grid"
            ]
          },
          "ps_s_title": {
            "$id": "ps_s_title",
            "componentId": "muiTypography",
            "pluginId": "mui",
            "parentId": "ps_s_section",
            "props": {
              "variant": "h3",
              "children": "All products"
            },
            "nodes": []
          },
          "ps_s_grid": {
            "$id": "ps_s_grid",
            "componentId": "product-grid",
            "pluginId": "commerce",
            "parentId": "ps_s_section",
            "props": {
              "source": "all",
              "columns": 4,
              "showFilters": true
            },
            "nodes": []
          }
        }
      },
      {
        "key": "product",
        "displayName": "Product page",
        "slug": "product",
        "seo": {
          "title": "Product"
        },
        "nodes": {
          "_@_": {
            "$id": "_@_",
            "componentId": "div",
            "nodes": [
              "ps_p_section"
            ]
          },
          "ps_p_section": {
            "$id": "ps_p_section",
            "componentId": "muiContainer",
            "pluginId": "mui",
            "parentId": "_@_",
            "props": {
              "maxWidth": "xl"
            },
            "sx": {
              "paddingTop": 6,
              "paddingBottom": 6
            },
            "nodes": [
              "ps_p_detail"
            ]
          },
          "ps_p_detail": {
            "$id": "ps_p_detail",
            "componentId": "product-detail",
            "pluginId": "commerce",
            "parentId": "ps_p_section",
            "props": {},
            "nodes": []
          }
        }
      },
      {
        "key": "cart",
        "displayName": "Cart",
        "slug": "cart",
        "seo": {
          "title": "Your cart"
        },
        "nodes": {
          "_@_": {
            "$id": "_@_",
            "componentId": "div",
            "nodes": [
              "ps_c_section"
            ]
          },
          "ps_c_section": {
            "$id": "ps_c_section",
            "componentId": "muiContainer",
            "pluginId": "mui",
            "parentId": "_@_",
            "props": {
              "maxWidth": "lg"
            },
            "sx": {
              "paddingTop": 6,
              "paddingBottom": 6
            },
            "nodes": [
              "ps_c_title",
              "ps_c_cart"
            ]
          },
          "ps_c_title": {
            "$id": "ps_c_title",
            "componentId": "muiTypography",
            "pluginId": "mui",
            "parentId": "ps_c_section",
            "props": {
              "variant": "h3",
              "children": "Your cart"
            },
            "nodes": []
          },
          "ps_c_cart": {
            "$id": "ps_c_cart",
            "componentId": "cart",
            "pluginId": "commerce",
            "parentId": "ps_c_section",
            "props": {
              "variant": "inline",
              "showCoupon": true
            },
            "nodes": []
          }
        }
      },
      {
        "key": "account",
        "displayName": "Account",
        "slug": "account",
        "seo": {
          "title": "Your account"
        },
        "nodes": {
          "_@_": {
            "$id": "_@_",
            "componentId": "div",
            "nodes": [
              "ps_a_section"
            ]
          },
          "ps_a_section": {
            "$id": "ps_a_section",
            "componentId": "muiContainer",
            "pluginId": "mui",
            "parentId": "_@_",
            "props": {
              "maxWidth": "lg"
            },
            "sx": {
              "paddingTop": 6,
              "paddingBottom": 6
            },
            "nodes": [
              "ps_a_account"
            ]
          },
          "ps_a_account": {
            "$id": "ps_a_account",
            "componentId": "customer-account",
            "pluginId": "commerce",
            "parentId": "ps_a_section",
            "props": {
              "signedOutHeading": "Your account"
            },
            "nodes": []
          }
        }
      }
    ]
  },
  {
    "id": "digital-shop",
    "displayName": "Shop (digital products)",
    "description": "Digital storefront starter: downloads-focused home, shop, product page, cart, and accounts with a newsletter capture. Set the Product page as the product template in Store settings after applying.",
    "category": "Commerce",
    "screens": [
      {
        "key": "home",
        "displayName": "Home",
        "slug": "/",
        "seo": {
          "title": "Digital shop",
          "description": "Browse our products."
        },
        "nodes": {
          "_@_": {
            "$id": "_@_",
            "componentId": "div",
            "nodes": [
              "ds_h_heroSection",
              "ds_h_gridSection",
              "ds_h_newsSection"
            ]
          },
          "ds_h_heroSection": {
            "$id": "ds_h_heroSection",
            "componentId": "muiContainer",
            "pluginId": "mui",
            "parentId": "_@_",
            "props": {
              "maxWidth": "xl"
            },
            "sx": {
              "paddingTop": 10,
              "paddingBottom": 10
            },
            "nodes": [
              "ds_h_hero"
            ]
          },
          "ds_h_hero": {
            "$id": "ds_h_hero",
            "componentId": "muiStack",
            "pluginId": "mui",
            "parentId": "ds_h_heroSection",
            "props": {
              "spacing": 2
            },
            "sx": {
              "alignItems": "center"
            },
            "nodes": [
              "ds_h_heroTitle",
              "ds_h_heroSub",
              "ds_h_heroCta"
            ]
          },
          "ds_h_heroTitle": {
            "$id": "ds_h_heroTitle",
            "componentId": "muiTypography",
            "pluginId": "mui",
            "parentId": "ds_h_hero",
            "props": {
              "variant": "h2",
              "children": "Downloads that level you up",
              "align": "center"
            },
            "nodes": []
          },
          "ds_h_heroSub": {
            "$id": "ds_h_heroSub",
            "componentId": "muiTypography",
            "pluginId": "mui",
            "parentId": "ds_h_hero",
            "props": {
              "variant": "h6",
              "children": "Instant delivery. Lifetime updates.",
              "align": "center"
            },
            "nodes": []
          },
          "ds_h_heroCta": {
            "$id": "ds_h_heroCta",
            "componentId": "muiButton",
            "pluginId": "mui",
            "parentId": "ds_h_hero",
            "props": {
              "variant": "contained",
              "size": "large",
              "children": "Get in touch"
            },
            "nodes": []
          },
          "ds_h_gridSection": {
            "$id": "ds_h_gridSection",
            "componentId": "muiContainer",
            "pluginId": "mui",
            "parentId": "_@_",
            "props": {
              "maxWidth": "xl"
            },
            "sx": {
              "paddingTop": 6,
              "paddingBottom": 6
            },
            "nodes": [
              "ds_h_grid"
            ]
          },
          "ds_h_grid": {
            "$id": "ds_h_grid",
            "componentId": "product-grid",
            "pluginId": "commerce",
            "parentId": "ds_h_gridSection",
            "props": {
              "source": "all",
              "sort": "newest",
              "columns": 3,
              "maxItems": 6
            },
            "nodes": []
          },
          "ds_h_newsSection": {
            "$id": "ds_h_newsSection",
            "componentId": "muiContainer",
            "pluginId": "mui",
            "parentId": "_@_",
            "props": {
              "maxWidth": "md"
            },
            "sx": {
              "paddingTop": 6,
              "paddingBottom": 6
            },
            "nodes": [
              "ds_h_news"
            ]
          },
          "ds_h_news": {
            "$id": "ds_h_news",
            "componentId": "newsletter-signup",
            "pluginId": "commerce",
            "parentId": "ds_h_newsSection",
            "props": {
              "heading": "Get updates and offers"
            },
            "nodes": []
          }
        }
      },
      {
        "key": "shop",
        "displayName": "Shop",
        "slug": "shop",
        "seo": {
          "title": "All products"
        },
        "nodes": {
          "_@_": {
            "$id": "_@_",
            "componentId": "div",
            "nodes": [
              "ds_s_section"
            ]
          },
          "ds_s_section": {
            "$id": "ds_s_section",
            "componentId": "muiContainer",
            "pluginId": "mui",
            "parentId": "_@_",
            "props": {
              "maxWidth": "xl"
            },
            "sx": {
              "paddingTop": 6,
              "paddingBottom": 6
            },
            "nodes": [
              "ds_s_title",
              "ds_s_grid"
            ]
          },
          "ds_s_title": {
            "$id": "ds_s_title",
            "componentId": "muiTypography",
            "pluginId": "mui",
            "parentId": "ds_s_section",
            "props": {
              "variant": "h3",
              "children": "All products"
            },
            "nodes": []
          },
          "ds_s_grid": {
            "$id": "ds_s_grid",
            "componentId": "product-grid",
            "pluginId": "commerce",
            "parentId": "ds_s_section",
            "props": {
              "source": "all",
              "columns": 4,
              "showFilters": true
            },
            "nodes": []
          }
        }
      },
      {
        "key": "product",
        "displayName": "Product page",
        "slug": "product",
        "seo": {
          "title": "Product"
        },
        "nodes": {
          "_@_": {
            "$id": "_@_",
            "componentId": "div",
            "nodes": [
              "ds_p_section"
            ]
          },
          "ds_p_section": {
            "$id": "ds_p_section",
            "componentId": "muiContainer",
            "pluginId": "mui",
            "parentId": "_@_",
            "props": {
              "maxWidth": "xl"
            },
            "sx": {
              "paddingTop": 6,
              "paddingBottom": 6
            },
            "nodes": [
              "ds_p_detail"
            ]
          },
          "ds_p_detail": {
            "$id": "ds_p_detail",
            "componentId": "product-detail",
            "pluginId": "commerce",
            "parentId": "ds_p_section",
            "props": {},
            "nodes": []
          }
        }
      },
      {
        "key": "cart",
        "displayName": "Cart",
        "slug": "cart",
        "seo": {
          "title": "Your cart"
        },
        "nodes": {
          "_@_": {
            "$id": "_@_",
            "componentId": "div",
            "nodes": [
              "ds_c_section"
            ]
          },
          "ds_c_section": {
            "$id": "ds_c_section",
            "componentId": "muiContainer",
            "pluginId": "mui",
            "parentId": "_@_",
            "props": {
              "maxWidth": "lg"
            },
            "sx": {
              "paddingTop": 6,
              "paddingBottom": 6
            },
            "nodes": [
              "ds_c_title",
              "ds_c_cart"
            ]
          },
          "ds_c_title": {
            "$id": "ds_c_title",
            "componentId": "muiTypography",
            "pluginId": "mui",
            "parentId": "ds_c_section",
            "props": {
              "variant": "h3",
              "children": "Your cart"
            },
            "nodes": []
          },
          "ds_c_cart": {
            "$id": "ds_c_cart",
            "componentId": "cart",
            "pluginId": "commerce",
            "parentId": "ds_c_section",
            "props": {
              "variant": "inline",
              "showCoupon": true
            },
            "nodes": []
          }
        }
      },
      {
        "key": "account",
        "displayName": "Account",
        "slug": "account",
        "seo": {
          "title": "Your account"
        },
        "nodes": {
          "_@_": {
            "$id": "_@_",
            "componentId": "div",
            "nodes": [
              "ds_a_section"
            ]
          },
          "ds_a_section": {
            "$id": "ds_a_section",
            "componentId": "muiContainer",
            "pluginId": "mui",
            "parentId": "_@_",
            "props": {
              "maxWidth": "lg"
            },
            "sx": {
              "paddingTop": 6,
              "paddingBottom": 6
            },
            "nodes": [
              "ds_a_account"
            ]
          },
          "ds_a_account": {
            "$id": "ds_a_account",
            "componentId": "customer-account",
            "pluginId": "commerce",
            "parentId": "ds_a_section",
            "props": {
              "signedOutHeading": "Your account"
            },
            "nodes": []
          }
        }
      }
    ]
  }
]
