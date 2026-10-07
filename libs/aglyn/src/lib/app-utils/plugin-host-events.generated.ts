/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The host events plugins declare (AGL-3080): each plugin's `hostEvents`
 * in plugins.config.json, in `order`. Core's `host-events.ts` folds them
 * in beside the platform's own.
 */

import type { HostEventDeclaration } from './host-events'

/** Every host event a plugin declares. */
export type PluginHostEventType =
  | 'formSubmission'
  | 'memberSignUp'
  | 'memberSignIn'
  | 'memberSignOut'
  | 'lead'
  | 'booking'
  | 'taskCompleted'
  | 'contactCreated'
  | 'contactStageChanged'
  | 'dealStageChanged'
  | 'dealWon'
  | 'dealLost'
  | 'orderPaid'
  | 'orderFulfilled'
  | 'orderDelivered'
  | 'orderRefunded'
  | 'orderCancelled'
  | 'returnRequested'
  | 'returnApproved'
  | 'returnDeclined'
  | 'returnReceived'
  | 'returnRefunded'
  | 'funnelLeft'

export const PLUGIN_HOST_EVENTS: readonly HostEventDeclaration[] = [
  {
    "pluginId": "forms",
    "type": "formSubmission",
    "order": 10,
    "label": "Form submitted",
    "payloadKeys": [
      "formId",
      "formName",
      "path",
      "and every submitted field by name"
    ],
    "recipientActed": true
  },
  {
    "pluginId": "commerce",
    "type": "memberSignUp",
    "order": 30,
    "label": "Member signed up",
    "payloadKeys": [
      "email"
    ],
    "recipientActed": true
  },
  {
    "pluginId": "commerce",
    "type": "memberSignIn",
    "order": 40,
    "label": "Member signed in",
    "payloadKeys": [
      "email"
    ]
  },
  {
    "pluginId": "commerce",
    "type": "memberSignOut",
    "order": 50,
    "label": "Member signed out"
  },
  {
    "pluginId": "crm",
    "type": "lead",
    "order": 60,
    "label": "New lead",
    "payloadKeys": [
      "leadId",
      "email",
      "name",
      "source",
      "hostId",
      "formId",
      "campaignIds"
    ],
    "recipientActed": true
  },
  {
    "pluginId": "bookings",
    "type": "booking",
    "order": 70,
    "label": "New booking",
    "payloadKeys": [
      "serviceName",
      "email",
      "startsAtMs"
    ],
    "recipientActed": true
  },
  {
    "pluginId": "crm",
    "type": "taskCompleted",
    "order": 80,
    "label": "CRM task completed",
    "payloadKeys": [
      "taskId",
      "title",
      "kind",
      "priority",
      "dueAtMs",
      "completedAtMs",
      "completedByUid",
      "assigneeUid",
      "createdByUid",
      "contactId",
      "companyId",
      "dealId",
      "taskHostId"
    ]
  },
  {
    "pluginId": "crm",
    "type": "contactCreated",
    "order": 90,
    "label": "Contact created",
    "payloadKeys": [
      "contactId",
      "email",
      "name",
      "source",
      "hostId",
      "lifecycleStage",
      "campaignIds",
      "formId"
    ]
  },
  {
    "pluginId": "crm",
    "type": "contactStageChanged",
    "order": 100,
    "label": "Contact changed stage",
    "payloadKeys": [
      "contactId",
      "email",
      "lifecycleStage",
      "previousStage"
    ]
  },
  {
    "pluginId": "crm",
    "type": "dealStageChanged",
    "order": 110,
    "label": "Deal moved",
    "payloadKeys": [
      "dealId",
      "title",
      "amountCents",
      "currency",
      "stageId",
      "previousStageId",
      "ownerUid",
      "contactId",
      "companyId"
    ]
  },
  {
    "pluginId": "crm",
    "type": "dealWon",
    "order": 120,
    "label": "Deal won",
    "payloadKeys": [
      "dealId",
      "title",
      "amountCents",
      "currency",
      "stageId",
      "previousStageId",
      "ownerUid",
      "contactId",
      "companyId"
    ]
  },
  {
    "pluginId": "crm",
    "type": "dealLost",
    "order": 130,
    "label": "Deal lost",
    "payloadKeys": [
      "dealId",
      "title",
      "amountCents",
      "currency",
      "stageId",
      "previousStageId",
      "ownerUid",
      "contactId",
      "companyId",
      "lostReason"
    ]
  },
  {
    "pluginId": "commerce",
    "type": "orderPaid",
    "order": 140,
    "label": "Order paid",
    "payloadKeys": [
      "orderId",
      "orderNumber",
      "status",
      "channel",
      "email",
      "name",
      "totalCents",
      "currency"
    ]
  },
  {
    "pluginId": "commerce",
    "type": "orderFulfilled",
    "order": 141,
    "label": "Order fulfilled",
    "payloadKeys": [
      "orderId",
      "orderNumber",
      "status",
      "email",
      "name",
      "totalCents",
      "fulfillmentId",
      "carrier",
      "trackingNumber",
      "trackingUrl"
    ]
  },
  {
    "pluginId": "commerce",
    "type": "orderDelivered",
    "order": 142,
    "label": "Order delivered",
    "payloadKeys": [
      "orderId",
      "orderNumber",
      "status",
      "email",
      "name",
      "totalCents"
    ]
  },
  {
    "pluginId": "commerce",
    "type": "orderRefunded",
    "order": 143,
    "label": "Order refunded",
    "payloadKeys": [
      "orderId",
      "orderNumber",
      "status",
      "email",
      "name",
      "totalCents",
      "refundCents",
      "fullRefund"
    ]
  },
  {
    "pluginId": "commerce",
    "type": "orderCancelled",
    "order": 144,
    "label": "Order canceled",
    "payloadKeys": [
      "orderId",
      "orderNumber",
      "status",
      "email",
      "name",
      "totalCents"
    ]
  },
  {
    "pluginId": "commerce",
    "type": "returnRequested",
    "order": 145,
    "label": "Return requested",
    "payloadKeys": [
      "orderId",
      "orderNumber",
      "email",
      "name",
      "returnId",
      "returnStatus"
    ]
  },
  {
    "pluginId": "commerce",
    "type": "returnApproved",
    "order": 146,
    "label": "Return approved",
    "payloadKeys": [
      "orderId",
      "orderNumber",
      "email",
      "name",
      "returnId",
      "returnStatus"
    ]
  },
  {
    "pluginId": "commerce",
    "type": "returnDeclined",
    "order": 147,
    "label": "Return declined",
    "payloadKeys": [
      "orderId",
      "orderNumber",
      "email",
      "name",
      "returnId",
      "returnStatus"
    ]
  },
  {
    "pluginId": "commerce",
    "type": "returnReceived",
    "order": 148,
    "label": "Return received",
    "payloadKeys": [
      "orderId",
      "orderNumber",
      "email",
      "name",
      "returnId",
      "returnStatus"
    ]
  },
  {
    "pluginId": "commerce",
    "type": "returnRefunded",
    "order": 149,
    "label": "Return refunded",
    "payloadKeys": [
      "orderId",
      "orderNumber",
      "email",
      "name",
      "returnId",
      "returnStatus",
      "returnRefundCents"
    ]
  },
  {
    "pluginId": "funnels",
    "type": "funnelLeft",
    "order": 150,
    "label": "Left a funnel",
    "payloadKeys": [
      "funnelId",
      "funnelName",
      "step",
      "stepLabel",
      "nextStepLabel",
      "afterHours",
      "email"
    ]
  }
]
