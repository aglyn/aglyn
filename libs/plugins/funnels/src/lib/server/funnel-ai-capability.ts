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
  type PluginAiCapabilityDraftContext,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  FUNNEL_FEATURE,
  FUNNEL_LABEL_MAX,
  FUNNEL_MAX_STEPS,
  FUNNEL_NAME_MAX,
} from '../model/funnels.types'
import { FUNNEL_DRAFT_RESOURCE } from './funnel-drafts'

/**
 * WHAT AN AI BUILD CAN MAKE IN FUNNELS (AGL-3616): a funnel, as a draft.
 *
 * The capability the AI plugin's build planner offers for "and show me where
 * visitors drop off". Its item is written by this plugin's `funnel` draft
 * writer, so every rule is the save door's: the paid analytics tier, a site
 * admin or editor, the per-site cap, and every step checked against what the
 * site has when the item is written. The funnel is born a draft: it does not
 * switch visitor recording on and is not measured until a person activates
 * it on the Funnels card.
 *
 * ## Steps, as flat arguments
 *
 * The contract allows scalars and string lists, so a step is one string,
 * `type:what` — `page:/pricing`, `form:new:Contact form`, `order`. Which
 * steps a build may name follows what the writer can CHECK when it writes:
 *
 *  - A PAGE step names a path the site already PUBLISHES. A page the same
 *    build makes is not a step: a funnel's page step is a path, the build
 *    hands a dependent only the page's draft id, and the build's pages are
 *    published (where they are at all) after every item is written — so the
 *    writer would refuse it as a page the site does not serve. The schema
 *    says so, and the capability does not depend on `page`.
 *  - A FORM, BOOKING, CART or OVERLAY step names a record the site has, by
 *    the id the site inventory lists, or one this build makes, as
 *    `new:<name>` of a `form`, `booking-service`, `product` or `overlay`
 *    item; or nothing (`form` alone), meaning any of that kind. A record the
 *    build made is a document by the time this item runs (its draft is
 *    written under the id the build hands on), so the writer's inventory
 *    check finds it honestly. A `new:<name>` the build did not make, or that
 *    is the wrong kind, is handed on as a step the writer refuses by name.
 *  - An ORDER step names nothing; an EMAIL step is `email:opened` or
 *    `email:clicked`.
 *  - A custom EVENT step is not offered: nothing a build can read names the
 *    events a site's interactions send, and a guessed name would be a step
 *    nobody ever reaches. A person adds one in the editor.
 */

/** The operation's name in a build plan. */
export const FUNNEL_AI_OP = 'funnel'

/**
 * The build operations whose items a step may cite as `new:<name>`, by the
 * step type that names them. Operation names are the build's stable
 * vocabulary (the AI plugin's `form`, bookings' `booking-service`, commerce's
 * `product`, marketing's `overlay`); no plugin is imported for them.
 */
export const FUNNEL_AI_STEP_REF_OPS = {
  form: 'form',
  booking: 'booking-service',
  cart: 'product',
  overlay: 'overlay',
} as const

type RefStepType = keyof typeof FUNNEL_AI_STEP_REF_OPS

const REF_STEP_NOUNS: Record<RefStepType, string> = {
  form: 'form',
  booking: 'booking service',
  cart: 'product',
  overlay: 'bar or popup',
}

const NEW_REF = 'new:'

/** A dependency by its `new:<name>`, matched without regard to case. */
function dependencyFor(
  ref: string,
  dependencies: PluginAiCapabilityDraftContext['dependencies'],
): { op: string; id: string } | null {
  const wanted = ref.trim().toLowerCase()
  for (const [key, value] of Object.entries(dependencies)) {
    if (key.trim().toLowerCase() === wanted) return value
  }
  return null
}

/**
 * One step string as the writer's step: `{ type, key, match?, label? }`, or
 * `{ unresolved }` with the sentence the writer refuses it with. Pure.
 */
export function funnelStepFromArg(
  raw: string,
  label: string | undefined,
  dependencies: PluginAiCapabilityDraftContext['dependencies'],
): Record<string, unknown> {
  const text = String(raw ?? '').trim()
  const colon = text.indexOf(':')
  const type = (colon < 0 ? text : text.slice(0, colon)).trim().toLowerCase()
  const what = colon < 0 ? '' : text.slice(colon + 1).trim()
  const labelled = label?.trim() ? { label: label.trim().slice(0, FUNNEL_LABEL_MAX) } : {}

  if (type === 'page') {
    const prefix = what.endsWith('/*')
    const key = prefix ? what.slice(0, -2) || '/' : what
    return { type, key, match: prefix ? 'prefix' : 'exact', ...labelled }
  }
  if (type === 'order') return { type, key: '', ...labelled }
  if (type === 'email') return { type, key: what.toLowerCase(), ...labelled }
  if (type === 'event') {
    return {
      unresolved:
        'a build does not add custom event steps; add one in the Funnels editor, where the event is named as the site sends it.',
    }
  }
  if (type in FUNNEL_AI_STEP_REF_OPS) {
    const refType = type as RefStepType
    if (!what.toLowerCase().startsWith(NEW_REF)) return { type, key: what, ...labelled }
    const dependency = dependencyFor(what, dependencies)
    const noun = REF_STEP_NOUNS[refType]
    if (!dependency) return { unresolved: `${what} was not made by this build, so there is no ${noun} to name.` }
    if (dependency.op !== FUNNEL_AI_STEP_REF_OPS[refType]) {
      return { unresolved: `${what} is not a ${noun}.` }
    }
    return { type, key: dependency.id, ...labelled }
  }
  // An unknown kind is handed on for the writer to refuse in its own words.
  return { type, key: what, ...labelled }
}

/** The writer's content for an item. Pure. */
export function funnelDraftContentFromArgs(
  args: PluginAiCapabilityArgs,
  dependencies: PluginAiCapabilityDraftContext['dependencies'] = {},
): Readonly<Record<string, unknown>> {
  const steps = Array.isArray(args['steps']) ? (args['steps'] as readonly string[]) : []
  const labels = Array.isArray(args['stepLabels']) ? (args['stepLabels'] as readonly string[]) : []
  return {
    name: typeof args['name'] === 'string' ? args['name'] : '',
    steps: steps.map((step, index) => funnelStepFromArg(step, labels[index], dependencies)),
  }
}

export const funnelAiCapability: PluginAiCapability = {
  op: FUNNEL_AI_OP,
  noun: 'funnel',
  where: 'Analytics → Funnels',
  intents: [
    'a funnel that shows how many visits go from one step to the next — a page, then a form, a booking, a product added to the cart or an order — and where they drop off; set up as a draft to activate',
  ],
  argsSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'What the funnel is called on the Funnels card, e.g. "Pricing to contact".',
        maxLength: FUNNEL_NAME_MAX,
      },
      steps: {
        type: 'array',
        description:
          `The steps a visitor takes, in order, 2 to ${FUNNEL_MAX_STEPS}, each written type:what. ` +
          'page:/path — a page the site ALREADY publishes, by its address, e.g. page:/pricing ' +
          '(page:/blog/* for the path and every page under it); a page this plan builds cannot be a step. ' +
          'form:<id> — a form by its id from the site inventory, form:new:<name> — a form this plan builds, ' +
          'or form alone — any form. booking, cart and overlay work the same way for a booking service, ' +
          'a product added to the cart and a bar or popup clicked: new:<name> of a booking-service, product ' +
          'or overlay item this plan builds, or the word alone for any. order — an order placed. ' +
          'email:opened or email:clicked — an email from the site opened, or a link in it clicked. ' +
          'Put every new:<name> a step names in this item’s dependsOn.',
        items: { type: 'string', maxLength: 240 },
        maxItems: FUNNEL_MAX_STEPS,
      },
      stepLabels: {
        type: 'array',
        description: 'What the results call each step, in the order of steps, e.g. "Pricing"; optional.',
        items: { type: 'string', maxLength: FUNNEL_LABEL_MAX },
        maxItems: FUNNEL_MAX_STEPS,
      },
    },
    required: ['name', 'steps'],
    additionalProperties: false,
  },
  maxPerPlan: 2,
  // Funnels come with the paid analytics tier, which Free does not include.
  freeAllowed: false,
  feature: FUNNEL_FEATURE,
  draftResource: FUNNEL_DRAFT_RESOURCE,
  // Written without a model: the planner already filled the arguments.
  estimateCredits: () => 0,
  dependsOnOps: Object.values(FUNNEL_AI_STEP_REF_OPS),
  // Nothing is built on a funnel.
  degrade: 'omit',
  draftContent: (item, context) => funnelDraftContentFromArgs(item.args, context.dependencies),
}

/** Registers the capability; the console surface calls it beside the writer. Idempotent. */
export function registerFunnelAiCapability(): void {
  registerPluginAiCapability(funnelAiCapability, { pluginId: BUNDLE_ID })
}
