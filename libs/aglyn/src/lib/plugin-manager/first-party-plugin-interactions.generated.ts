/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The interaction steps and recipes first-party plugins declare (AGL-3080),
 * apart from the rest of the catalog because a published page's interactions
 * runtime reads them (AGL-4220). first-party-plugins.generated.ts re-exports
 * both.
 */

import type { InteractionStepDeclaration } from '../app-utils/site-interactions'
import type { InteractionRecipeDeclaration } from './interaction-recipes'

/**
 * Every interaction step a first-party plugin offers in the interaction
 * builder, declared by that plugin (AGL-3080). Core names no plugin step.
 */
export const PLUGIN_INTERACTION_STEPS_DECLARED: readonly InteractionStepDeclaration[] = [
  {
    "pluginId": "crm",
    "type": "setContactStage",
    "label": "Set the contact’s lifecycle stage",
    "offered": false
  },
  {
    "pluginId": "crm",
    "type": "addContactTag",
    "label": "Tag the contact",
    "offered": false,
    "typedFields": [
      {
        "key": "tag",
        "names": "the tag"
      }
    ]
  },
  {
    "pluginId": "crm",
    "type": "assignContactOwner",
    "label": "Assign the contact an owner",
    "offered": false
  },
  {
    "pluginId": "crm",
    "type": "createCrmTask",
    "label": "Create a CRM task",
    "offered": false,
    "typedFields": [
      {
        "key": "title",
        "names": "the title"
      }
    ]
  },
  {
    "pluginId": "crm",
    "type": "logCrmActivity",
    "label": "Log a CRM activity",
    "offered": false,
    "typedFields": [
      {
        "key": "body",
        "names": "the text"
      }
    ]
  },
  {
    "pluginId": "data",
    "type": "datasetAppend",
    "label": "Write to a dataset",
    "offered": false,
    "typedFields": [
      {
        "key": "datasetName",
        "names": "the dataset"
      }
    ]
  },
  {
    "pluginId": "data",
    "type": "updateDataset",
    "label": "Update a dataset record",
    "offered": false,
    "typedFields": [
      {
        "key": "datasetName",
        "names": "the dataset"
      }
    ]
  },
  {
    "pluginId": "marketing",
    "type": "showOverlay",
    "label": "Open an overlay",
    "picks": {
      "collection": "overlays",
      "limit": 50,
      "idField": "overlayId",
      "nameField": "overlayName",
      "label": "Overlay",
      "missing": "pick an overlay"
    }
  },
  {
    "pluginId": "workflows",
    "type": "runWorkflow",
    "label": "Run a workflow",
    "typedFields": [
      {
        "key": "workflowName",
        "names": "the workflow"
      }
    ],
    "picks": {
      "collection": "workflows",
      "limit": 100,
      "idField": "workflowId",
      "nameField": "workflowName",
      "label": "Workflow",
      "missing": "pick a workflow"
    }
  },
  {
    "pluginId": "workflows",
    "type": "customEvent",
    "label": "Fire a custom event",
    "offered": false
  },
  {
    "pluginId": "workflows",
    "type": "webhookPost",
    "label": "Send a webhook (Pro)",
    "offered": false,
    "typedFields": [
      {
        "key": "webhookName",
        "names": "the webhook"
      }
    ]
  },
  {
    "pluginId": "workflows",
    "type": "sendEmail",
    "label": "Send an email",
    "offered": false,
    "typedFields": [
      {
        "key": "subject",
        "names": "the subject"
      },
      {
        "key": "body",
        "names": "the text"
      }
    ]
  },
  {
    "pluginId": "workflows",
    "type": "notifyAdmins",
    "label": "Notify site admins",
    "offered": false,
    "typedFields": [
      {
        "key": "title",
        "names": "the title"
      },
      {
        "key": "body",
        "names": "the text"
      }
    ]
  },
  {
    "pluginId": "workflows",
    "type": "enrollList",
    "label": "Enroll in a list",
    "offered": false,
    "typedFields": [
      {
        "key": "listName",
        "names": "the list"
      }
    ]
  },
  {
    "pluginId": "workflows",
    "type": "assignCampaign",
    "label": "Assign to a campaign",
    "offered": false,
    "typedFields": [
      {
        "key": "campaignName",
        "names": "the campaign"
      }
    ]
  },
  {
    "pluginId": "workflows",
    "type": "wait",
    "label": "Wait",
    "offered": false,
    "holds": {
      "minMinutes": 1,
      "maxMinutes": 129600
    }
  },
  {
    "pluginId": "workflows",
    "type": "waitForEvent",
    "label": "Wait for something to happen",
    "offered": false,
    "holds": {
      "minMinutes": 1,
      "maxMinutes": 129600,
      "timeoutField": "_waitTimedOut"
    }
  },
  {
    "pluginId": "workflows",
    "type": "exitFlow",
    "label": "End the flow here",
    "offered": false
  },
]

/**
 * Every ready-to-edit interaction a first-party plugin offers, by the id a
 * stored interaction's stamp names it with, declared by that plugin
 * (AGL-3080). Core names no recipe.
 */
export const PLUGIN_INTERACTION_RECIPES_DECLARED: readonly InteractionRecipeDeclaration[] = [
  {
    "pluginId": "crm",
    "id": "welcomeNewLead"
  },
  {
    "pluginId": "crm",
    "id": "followUpWonDeal"
  },
  {
    "pluginId": "crm",
    "id": "reengageStaleLead"
  },
  {
    "pluginId": "crm",
    "id": "tagByForm"
  },
]
