/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { CONTACT_FIELD_TYPES } from '@aglyn/aglyn/app-utils/contact-custom-fields'
import { CRM_FIELD_OBJECTS } from '@aglyn/aglyn/app-utils/crm'
import {
  registerPluginAiCapability,
  type PluginAiCapability,
  type PluginAiCapabilityArgs,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  CRM_FIELD_LABEL_MAX_LENGTH,
  CRM_FIELD_OPTION_MAX_LENGTH,
  CRM_FIELD_OPTIONS_MAX,
  CRM_FIELD_SETUP_RESOURCE,
  CRM_PIPELINE_SETUP_RESOURCE,
  CRM_SETUP_OPEN_STAGES_MAX,
  CRM_SETUP_STAGE_NAME_MAX,
} from '../model/crm-setup-content'
import { PIPELINE_NAME_MAX } from '../model/deal-board-model'

/**
 * WHAT AN AI BUILD CAN SET UP IN THE CRM (AGL-3746): a deal pipeline with its
 * stages, and a custom field on a contact, company, deal or lead.
 *
 * The capabilities the AI plugin's build planner offers for "set up a sales
 * pipeline for my agency: Discovery, Proposal, Negotiation, Won/Lost" or
 * "add a Budget field to deals". Each item is written by this plugin's
 * `crm-pipeline` or `crm-field` writer, so every rule is the writer's and the
 * console's: the `crm` plan feature, an owner, admin or editor with
 * `data.manage`, the scope, `stagesProblem`, the field types and the org's
 * 100-field ceiling. Both are saved live, as the console saves them (`live`):
 * neither has a draft state. Matched by name, so asking again changes
 * nothing twice.
 *
 * The arguments are flat, as the contract requires, and are the setup's own
 * fields; the planner fills them, so no model runs (`estimateCredits` 0). No
 * page block shows either, so neither changes what a visitor sees.
 *
 * A Salesforce "opportunity" is a deal here and an "account" a company; the
 * descriptions say so, since a request may use either word.
 */

/** The operations' names in a build plan. */
export const CRM_PIPELINE_AI_OP = 'crm-pipeline'
export const CRM_FIELD_AI_OP = 'crm-field'

/** How many of each one build may set up. */
export const CRM_PIPELINE_AI_MAX_PER_PLAN = 3
export const CRM_FIELD_AI_MAX_PER_PLAN = 12

/** The CRM is included from Starter (`crm`); Free has none of it. */
const CRM_FEATURE = 'crm'

function pick(args: PluginAiCapabilityArgs, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => args[key] !== undefined && args[key] !== '').map((key) => [key, args[key]]))
}

/** The pipeline writer's content for an item: its arguments, as they are. Pure. */
export function crmPipelineSetupContentFromArgs(args: PluginAiCapabilityArgs): Readonly<Record<string, unknown>> {
  return pick(args, ['name', 'renameFrom', 'stages', 'wonStage', 'lostStage', 'makeDefault'])
}

/** The field writer's content for an item: its arguments, as they are. Pure. */
export function crmFieldSetupContentFromArgs(args: PluginAiCapabilityArgs): Readonly<Record<string, unknown>> {
  return pick(args, ['object', 'label', 'type', 'options', 'required'])
}

export const crmPipelineAiCapability: PluginAiCapability = {
  op: CRM_PIPELINE_AI_OP,
  noun: 'sales pipeline',
  where: 'CRM → Deals → Pipelines',
  intents: [
    'CRM deal pipelines and their stages — "set up a sales pipeline: Discovery, Proposal, Negotiation, Won/Lost", rename a pipeline, add or reorder stages, set a stage’s win probability, make a pipeline the default; a Salesforce opportunity pipeline is a deal pipeline',
  ],
  argsSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          'The pipeline’s name, e.g. "Agency sales". An existing pipeline of this name (any case) is updated rather than duplicated; give "renameFrom" to rename one.',
        maxLength: PIPELINE_NAME_MAX,
      },
      renameFrom: {
        type: 'string',
        description: 'Only to rename: the current name of the pipeline that becomes "name".',
        maxLength: PIPELINE_NAME_MAX,
      },
      stages: {
        type: 'array',
        description:
          'The OPEN stages a deal moves through, in order, each a name with an optional win probability in parentheses, e.g. "Discovery (20%)". Never Won or Lost: every pipeline already has one of each (name them in wonStage and lostStage). Leave out to keep the stages as they are (a new pipeline then gets the standard set). Stages already in the pipeline and not listed are kept.',
        items: { type: 'string', maxLength: CRM_SETUP_STAGE_NAME_MAX + 8 },
        maxItems: CRM_SETUP_OPEN_STAGES_MAX,
      },
      wonStage: {
        type: 'string',
        description: 'What the closing Won stage is called, where the request names it, e.g. "Won". Leave out to keep "Closed Won".',
        maxLength: CRM_SETUP_STAGE_NAME_MAX,
      },
      lostStage: {
        type: 'string',
        description: 'What the closing Lost stage is called, where the request names it, e.g. "Lost". Leave out to keep "Closed Lost".',
        maxLength: CRM_SETUP_STAGE_NAME_MAX,
      },
      makeDefault: {
        type: 'boolean',
        description: 'true only when the request says new deals should land in this pipeline (its main or default pipeline).',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  maxPerPlan: CRM_PIPELINE_AI_MAX_PER_PLAN,
  freeAllowed: false,
  feature: CRM_FEATURE,
  draftResource: CRM_PIPELINE_SETUP_RESOURCE,
  live: true,
  // Written without a model: the planner already filled the arguments.
  estimateCredits: () => 0,
  degrade: 'omit',
  draftContent: (item) => crmPipelineSetupContentFromArgs(item.args),
}

export const crmFieldAiCapability: PluginAiCapability = {
  op: CRM_FIELD_AI_OP,
  noun: 'CRM custom field',
  where: 'CRM → Fields',
  intents: [
    'CRM custom fields on contacts, companies (accounts), deals (opportunities) or leads — "add a Budget field to opportunities", "a Choice field for Industry on companies"; types text, number, date, choice, checkbox and link only',
  ],
  argsSchema: {
    type: 'object',
    properties: {
      object: {
        type: 'string',
        description: 'The record it describes: contact; company (an account); deal (an opportunity); lead.',
        enum: CRM_FIELD_OBJECTS,
      },
      label: {
        type: 'string',
        description:
          'The field’s name as people read it, e.g. "Budget". A field of this name on the same record (any case) is left as it is rather than duplicated.',
        maxLength: CRM_FIELD_LABEL_MAX_LENGTH,
      },
      type: {
        type: 'string',
        description:
          'What it holds: text; number (also an amount of money or a percentage — there is no currency type); date; select (a Choice from listed options); checkbox (yes or no); url (a link).',
        enum: CONTACT_FIELD_TYPES,
      },
      options: {
        type: 'array',
        description: 'For select only: the choices, in order. A select field that exists gains the ones it lacks.',
        items: { type: 'string', maxLength: CRM_FIELD_OPTION_MAX_LENGTH },
        maxItems: CRM_FIELD_OPTIONS_MAX,
      },
      required: {
        type: 'boolean',
        description: 'true only when the request says the field must always be filled in.',
      },
    },
    required: ['object', 'label', 'type'],
    additionalProperties: false,
  },
  maxPerPlan: CRM_FIELD_AI_MAX_PER_PLAN,
  freeAllowed: false,
  feature: CRM_FEATURE,
  draftResource: CRM_FIELD_SETUP_RESOURCE,
  live: true,
  estimateCredits: () => 0,
  degrade: 'omit',
  draftContent: (item) => crmFieldSetupContentFromArgs(item.args),
}

/**
 * Registers both capabilities; the console-server declarations call it beside
 * the writers, since only the console runs AI jobs (AGL-3026). Idempotent.
 */
export function registerCrmSetupAiCapabilities(): void {
  registerPluginAiCapability(crmPipelineAiCapability, { pluginId: BUNDLE_ID })
  registerPluginAiCapability(crmFieldAiCapability, { pluginId: BUNDLE_ID })
}
