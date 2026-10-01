/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The emails sites send their own customers (AGL-3080): what each plugin's
 * `tenantEmails` entry returned when this file was generated, in config
 * order. `TENANT_EMAILS` in `tenant-email-catalog.ts` is this list.
 * Source of truth: plugins.config.json and the entries it names.
 */

import type { TenantEmailEntry } from './tenant-email-catalog'

export const PLUGIN_TENANT_EMAILS: readonly TenantEmailEntry[] = [
  {
    "key": "booking-confirmed",
    "name": "Booking confirmed",
    "description": "Confirms a booking to the customer, for paid and free services.",
    "pluginId": "bookings",
    "plugin": "Bookings",
    "control": "besigner",
    "defaultSubject": "Booking confirmed: {{service.name}}",
    "mergeTokens": [
      {
        "name": "name",
        "description": "The customer's name",
        "sample": "Alex"
      },
      {
        "name": "service.name",
        "description": "The booked service",
        "sample": "Consultation"
      },
      {
        "name": "when",
        "description": "Formatted date and time of the booking",
        "sample": "Monday, June 1, 2026 at 9:00 AM"
      },
      {
        "name": "timezone",
        "description": "Timezone the time is shown in",
        "sample": "America/Chicago"
      },
      {
        "name": "booking.payment",
        "description": "What a paid booking charged, as a sentence; empty for a free booking",
        "sample": "You paid $95.00."
      },
      {
        "name": "booking.ref",
        "description": "Booking reference id",
        "sample": "bk_123"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "Booking confirmed",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "Hi {{name}}, your booking with {{host.businessName}} is confirmed: \"{{service.name}}\" on {{when}} ({{timezone}}).",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{booking.payment}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Reference: {{booking.ref}}",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you booked with {{host.businessName}}."
  },
  {
    "key": "booking-reminder",
    "name": "Booking reminder",
    "description": "Reminds the customer of an upcoming booking.",
    "pluginId": "bookings",
    "plugin": "Bookings",
    "control": "besigner",
    "defaultSubject": "Reminder: {{service.name}} is coming up",
    "mergeTokens": [
      {
        "name": "name",
        "description": "The customer's name",
        "sample": "Alex"
      },
      {
        "name": "service.name",
        "description": "The booked service",
        "sample": "Consultation"
      },
      {
        "name": "when",
        "description": "Formatted date and time of the booking",
        "sample": "Tuesday, June 2, 2026 at 9:00 AM"
      },
      {
        "name": "timezone",
        "description": "Timezone the time is shown in",
        "sample": "America/Chicago"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "Hi {{name}}, this is a reminder of your booking with {{host.businessName}}: \"{{service.name}}\" on {{when}} ({{timezone}}).",
        "variant": "body"
      }
    ],
    "footerReason": "You’re receiving this because you have a booking with {{host.businessName}}."
  },
  {
    "key": "order-receipt",
    "name": "Order receipt",
    "description": "Sent to the buyer after a successful order or checkout.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "Receipt for your order",
    "mergeTokens": [
      {
        "name": "order.summary",
        "description": "The ordered items, one per line (with any license/download links)",
        "sample": "House Blend × 2 — $24.00"
      },
      {
        "name": "order.total",
        "description": "Order total",
        "sample": "$24.00"
      },
      {
        "name": "order.ref",
        "description": "Order reference id",
        "sample": "cs_test_123"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "Thanks for your purchase!",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "{{order.summary}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Total: {{order.total}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Order reference: {{order.ref}}",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you placed an order with {{host.businessName}}."
  },
  {
    "key": "sale-notification",
    "name": "New sale",
    "description": "Notifies the seller when an order is placed.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "New order on {{site.name}}",
    "mergeTokens": [
      {
        "name": "site.name",
        "description": "The site the sale happened on",
        "sample": "Northwind Coffee"
      },
      {
        "name": "order.summary",
        "description": "The ordered items",
        "sample": "House Blend — $12.00"
      },
      {
        "name": "order.total",
        "description": "Order total",
        "sample": "$12.00"
      },
      {
        "name": "buyer.email",
        "description": "The buyer's email",
        "sample": "buyer@example.com"
      },
      {
        "name": "order.ref",
        "description": "Order reference id",
        "sample": "cs_test_123"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "You made a sale",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "A new order came in on {{site.name}}.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{order.summary}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Total: {{order.total}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Buyer: {{buyer.email}} · Order {{order.ref}}",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you manage {{host.businessName}}."
  },
  {
    "key": "reservation-confirmed",
    "name": "Reservation confirmed",
    "description": "Confirms a paid reservation to the customer.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "Reservation confirmed",
    "mergeTokens": [
      {
        "name": "reservation.checkIn",
        "description": "Check-in date",
        "sample": "Mon, 01 Jun 2026"
      },
      {
        "name": "reservation.nights",
        "description": "Number of nights",
        "sample": "2"
      },
      {
        "name": "reservation.paid",
        "description": "Amount paid today",
        "sample": "$240.00"
      },
      {
        "name": "reservation.ref",
        "description": "Reservation reference id",
        "sample": "resv_123"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "Reservation confirmed",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "Your stay is confirmed!",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Check-in: {{reservation.checkIn}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Nights: {{reservation.nights}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Paid today: {{reservation.paid}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Reference: {{reservation.ref}}",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you made a reservation with {{host.businessName}}."
  },
  {
    "key": "gift-card",
    "name": "Gift card delivery",
    "description": "Delivers a purchased gift card to its recipient.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "Your gift card",
    "mergeTokens": [
      {
        "name": "giftcard.code",
        "description": "The gift card code",
        "sample": "GC-ABC123DEF456"
      },
      {
        "name": "giftcard.value",
        "description": "The gift card value",
        "sample": "$25.00"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "Your gift card",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "Gift card code: {{giftcard.code}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Value: {{giftcard.value}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Enter it at checkout to apply the balance.",
        "variant": "body"
      }
    ],
    "footerReason": "You’re receiving this because a gift card from {{host.businessName}} was sent to this address."
  },
  {
    "key": "supplier-fulfillment",
    "name": "Supplier fulfillment",
    "description": "Tells a dropship supplier there is a new order to fulfill.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "fixed"
  },
  {
    "key": "back-in-stock",
    "name": "Back in stock",
    "description": "Tells a customer a product they watched is available again.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "Back in stock: {{product.name}}",
    "mergeTokens": [
      {
        "name": "product.name",
        "description": "The product that restocked",
        "sample": "House Blend"
      },
      {
        "name": "product.url",
        "description": "Link to the product page",
        "sample": "/products/house-blend"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{product.name}} is available again — grab it before it sells out.",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "View product",
        "href": "{{product.url}}"
      }
    ],
    "footerReason": "You’re receiving this because you asked {{host.businessName}} to tell you when this was back."
  },
  {
    "key": "abandoned-cart",
    "name": "Abandoned cart",
    "description": "Reminds a shopper of items left in their cart.",
    "requiresFeature": "abandonedCart",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "You left something in your cart",
    "mergeTokens": [
      {
        "name": "cart.url",
        "description": "Link back to the shopper cart",
        "sample": "https://shop.example.com/cart"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "Your cart is still waiting — pick up where you left off.",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "Return to cart",
        "href": "{{cart.url}}"
      },
      {
        "block": "text",
        "text": "Your items are held but not reserved, so they may sell out.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you started a checkout with {{host.businessName}}."
  },
  {
    "key": "member-post",
    "name": "New member post",
    "description": "Notifies members when new members-only content is posted.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "{{post.title}}",
    "mergeTokens": [
      {
        "name": "post.title",
        "description": "The post’s title",
        "sample": "This month in the studio"
      },
      {
        "name": "post.body",
        "description": "The post, as its author wrote it",
        "sample": "Three new pieces are up for members first."
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{post.title}}",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "{{post.body}}",
        "variant": "body"
      }
    ],
    "footerReason": "You’re receiving this because you’re a member of {{host.businessName}}."
  },
  {
    "key": "member-password-reset",
    "name": "Member password reset",
    "description": "Resets a site member's password — a store-member account, separate from a console login. Sent when the member asks, and when a site administrator starts a reset for them.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "Reset your {{site.name}} password",
    "mergeTokens": [
      {
        "name": "site.name",
        "description": "The site’s name",
        "sample": "Northwind Coffee"
      },
      {
        "name": "reset.intro",
        "description": "Who started the reset",
        "sample": "Someone asked to reset the password for your Northwind Coffee account."
      },
      {
        "name": "resetUrl",
        "description": "The one-time reset link",
        "sample": "https://shop.example.com/recover?token=…"
      },
      {
        "name": "reset.note",
        "description": "How long the link lasts, and what to do if unexpected",
        "sample": "The link works once and expires in 1 hour. If you did not ask for this, you can safely ignore this email — your password is unchanged."
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "Reset your password",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "{{reset.intro}}",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "Set a new password",
        "href": "{{resetUrl}}"
      },
      {
        "block": "text",
        "text": "{{reset.note}}",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because a password reset was started for your {{host.businessName}} account."
  },
  {
    "key": "member-password-changed",
    "name": "Member password changed",
    "description": "Tells a site member that a site administrator set a new password on their account.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "Your {{site.name}} password was changed",
    "mergeTokens": [
      {
        "name": "site.name",
        "description": "The site’s name",
        "sample": "Northwind Coffee"
      },
      {
        "name": "signInUrl",
        "description": "Where the member signs back in",
        "sample": "https://shop.example.com"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "Your password was changed",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "An administrator of {{site.name}} set a new password on your account. You have been signed out on every device and will need the new password to sign back in.",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "Sign in",
        "href": "{{signInUrl}}"
      },
      {
        "block": "text",
        "text": "If you did not expect this, contact the site owner.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because the password on your {{host.businessName}} account was changed."
  },
  {
    "key": "newsletter-confirmation",
    "name": "Subscription confirmation",
    "description": "Asks someone who signed up for a site’s emails to confirm the address before anything is sent to it.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "Confirm your subscription",
    "mergeTokens": [
      {
        "name": "stream.name",
        "description": "What they signed up for",
        "sample": "our newsletter"
      },
      {
        "name": "confirmUrl",
        "description": "The confirmation link",
        "sample": "https://shop.example.com/subscribe/confirm?token=…"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "Confirm your subscription",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "Please confirm that you want to receive {{stream.name}} at this address.",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "Confirm my subscription",
        "href": "{{confirmUrl}}"
      },
      {
        "block": "text",
        "text": "The link works for three days. If you did not sign up, ignore this message — nothing will be sent.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because this address was entered on {{host.businessName}}’s signup form."
  },
  {
    "key": "campaign",
    "name": "Campaign broadcast",
    "description": "A campaign sent to the site's subscriber list.",
    "pluginId": "marketing",
    "plugin": "Marketing",
    "control": "external",
    "authoredIn": "Marketing → Campaigns",
    "footerReason": "You’re receiving this email from {{host.businessName}}."
  },
  {
    "key": "workflow-email",
    "name": "Workflow email step",
    "description": "An email sent by a workflow's send-email action when its trigger fires.",
    "pluginId": "workflows",
    "plugin": "Workflows",
    "control": "external",
    "authoredIn": "the workflow that sends it",
    "footerReason": "You’re receiving this because you’re in touch with {{host.businessName}}."
  }
]
