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
import { EXPERIMENT_MAX_VARIANTS } from '../model/experiments'
import { OVERLAY_COPY_LIMITS, OVERLAY_POPUP_TRIGGERS } from '../model/overlay-drafts'
import { EXPERIMENT_DRAFT_RESOURCE, OVERLAY_DRAFT_RESOURCE } from './marketing-drafts'

/**
 * What an AI build may make with this plugin (AGL-3616): an announcement bar
 * or a popup, and an A/B test. Each is made through this plugin's own draft
 * writer (`server/marketing-drafts.ts`), so an overlay arrives switched off
 * and a test arrives stopped, and the build never learns what either document
 * looks like.
 */

const MARKETING_PLUGIN_ID = 'marketing'

const DELAY = OVERLAY_POPUP_TRIGGERS.find((trigger) => trigger.id === 'delay')
const SCROLL = OVERLAY_POPUP_TRIGGERS.find((trigger) => trigger.id === 'scroll')

export const MARKETING_OVERLAY_CAPABILITY: PluginAiCapability = {
  op: 'overlay',
  noun: 'announcement bar or popup',
  where: 'Marketing → Overlays',
  intents: ['an announcement bar across the site', 'a popup with an offer or a call to action'],
  argsSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['bar', 'popup'], description: 'A one-line bar across the top of every page, or a popup.' },
      name: { type: 'string', maxLength: OVERLAY_COPY_LIMITS.name, description: 'A short internal name for the overlays list.' },
      text: { type: 'string', maxLength: OVERLAY_COPY_LIMITS.text, description: 'A bar’s one line of copy. Required for a bar.' },
      headline: { type: 'string', maxLength: OVERLAY_COPY_LIMITS.headline, description: 'A popup’s headline.' },
      body: { type: 'string', maxLength: OVERLAY_COPY_LIMITS.body, description: 'A popup’s supporting copy. Required for a popup.' },
      ctaLabel: { type: 'string', maxLength: OVERLAY_COPY_LIMITS.ctaLabel, description: 'A popup’s button label, a few words that start with a verb.' },
      trigger: {
        type: 'string',
        enum: OVERLAY_POPUP_TRIGGERS.map((trigger) => trigger.id),
        description: 'When a popup opens: after a delay, on scroll, or on exit intent.',
      },
      triggerValue: {
        type: 'integer',
        minimum: 0,
        maximum: Math.max(DELAY?.max ?? 0, SCROLL?.max ?? 0),
        description: `Seconds for delay (${DELAY?.min}–${DELAY?.max}), percent of the page for scroll (${SCROLL?.min}–${SCROLL?.max}); omitted for exit.`,
      },
    },
    required: ['kind'],
    additionalProperties: false,
  },
  maxPerPlan: 3,
  freeAllowed: false,
  feature: 'marketingOverlays',
  draftResource: OVERLAY_DRAFT_RESOURCE,
  estimateCredits: () => 0,
  degrade: 'omit',
}

/** A list argument as strings, one per variant. */
const list = (value: PluginAiCapabilityArgs[string] | undefined): readonly string[] =>
  Array.isArray(value) ? value : []

export const MARKETING_EXPERIMENT_CAPABILITY: PluginAiCapability = {
  op: 'experiment',
  noun: 'A/B test',
  where: 'Marketing → A/B testing',
  intents: ['an A/B test of a page', 'an A/B test of an email’s subject line'],
  argsSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', maxLength: 120, description: 'What the test is called in the A/B testing list.' },
      target: { type: 'string', enum: ['screen', 'section', 'email'], description: 'What the test varies: a page, one section of a page, or an email.' },
      screen: {
        type: 'string',
        maxLength: 120,
        description: 'For a page or section test: the page under test, by its id or as new:<name> for a page this plan builds.',
      },
      nodeId: { type: 'string', maxLength: 100, description: 'For a section test: the element id of the section under test.' },
      goal: { type: 'string', maxLength: 60, description: 'The conversion event the test counts; formSubmission when unsure.' },
      variantNames: {
        type: 'array',
        items: { type: 'string', maxLength: 80 },
        maxItems: EXPERIMENT_MAX_VARIANTS,
        description: `Two to ${EXPERIMENT_MAX_VARIANTS} variant names, the first the control.`,
      },
      variantSubjects: {
        type: 'array',
        items: { type: 'string', maxLength: 200 },
        maxItems: EXPERIMENT_MAX_VARIANTS,
        description: 'For an email test: each variant’s subject line, in the order of the names.',
      },
      variantBodies: {
        type: 'array',
        items: { type: 'string', maxLength: 1_200 },
        maxItems: EXPERIMENT_MAX_VARIANTS,
        description: 'For an email test: each variant’s body, in the order of the names.',
      },
    },
    required: ['name', 'target', 'variantNames'],
    additionalProperties: false,
  },
  maxPerPlan: 2,
  freeAllowed: false,
  feature: 'abTesting',
  draftResource: EXPERIMENT_DRAFT_RESOURCE,
  estimateCredits: () => 0,
  dependsOnOps: ['page'],
  degrade: 'omit',
  draftContent: (item, context) => {
    const { args } = item
    const screen = typeof args['screen'] === 'string' ? args['screen'] : ''
    // A page this plan built is cited as `new:<name>`; its draft's id is what the test names.
    const screenId = screen.startsWith('new:') ? (context.dependencies[screen]?.id ?? '') : screen
    const subjects = list(args['variantSubjects'])
    const bodies = list(args['variantBodies'])
    return {
      name: typeof args['name'] === 'string' ? args['name'] : '',
      target: args['target'],
      ...(screenId ? { screenId } : {}),
      ...(typeof args['nodeId'] === 'string' ? { nodeId: args['nodeId'] } : {}),
      ...(typeof args['goal'] === 'string' ? { goal: args['goal'] } : {}),
      variants: list(args['variantNames']).map((name, index) => ({
        name,
        ...(subjects[index] ? { subject: subjects[index] } : {}),
        ...(bodies[index] ? { body: bodies[index] } : {}),
      })),
    }
  },
}

/**
 * Registers both capabilities on the core's contract. Called from the console
 * API surface, after the writers they name; idempotent.
 */
export function registerMarketingAiCapabilities(): void {
  registerPluginAiCapability(MARKETING_OVERLAY_CAPABILITY, { pluginId: MARKETING_PLUGIN_ID })
  registerPluginAiCapability(MARKETING_EXPERIMENT_CAPABILITY, { pluginId: MARKETING_PLUGIN_ID })
}
