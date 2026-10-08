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

import { SITE_JOURNEY_STEP_TYPES } from '@aglyn/aglyn/app-utils/site-journey-steps'
import { normalizeFunnelStep } from './funnel-definition'
import { labelStepFromInventory, stepInventoryProblem, type FunnelInventory } from './funnel-inventory'
import {
  FUNNEL_MAX_STEPS,
  FUNNEL_MIN_STEPS,
  FUNNEL_NAME_MAX,
  type FunnelDefinition,
  type FunnelStep,
} from './funnels.types'

/**
 * "Create with AI" for a funnel (AGL-3605): a description becomes a draft
 * whose every step is one the site really has.
 *
 * The model is asked for JSON naming steps by the inventory's own ids and
 * paths, and nothing it answers is trusted: every step is cleaned the way a
 * save cleans it and checked against the inventory read on the server, a
 * step that fails either is dropped and reported, and a draft left with fewer
 * than two steps is no draft. Nothing is saved — the editor opens on the
 * draft and a person saves it.
 */

/** The longest description a proposal accepts. */
export const FUNNEL_BRIEF_MAX_CHARS = 1_000

/** The inventory lines a prompt lists per kind, so the prompt stays bounded. */
const PROMPT_ITEMS_PER_KIND = 60

/** Byte-identical on every call, so a provider can cache it. */
export const FUNNEL_PROPOSAL_SYSTEM = [
  'You design conversion funnels for a website. A funnel is an ordered list of',
  `${FUNNEL_MIN_STEPS} to ${FUNNEL_MAX_STEPS} steps a visitor takes in one visit.`,
  `Step types: ${SITE_JOURNEY_STEP_TYPES.join(', ')}.`,
  '- page: key is a path from PAGES; match is "exact", or "prefix" for a path and everything under it.',
  '- form: key is an id from FORMS, or "" for any form.',
  '- booking: key is an id from SERVICES, or "" for any booking.',
  '- cart: key is an id from PRODUCTS (added to cart), or "" for any product.',
  '- order: key is "" (an order was placed and paid).',
  '- overlay: key is an id from OVERLAYS (a bar or popup was clicked), or "" for any.',
  '- event: key is a custom event name in snake_case, only if the description names one.',
  '- email: key is "opened" or "clicked" (an email from the site), only if the description is about a follow-up email.',
  'Use ONLY paths and ids that appear in the lists. Never invent one.',
  'Answer with JSON only, no prose: {"name": string, "steps": [{"type": string, "key": string, "match"?: string, "label": string}]}',
  'Each label is a few plain words a site owner would recognize.',
].join('\n')

function listLines(title: string, items: readonly string[]): string {
  if (!items.length) return `${title}: (none)`
  return `${title}:\n${items.slice(0, PROMPT_ITEMS_PER_KIND).join('\n')}`
}

/** The one turn: the description and the site's inventory. */
export function funnelProposalPrompt(brief: string, inventory: FunnelInventory): string {
  const items = (rows: FunnelInventory['forms']) =>
    rows.map((row) => `${row.id} — ${row.name.replace(/\s+/g, ' ').slice(0, 80)}`)
  return [
    `DESCRIPTION: ${brief.replace(/\s+/g, ' ').trim().slice(0, FUNNEL_BRIEF_MAX_CHARS)}`,
    listLines('PAGES', inventory.pages),
    listLines('FORMS', items(inventory.forms)),
    listLines('SERVICES', items(inventory.services)),
    listLines('PRODUCTS', items(inventory.products)),
    listLines('OVERLAYS', items(inventory.overlays)),
  ].join('\n\n')
}

/** The first JSON object in a model's answer, or null. */
export function extractJsonObject(text: string): unknown {
  const source = String(text ?? '')
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(source.slice(start, end + 1))
  } catch {
    return null
  }
}

export interface FunnelProposal {
  draft: FunnelDefinition
  /** Steps the model proposed that were dropped, and why. */
  dropped: string[]
}

/** A model's answer as a checked draft, or why there is none. */
export function checkFunnelProposal(
  answer: string,
  inventory: FunnelInventory,
): { proposal: FunnelProposal } | { error: string } {
  const parsed = extractJsonObject(answer) as Record<string, unknown> | null
  if (!parsed || !Array.isArray(parsed['steps'])) {
    return { error: 'The suggestion could not be read. Try describing the funnel again.' }
  }
  const steps: FunnelStep[] = []
  const dropped: string[] = []
  for (const raw of parsed['steps'].slice(0, FUNNEL_MAX_STEPS * 2)) {
    const normalized = normalizeFunnelStep(raw)
    if ('error' in normalized) {
      dropped.push(normalized.error)
      continue
    }
    const problem = stepInventoryProblem(normalized.step, inventory)
    if (problem) {
      dropped.push(problem)
      continue
    }
    if (steps.length < FUNNEL_MAX_STEPS) steps.push(labelStepFromInventory(normalized.step, inventory))
  }
  if (steps.length < FUNNEL_MIN_STEPS) {
    return {
      error:
        'The suggestion did not name enough steps this site has. Try naming the pages, forms or products the funnel runs through.',
    }
  }
  const name =
    String(parsed['name'] ?? '').trim().slice(0, FUNNEL_NAME_MAX) || 'New funnel'
  return { proposal: { draft: { name, steps }, dropped } }
}
