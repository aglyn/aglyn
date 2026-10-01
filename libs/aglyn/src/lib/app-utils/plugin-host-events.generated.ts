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

export const PLUGIN_HOST_EVENTS: readonly HostEventDeclaration[] = [
  {
    "pluginId": "forms",
    "type": "formSubmission",
    "order": 10,
    "label": "Form submitted",
    "payloadKeys": [
      "formName",
      "path",
      "and every submitted field by name"
    ]
  },
  {
    "pluginId": "commerce",
    "type": "memberSignUp",
    "order": 30,
    "label": "Member signed up",
    "payloadKeys": [
      "email"
    ]
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
      "email",
      "source",
      "leadId"
    ]
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
    ]
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
  }
]
