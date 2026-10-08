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

import {
  registerPluginAiCapability,
  type PluginAiCapability,
  type PluginAiCapabilityArgs,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  LOGIC_DRAFT_NAME_MAX,
  VARIABLE_DRAFT_RESOURCE,
  VARIABLE_DRAFT_TYPES,
  VARIABLE_DRAFT_VALUE_MAX,
} from './logic-draft-content'

/**
 * WHAT AN AI BUILD CAN MAKE IN LOGIC (AGL-3616): a site variable.
 *
 * The capability the AI plugin's build planner offers for "keep my hourly
 * rate in one place". Its item is written by this plugin's `variable` draft
 * writer, so every rule is the writer's: the member's role, the plan's
 * `variablesPerHost` allowance, the binding grammar for the name, a name no
 * live variable carries, and a value in its type's stored form. No model
 * runs: the planner fills the three arguments, and they ARE the variable.
 *
 * A variable needs no plan feature — the Free plan has three — so a Free
 * workspace's build may make one. No page block depends on it: a page shows
 * a variable through a binding a person places, and a build places none, so a
 * new variable changes nothing a visitor sees until someone binds it.
 *
 * A function is not offered here: writing one takes a model, so it is the AI
 * plugin's own operation, run by its `logic` step and written through this
 * plugin's `function` writer.
 */

/** The operation's name in a build plan. */
export const VARIABLE_AI_OP = 'variable'

/** The writer's content for an item: its three arguments, as they are. */
export function variableDraftContentFromArgs(args: PluginAiCapabilityArgs): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    ['name', 'type', 'value'].filter((key) => args[key] !== undefined).map((key) => [key, args[key]]),
  )
}

export const variableAiCapability: PluginAiCapability = {
  op: VARIABLE_AI_OP,
  noun: 'site variable',
  where: 'Logic → Variables',
  intents: [
    'site variables: one value — a price, a phone number, an opening date — kept in one place for pages to show',
  ],
  argsSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          'The name a binding reads: a letter or _, then letters, digits or _, e.g. "hourly_rate". Not a name the site already has.',
        maxLength: LOGIC_DRAFT_NAME_MAX,
      },
      type: {
        type: 'string',
        description: 'What the value is.',
        enum: VARIABLE_DRAFT_TYPES,
      },
      value: {
        type: 'string',
        description:
          'The value as stored: digits for number; true or false; YYYY-MM-DD for date; HH:MM for time; a JSON object for dictionary; a JSON list for collection.',
        maxLength: VARIABLE_DRAFT_VALUE_MAX,
      },
    },
    required: ['name', 'type', 'value'],
    additionalProperties: false,
  },
  maxPerPlan: 6,
  // Free includes three variables (`variablesPerHost: 3`), and Logic no feature.
  freeAllowed: true,
  quota: 'variablesPerHost',
  draftResource: VARIABLE_DRAFT_RESOURCE,
  // Written without a model: the planner already filled the arguments.
  estimateCredits: () => 0,
  degrade: 'omit',
  draftContent: (item) => variableDraftContentFromArgs(item.args),
}

/**
 * Registers the capability; the console's server declarations call it beside
 * the writers, since only the console runs AI jobs (AGL-3026). Idempotent.
 */
export function registerVariableAiCapability(): void {
  registerPluginAiCapability(variableAiCapability, { pluginId: BUNDLE_ID })
}
