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
        "text": "{{host.businessName}} · Booking",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "You’re booked: {{service.name}}",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "Hi {{name}}, your booking with {{host.businessName}} is confirmed. Here are the details to keep.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Service: {{service.name}}\nWhen: {{when}} ({{timezone}})\nReference: {{booking.ref}}",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "{{booking.payment}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Need to change it? Reply to this email and {{host.businessName}} will help.",
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
        "text": "{{host.businessName}} · Booking",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Your booking is coming up",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "Hi {{name}}, this is a reminder of your booking with {{host.businessName}}.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Service: {{service.name}}\nWhen: {{when}} ({{timezone}})",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "Can no longer make it? Reply to this email so {{host.businessName}} can offer the time to someone else.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you have a booking with {{host.businessName}}."
  },
  {
    "key": "booking-rescheduled",
    "name": "Booking rescheduled",
    "description": "Tells the customer their booking moved to a new time.",
    "pluginId": "bookings",
    "plugin": "Bookings",
    "control": "besigner",
    "defaultSubject": "New time for {{service.name}}",
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
        "description": "The new date and time of the booking",
        "sample": "Wednesday, June 3, 2026 at 10:30 AM"
      },
      {
        "name": "previousWhen",
        "description": "The date and time the booking moved from",
        "sample": "Monday, June 1, 2026 at 9:00 AM"
      },
      {
        "name": "timezone",
        "description": "Timezone the times are shown in",
        "sample": "America/Chicago"
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
        "text": "{{host.businessName}} · Booking",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Your booking has a new time",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "Hi {{name}}, your booking with {{host.businessName}} moved. The new time is below; the old one no longer applies.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Service: {{service.name}}\nNew time: {{when}} ({{timezone}})\nWas: {{previousWhen}}\nReference: {{booking.ref}}",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "Does the new time not work? Reply to this email and {{host.businessName}} will help.",
        "variant": "caption"
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
      },
      {
        "name": "store.receiptFooter",
        "description": "The Receipt footer from the store settings; empty when none is set",
        "sample": "Returns are accepted within 30 days."
      },
      {
        "name": "order.number",
        "description": "The order number, as the store shows it",
        "sample": "#1042"
      },
      {
        "name": "order.statusUrl",
        "description": "Link to the order status page: status, shipments and tracking. Private to the buyer; it needs no account",
        "sample": "https://shop.example.com/order-status?o=ord_123&t=…"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Order {{order.number}}",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Thanks for your order",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "Here is the receipt for your order from {{host.businessName}}. We will email you again as your order moves along, and the order page always shows where it is.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{order.summary}}\nTotal charged: {{order.total}}",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "{{store.receiptFooter}}",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "View your order",
        "href": "{{order.statusUrl}}"
      },
      {
        "block": "text",
        "text": "Order {{order.number}} · payment reference {{order.ref}}. Questions about your order? Reply to this email and {{host.businessName}} will get back to you.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you placed an order with {{host.businessName}}."
  },
  {
    "key": "order-shipped",
    "name": "Order shipped",
    "description": "Tells the buyer part or all of their order is on its way, with the carrier and a tracking link when the shipment has one. Sent once per shipment.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "Your order {{order.number}} has shipped",
    "mergeTokens": [
      {
        "name": "order.number",
        "description": "The order number, as the store shows it",
        "sample": "#1042"
      },
      {
        "name": "shipment.summary",
        "description": "The items in this shipment, one per line",
        "sample": "2× House Blend"
      },
      {
        "name": "shipment.carrier",
        "description": "The carrier; empty when none was recorded",
        "sample": "UPS"
      },
      {
        "name": "shipment.trackingNumber",
        "description": "The tracking number; empty when none was recorded",
        "sample": "1Z999AA10123456784"
      },
      {
        "name": "shipment.tracking",
        "description": "A sentence with the carrier, tracking number and tracking link; empty when the shipment has no tracking number",
        "sample": "Tracking: UPS 1Z999AA10123456784 — https://www.ups.com/track?tracknum=1Z999AA10123456784"
      },
      {
        "name": "shipment.remaining",
        "description": "A sentence saying how many items are still to ship; empty when this shipment completes the order",
        "sample": "1 more item will ship separately."
      },
      {
        "name": "order.statusUrl",
        "description": "Link to the order status page: status, shipments and tracking. Private to the buyer; it needs no account",
        "sample": "https://shop.example.com/order-status?o=ord_123&t=…"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Order {{order.number}}",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Your order is on its way",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "{{host.businessName}} shipped these items from order {{order.number}}.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{shipment.summary}}",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "{{shipment.tracking}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{shipment.remaining}}",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "Track your order",
        "href": "{{order.statusUrl}}"
      },
      {
        "block": "text",
        "text": "The order page shows every shipment and its tracking as it moves. Questions about your order? Reply to this email and {{host.businessName}} will get back to you.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you placed an order with {{host.businessName}}."
  },
  {
    "key": "order-delivered",
    "name": "Order delivered",
    "description": "Tells the buyer their order was marked delivered.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "Your order {{order.number}} was delivered",
    "mergeTokens": [
      {
        "name": "order.number",
        "description": "The order number, as the store shows it",
        "sample": "#1042"
      },
      {
        "name": "order.summary",
        "description": "The ordered items, one per line",
        "sample": "2× House Blend"
      },
      {
        "name": "order.statusUrl",
        "description": "Link to the order status page: status, shipments and tracking. Private to the buyer; it needs no account",
        "sample": "https://shop.example.com/order-status?o=ord_123&t=…"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Order {{order.number}}",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Your order was delivered",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "{{host.businessName}} marked order {{order.number}} as delivered. We hope you enjoy it.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{order.summary}}",
        "variant": "details"
      },
      {
        "block": "button",
        "label": "View your order",
        "href": "{{order.statusUrl}}"
      },
      {
        "block": "text",
        "text": "Something missing or not right? Reply to this email and {{host.businessName}} will sort it out.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you placed an order with {{host.businessName}}."
  },
  {
    "key": "order-refunded",
    "name": "Order refunded",
    "description": "Tells the buyer a refund was issued, for how much and, when the store refunded named items, which ones. Sent once per refund.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "Refund for your order {{order.number}}",
    "mergeTokens": [
      {
        "name": "order.number",
        "description": "The order number, as the store shows it",
        "sample": "#1042"
      },
      {
        "name": "refund.amount",
        "description": "The amount of this refund",
        "sample": "$12.00"
      },
      {
        "name": "refund.summary",
        "description": "The refunded items, one per line; empty when the refund was by amount only",
        "sample": "1× House Blend"
      },
      {
        "name": "refund.note",
        "description": "Whether the order is now fully refunded, as a sentence",
        "sample": "Your order has been refunded in full."
      },
      {
        "name": "order.statusUrl",
        "description": "Link to the order status page: status, shipments and tracking. Private to the buyer; it needs no account",
        "sample": "https://shop.example.com/order-status?o=ord_123&t=…"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Order {{order.number}}",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Your refund is on its way",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "{{host.businessName}} refunded {{refund.amount}} on order {{order.number}}.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{refund.summary}}\nTotal refunded: {{refund.amount}}",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "{{refund.note}}",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "View your order",
        "href": "{{order.statusUrl}}"
      },
      {
        "block": "text",
        "text": "Refunds go back to the original payment method and usually appear within 5 to 10 business days, depending on your bank.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you placed an order with {{host.businessName}}."
  },
  {
    "key": "order-cancelled",
    "name": "Order canceled",
    "description": "Tells the buyer their order was canceled.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "Your order {{order.number}} was canceled",
    "mergeTokens": [
      {
        "name": "order.number",
        "description": "The order number, as the store shows it",
        "sample": "#1042"
      },
      {
        "name": "order.summary",
        "description": "The ordered items, one per line",
        "sample": "2× House Blend"
      },
      {
        "name": "cancel.note",
        "description": "What happens to the payment, as a sentence; empty when nothing was paid",
        "sample": "Any payment you made will be refunded, and you will get a separate email when it is."
      },
      {
        "name": "order.statusUrl",
        "description": "Link to the order status page: status, shipments and tracking. Private to the buyer; it needs no account",
        "sample": "https://shop.example.com/order-status?o=ord_123&t=…"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Order {{order.number}}",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Your order was canceled",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "{{host.businessName}} canceled order {{order.number}}. These items will not be sent.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{order.summary}}",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "{{cancel.note}}",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "View your order",
        "href": "{{order.statusUrl}}"
      },
      {
        "block": "text",
        "text": "Questions about your order? Reply to this email and {{host.businessName}} will get back to you.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you placed an order with {{host.businessName}}."
  },
  {
    "key": "order-ready-for-pickup",
    "name": "Order ready for pickup",
    "description": "Tells the buyer their pickup order is ready, where to collect it, the pickup hours and any arrival instructions.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "Your order {{order.number}} is ready for pickup",
    "mergeTokens": [
      {
        "name": "order.number",
        "description": "The order number, as the store shows it",
        "sample": "#1042"
      },
      {
        "name": "order.summary",
        "description": "The ordered items, one per line",
        "sample": "2× House Blend"
      },
      {
        "name": "pickup.location",
        "description": "The pickup location’s name and address",
        "sample": "Main Street shop, 12 Main St, Springfield"
      },
      {
        "name": "pickup.hours",
        "description": "The location’s pickup hours; empty when it lists none",
        "sample": "Pickup hours:\nMo-Fr 09:00-17:00"
      },
      {
        "name": "pickup.instructions",
        "description": "What to do on arrival, as the store wrote it; empty when it wrote none",
        "sample": "Ring the bell at the side door."
      },
      {
        "name": "order.statusUrl",
        "description": "Link to the order status page: status, shipments and tracking. Private to the buyer; it needs no account",
        "sample": "https://shop.example.com/order-status?o=ord_123&t=…"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Order {{order.number}}",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Your order is ready for pickup",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "Order {{order.number}} is packed and waiting for you at {{pickup.location}}.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{order.summary}}\nPick up at: {{pickup.location}}",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "{{pickup.hours}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{pickup.instructions}}",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "View your order",
        "href": "{{order.statusUrl}}"
      },
      {
        "block": "text",
        "text": "Bring your order number, {{order.number}}. Questions about your order? Reply to this email and {{host.businessName}} will get back to you.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you placed an order with {{host.businessName}}."
  },
  {
    "key": "order-picked-up",
    "name": "Order picked up",
    "description": "Confirms to the buyer that their pickup order was collected.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "You picked up order {{order.number}}",
    "mergeTokens": [
      {
        "name": "order.number",
        "description": "The order number, as the store shows it",
        "sample": "#1042"
      },
      {
        "name": "order.summary",
        "description": "The ordered items, one per line",
        "sample": "2× House Blend"
      },
      {
        "name": "pickup.location",
        "description": "The pickup location’s name and address",
        "sample": "Main Street shop, 12 Main St, Springfield"
      },
      {
        "name": "order.statusUrl",
        "description": "Link to the order status page: status, shipments and tracking. Private to the buyer; it needs no account",
        "sample": "https://shop.example.com/order-status?o=ord_123&t=…"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Order {{order.number}}",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Thanks for picking up your order",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "Order {{order.number}} was picked up from {{pickup.location}}. Enjoy it.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{order.summary}}\nPicked up at: {{pickup.location}}",
        "variant": "details"
      },
      {
        "block": "button",
        "label": "View your order",
        "href": "{{order.statusUrl}}"
      },
      {
        "block": "text",
        "text": "Something missing or not right? Reply to this email and {{host.businessName}} will sort it out.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you placed an order with {{host.businessName}}."
  },
  {
    "key": "order-out-for-delivery",
    "name": "Order out for delivery",
    "description": "Tells the buyer the store’s own driver is on the way with their local delivery, in the window they booked.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "Your order {{order.number}} is out for delivery",
    "mergeTokens": [
      {
        "name": "order.number",
        "description": "The order number, as the store shows it",
        "sample": "#1042"
      },
      {
        "name": "order.summary",
        "description": "The ordered items, one per line",
        "sample": "2× House Blend"
      },
      {
        "name": "delivery.window",
        "description": "The delivery window the buyer booked",
        "sample": "Tue, Oct 14, 9:00 AM – 12:00 PM"
      },
      {
        "name": "order.statusUrl",
        "description": "Link to the order status page: status, shipments and tracking. Private to the buyer; it needs no account",
        "sample": "https://shop.example.com/order-status?o=ord_123&t=…"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Order {{order.number}}",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Your order is out for delivery",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "{{host.businessName}} is on the way with order {{order.number}}.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{order.summary}}\nDelivery window: {{delivery.window}}",
        "variant": "details"
      },
      {
        "block": "button",
        "label": "View your order",
        "href": "{{order.statusUrl}}"
      },
      {
        "block": "text",
        "text": "Questions about your order? Reply to this email and {{host.businessName}} will get back to you.",
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
      },
      {
        "name": "orders.url",
        "description": "The site’s Orders page in the console",
        "sample": "https://app.example.com/northwind/hosts/northwind/products/orders"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{site.name}} · New order",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "You made a sale",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "A new paid order came in on {{site.name}}. Here is what was bought and who bought it.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{order.summary}}\nTotal: {{order.total}}\nBuyer: {{buyer.email}}\nPayment reference: {{order.ref}}",
        "variant": "details"
      },
      {
        "block": "button",
        "label": "Open orders",
        "href": "{{orders.url}}"
      },
      {
        "block": "text",
        "text": "Fulfill it from Orders: as you mark it shipped, ready for pickup or delivered, the buyer is emailed at each step.",
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
        "description": "What the guest was charged today, lodging tax included; a charge that carried lodging tax names it, as in “$254.40, including $14.40 lodging tax”",
        "sample": "$240.00"
      },
      {
        "name": "reservation.balance",
        "description": "What is still owed for the stay and where it is paid, as a sentence; empty when the stay is paid in full",
        "sample": "Still to pay: $360.00, at the property. It has not been charged."
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
        "text": "{{host.businessName}} · Reservation",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Your stay is confirmed",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "Your reservation at {{host.businessName}} is booked. Here are the details to keep.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Check-in: {{reservation.checkIn}}\nNights: {{reservation.nights}}\nPaid today: {{reservation.paid}}\nReference: {{reservation.ref}}",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "{{reservation.balance}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Questions before you arrive? Reply to this email and {{host.businessName}} will get back to you.",
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
    "defaultSubject": "Your gift card for {{host.businessName}}",
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
      },
      {
        "name": "giftcard.note",
        "description": "The note written when the card was issued by hand; empty for a card bought at checkout",
        "sample": "Happy birthday, Sam!"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Gift card",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Your {{giftcard.value}} gift card",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "You have a {{giftcard.value}} gift card for {{host.businessName}}.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{giftcard.note}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Value: {{giftcard.value}}\nGift card code: {{giftcard.code}}",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "Enter the code at checkout on {{host.url}} to use its balance.",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "Shop {{host.businessName}}",
        "href": "{{host.url}}"
      },
      {
        "block": "text",
        "text": "Keep this email: the code is what you spend the card with.",
        "variant": "caption"
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
        "sample": "https://shop.example.com/products/house-blend"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}}",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "{{product.name}} is back in stock",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "You asked to hear when {{product.name}} was back at {{host.businessName}}. It is, and you can order it now.",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "Shop {{product.name}}",
        "href": "{{product.url}}"
      },
      {
        "block": "text",
        "text": "You asked {{host.businessName}} to tell you when it was back. Nothing is held for you.",
        "variant": "caption"
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
        "text": "{{host.businessName}}",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "You left something in your cart",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "Your cart at {{host.businessName}} still has your items in it. Pick up where you left off whenever you are ready.",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "Return to your cart",
        "href": "{{cart.url}}"
      },
      {
        "block": "text",
        "text": "Nothing in your cart is held for you.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you started a checkout with {{host.businessName}}."
  },
  {
    "key": "review-request",
    "name": "Review request",
    "description": "Asks a buyer to review what they bought, a set number of days after the order is fulfilled. One per order; each product has its own single-use link. Turn it off or change the delay in Settings → Reviews.",
    "requiresFeature": "productReviews",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "How was your order from {{host.businessName}}?",
    "mergeTokens": [
      {
        "name": "order.number",
        "description": "The order number, as the store shows it",
        "sample": "#1042"
      },
      {
        "name": "review.products",
        "description": "Each product to review, one per line, with its own review link",
        "sample": "House Blend: https://shop.example.com/products/house-blend?review=…"
      },
      {
        "name": "review.url",
        "description": "The review link for the first product",
        "sample": "https://shop.example.com/products/house-blend?review=…"
      },
      {
        "name": "review.productName",
        "description": "The first product’s name",
        "sample": "House Blend"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Order {{order.number}}",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "How did we do?",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "Thanks again for your order {{order.number}} from {{host.businessName}}. Would you tell other shoppers what you think? Each link opens the product with a review form ready.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{review.products}}",
        "variant": "links"
      },
      {
        "block": "button",
        "label": "Write a review",
        "href": "{{review.url}}"
      },
      {
        "block": "text",
        "text": "Each link works once, for 60 days.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you placed an order with {{host.businessName}}."
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
        "text": "{{host.businessName}} · Members",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "{{post.title}}",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "{{post.body}}",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "Visit {{host.businessName}}",
        "href": "{{host.url}}"
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
        "text": "{{site.name}} · Account security",
        "variant": "eyebrow"
      },
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
        "text": "{{site.name}} · Account security",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Your password was changed",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "An administrator of {{site.name}} set a new password on your account and signed you out on every device. To sign back in, get the new password from them, or choose \"Forgot password?\" on the sign-in page to set your own.",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "Sign in",
        "href": "{{signInUrl}}"
      },
      {
        "block": "text",
        "text": "If you did not expect this, contact the site owner straight away.",
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
        "sample": "Newsletter"
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
        "text": "{{host.businessName}}",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Confirm your subscription",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "Please confirm that you want {{stream.name}} emails from {{host.businessName}} at this address. Nothing is sent until you do.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "List: {{stream.name}}\nFrom: {{host.businessName}}",
        "variant": "details"
      },
      {
        "block": "button",
        "label": "Confirm my subscription",
        "href": "{{confirmUrl}}"
      },
      {
        "block": "text",
        "text": "The link works for three days. If you did not sign up, ignore this message and nothing will be sent.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because this address was entered on {{host.businessName}}’s signup form."
  },
  {
    "key": "return-requested",
    "name": "Return requested",
    "description": "Tells the store a buyer asked to return items, with what and why, so someone can approve or decline it.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "Return requested for order {{order.number}}",
    "mergeTokens": [
      {
        "name": "order.number",
        "description": "The order number, as the store shows it",
        "sample": "#1042"
      },
      {
        "name": "return.items",
        "description": "The items being returned, one per line, with the reason",
        "sample": "1× House Blend — Arrived damaged"
      },
      {
        "name": "buyer.email",
        "description": "The buyer’s email",
        "sample": "buyer@example.com"
      },
      {
        "name": "return.customerNote",
        "description": "What the buyer wrote; empty when they wrote nothing",
        "sample": "The lid was cracked."
      },
      {
        "name": "return.url",
        "description": "The return in the console, to approve or decline",
        "sample": "https://app.example.com/northwind/hosts/northwind/products/returns?return=ret_123"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Order {{order.number}}",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "A buyer asked for a return",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "{{buyer.email}} wants to return items from order {{order.number}}. Approve or decline it, and the buyer is emailed your answer.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{return.items}}\nBuyer: {{buyer.email}}",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "{{return.customerNote}}",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "Review the return",
        "href": "{{return.url}}"
      },
      {
        "block": "text",
        "text": "Returns are under Products → Returns, beside the order they are for.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you manage {{host.businessName}}."
  },
  {
    "key": "return-approved",
    "name": "Return approved",
    "description": "Tells the buyer their return was approved and how to send the items back, with the return label when the store attached one.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "Your return for order {{order.number}} is approved",
    "mergeTokens": [
      {
        "name": "order.number",
        "description": "The order number, as the store shows it",
        "sample": "#1042"
      },
      {
        "name": "return.items",
        "description": "The items being returned, one per line, with the reason",
        "sample": "1× House Blend — Arrived damaged"
      },
      {
        "name": "return.note",
        "description": "The store’s note to the buyer on this return; empty when none",
        "sample": "Please include the original packaging."
      },
      {
        "name": "return.label",
        "description": "A sentence with the return label link and its tracking; empty when the store attached no label",
        "sample": "Print your return label: https://labels.example.com/r/123"
      },
      {
        "name": "order.statusUrl",
        "description": "Link to the order status page: status, shipments and tracking. Private to the buyer; it needs no account",
        "sample": "https://shop.example.com/order-status?o=ord_123&t=…"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Order {{order.number}}",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Your return is approved",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "{{host.businessName}} approved the return of these items from order {{order.number}}.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{return.items}}",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "What to do next",
        "variant": "subheading"
      },
      {
        "block": "text",
        "text": "{{return.note}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{return.label}}",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "View your order",
        "href": "{{order.statusUrl}}"
      },
      {
        "block": "text",
        "text": "Your refund is sent once {{host.businessName}} receives the items, and you will get an email when it is.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you placed an order with {{host.businessName}}."
  },
  {
    "key": "return-declined",
    "name": "Return declined",
    "description": "Tells the buyer their return was declined, with the store’s note.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "About your return for order {{order.number}}",
    "mergeTokens": [
      {
        "name": "order.number",
        "description": "The order number, as the store shows it",
        "sample": "#1042"
      },
      {
        "name": "return.items",
        "description": "The items being returned, one per line, with the reason",
        "sample": "1× House Blend — Arrived damaged"
      },
      {
        "name": "return.note",
        "description": "The store’s note to the buyer on this return; empty when none",
        "sample": "Please include the original packaging."
      },
      {
        "name": "order.statusUrl",
        "description": "Link to the order status page: status, shipments and tracking. Private to the buyer; it needs no account",
        "sample": "https://shop.example.com/order-status?o=ord_123&t=…"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Order {{order.number}}",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "We could not accept this return",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "{{host.businessName}} declined the return of these items from order {{order.number}}.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{return.items}}",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "{{return.note}}",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "View your order",
        "href": "{{order.statusUrl}}"
      },
      {
        "block": "text",
        "text": "Questions about it? Reply to this email and {{host.businessName}} will get back to you.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you placed an order with {{host.businessName}}."
  },
  {
    "key": "return-refunded",
    "name": "Return refunded",
    "description": "Tells the buyer their return was received and refunded, and how much.",
    "pluginId": "commerce",
    "plugin": "Commerce",
    "control": "besigner",
    "defaultSubject": "Your refund for order {{order.number}}",
    "mergeTokens": [
      {
        "name": "order.number",
        "description": "The order number, as the store shows it",
        "sample": "#1042"
      },
      {
        "name": "return.items",
        "description": "The items being returned, one per line, with the reason",
        "sample": "1× House Blend — Arrived damaged"
      },
      {
        "name": "return.refundTotal",
        "description": "The amount refunded for this return",
        "sample": "$24.00"
      },
      {
        "name": "order.statusUrl",
        "description": "Link to the order status page: status, shipments and tracking. Private to the buyer; it needs no account",
        "sample": "https://shop.example.com/order-status?o=ord_123&t=…"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Order {{order.number}}",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Your return is refunded",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "{{host.businessName}} received your return and refunded {{return.refundTotal}} to your original payment method.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{return.items}}\nTotal refunded: {{return.refundTotal}}",
        "variant": "details"
      },
      {
        "block": "button",
        "label": "View your order",
        "href": "{{order.statusUrl}}"
      },
      {
        "block": "text",
        "text": "Refunds usually appear within 5 to 10 business days, depending on your bank.",
        "variant": "caption"
      }
    ],
    "footerReason": "You’re receiving this because you placed an order with {{host.businessName}}."
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
  },
  {
    "key": "loyalty-points-earned",
    "name": "Rewards points earned",
    "description": "Tells a customer the points an order earned them, their balance and their rewards code.",
    "pluginId": "loyalty",
    "plugin": "Rewards",
    "control": "besigner",
    "defaultSubject": "You earned {{loyalty.points}} points",
    "mergeTokens": [
      {
        "name": "name",
        "description": "The member's name, when the store knows it",
        "sample": "Alex"
      },
      {
        "name": "loyalty.balance",
        "description": "Points the member holds now",
        "sample": "1,250"
      },
      {
        "name": "loyalty.value",
        "description": "What those points are worth",
        "sample": "$12.50"
      },
      {
        "name": "loyalty.credit",
        "description": "Store credit the member holds",
        "sample": "$10.00"
      },
      {
        "name": "loyalty.code",
        "description": "The member’s rewards code, to spend their balance",
        "sample": "RW-7K3P-Q9XZ-2M4D"
      },
      {
        "name": "loyalty.referral",
        "description": "A sentence with the member’s referral code and what it gives; empty when referrals are off",
        "sample": "Share your referral code RF-7K3P9X: a friend gets $10.00 off their first order, and you get $10.00 in store credit."
      },
      {
        "name": "loyalty.points",
        "description": "Points this order earned",
        "sample": "45"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Rewards",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "You earned {{loyalty.points}} points",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "Thanks for your order with {{host.businessName}}, {{name}}. Here is where your rewards stand.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Points: {{loyalty.balance}} (worth {{loyalty.value}})\nStore credit: {{loyalty.credit}}\nRewards code: {{loyalty.code}}",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "Enter your rewards code at checkout on {{host.url}}, or give it at the register, to spend your balance.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{loyalty.referral}}",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "Shop {{host.businessName}}",
        "href": "{{host.url}}"
      }
    ],
    "footerReason": "You’re receiving this because you earned rewards with an order from {{host.businessName}}."
  },
  {
    "key": "loyalty-store-credit",
    "name": "Store credit given",
    "description": "Tells a customer the store gave them store credit, with their rewards code to spend it.",
    "pluginId": "loyalty",
    "plugin": "Rewards",
    "control": "besigner",
    "defaultSubject": "You have {{loyalty.amount}} in store credit",
    "mergeTokens": [
      {
        "name": "name",
        "description": "The member's name, when the store knows it",
        "sample": "Alex"
      },
      {
        "name": "loyalty.balance",
        "description": "Points the member holds now",
        "sample": "1,250"
      },
      {
        "name": "loyalty.value",
        "description": "What those points are worth",
        "sample": "$12.50"
      },
      {
        "name": "loyalty.credit",
        "description": "Store credit the member holds",
        "sample": "$10.00"
      },
      {
        "name": "loyalty.code",
        "description": "The member’s rewards code, to spend their balance",
        "sample": "RW-7K3P-Q9XZ-2M4D"
      },
      {
        "name": "loyalty.referral",
        "description": "A sentence with the member’s referral code and what it gives; empty when referrals are off",
        "sample": "Share your referral code RF-7K3P9X: a friend gets $10.00 off their first order, and you get $10.00 in store credit."
      },
      {
        "name": "loyalty.amount",
        "description": "The credit given",
        "sample": "$10.00"
      },
      {
        "name": "loyalty.note",
        "description": "The note the store wrote; empty when none",
        "sample": "Sorry about the delay!"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Rewards",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "You have {{loyalty.amount}} in store credit",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "{{host.businessName}} added {{loyalty.amount}} of store credit to your rewards.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "{{loyalty.note}}",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Points: {{loyalty.balance}} (worth {{loyalty.value}})\nStore credit: {{loyalty.credit}}\nRewards code: {{loyalty.code}}",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "Enter your rewards code at checkout on {{host.url}}, or give it at the register, to spend your balance.",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "Shop {{host.businessName}}",
        "href": "{{host.url}}"
      }
    ],
    "footerReason": "You’re receiving this because {{host.businessName}} gave you store credit."
  },
  {
    "key": "loyalty-referral-reward",
    "name": "Referral reward",
    "description": "Tells a customer a friend’s first order earned them store credit.",
    "pluginId": "loyalty",
    "plugin": "Rewards",
    "control": "besigner",
    "defaultSubject": "A friend’s first order earned you {{loyalty.amount}}",
    "mergeTokens": [
      {
        "name": "name",
        "description": "The member's name, when the store knows it",
        "sample": "Alex"
      },
      {
        "name": "loyalty.balance",
        "description": "Points the member holds now",
        "sample": "1,250"
      },
      {
        "name": "loyalty.value",
        "description": "What those points are worth",
        "sample": "$12.50"
      },
      {
        "name": "loyalty.credit",
        "description": "Store credit the member holds",
        "sample": "$10.00"
      },
      {
        "name": "loyalty.code",
        "description": "The member’s rewards code, to spend their balance",
        "sample": "RW-7K3P-Q9XZ-2M4D"
      },
      {
        "name": "loyalty.referral",
        "description": "A sentence with the member’s referral code and what it gives; empty when referrals are off",
        "sample": "Share your referral code RF-7K3P9X: a friend gets $10.00 off their first order, and you get $10.00 in store credit."
      },
      {
        "name": "loyalty.amount",
        "description": "The reward",
        "sample": "$10.00"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Rewards",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Your referral paid off",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "A friend used your referral code at {{host.businessName}}, so you have {{loyalty.amount}} more in store credit. Thanks for spreading the word.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Points: {{loyalty.balance}} (worth {{loyalty.value}})\nStore credit: {{loyalty.credit}}\nRewards code: {{loyalty.code}}",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "Enter your rewards code at checkout on {{host.url}}, or give it at the register, to spend your balance.",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "Shop {{host.businessName}}",
        "href": "{{host.url}}"
      }
    ],
    "footerReason": "You’re receiving this because a friend used your referral code at {{host.businessName}}."
  },
  {
    "key": "waiver-signed",
    "name": "Signed waiver copy",
    "description": "Sends a signer their signed waiver as a PDF, with who it covers and for how long.",
    "pluginId": "waivers",
    "plugin": "Waivers",
    "control": "besigner",
    "defaultSubject": "Your signed waiver for {{host.businessName}}",
    "mergeTokens": [
      {
        "name": "name",
        "description": "The signer’s name",
        "sample": "Alex Rivera"
      },
      {
        "name": "waiver.title",
        "description": "The waiver’s title",
        "sample": "Rider release and waiver"
      },
      {
        "name": "waiver.signedAt",
        "description": "When it was signed, in the site’s time zone",
        "sample": "Oct 24, 2026, 9:14 AM"
      },
      {
        "name": "waiver.people",
        "description": "Everyone it covers: the signer and any minors",
        "sample": "Alex Rivera, Sam Rivera"
      },
      {
        "name": "waiver.validity",
        "description": "The days it covers",
        "sample": "Good for Oct 24, 2026"
      }
    ],
    "defaultBody": [
      {
        "block": "text",
        "text": "{{host.businessName}} · Waiver",
        "variant": "eyebrow"
      },
      {
        "block": "text",
        "text": "Your signed waiver",
        "variant": "heading"
      },
      {
        "block": "text",
        "text": "Thanks, {{name}}. You signed {{waiver.title}} for {{host.businessName}}. Your signed copy is attached to this email as a PDF.",
        "variant": "body"
      },
      {
        "block": "text",
        "text": "Signed: {{waiver.signedAt}}\nCovers: {{waiver.people}}\n{{waiver.validity}}",
        "variant": "details"
      },
      {
        "block": "text",
        "text": "You don’t need to print it: staff can find your waiver by name when you arrive. If anything on it is wrong, contact {{host.businessName}}.",
        "variant": "body"
      },
      {
        "block": "button",
        "label": "Visit {{host.businessName}}",
        "href": "{{host.url}}"
      }
    ],
    "footerReason": "You’re receiving this because you signed a waiver for {{host.businessName}}."
  }
]
