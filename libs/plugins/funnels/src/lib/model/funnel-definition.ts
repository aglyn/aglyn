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
  isSiteJourneyStepType,
  SITE_JOURNEY_KEY_MAX,
  type SiteJourneyStepType,
} from '@aglyn/aglyn/app-utils/site-journey'
import {
  FUNNEL_LABEL_MAX,
  FUNNEL_MAX_STEPS,
  FUNNEL_MIN_STEPS,
  FUNNEL_NAME_MAX,
  type FunnelDefinition,
  type FunnelStep,
  type JourneyStepRecord,
} from './funnels.types'

/** What each step type is called, in the editor and the results. */
export const FUNNEL_STEP_TYPE_LABELS: Record<SiteJourneyStepType, string> = {
  page: 'Viewed a page',
  form: 'Submitted a form',
  booking: 'Made a booking',
  cart: 'Added a product to the cart',
  order: 'Placed an order',
  overlay: 'Clicked a bar or popup',
  event: 'Custom event',
}

/** Types whose step may name nothing, meaning any of that kind. */
const ANY_ALLOWED: ReadonlySet<SiteJourneyStepType> = new Set([
  'form',
  'booking',
  'cart',
  'order',
  'overlay',
])

/** An event name as the interaction builder sends it (GA's rules). */
const EVENT_NAME = /^[a-z][a-z0-9_]{0,39}$/

/** A path with no query, no fragment and no trailing slash (except `/`). */
export function normalizeFunnelPath(raw: string): string {
  let path = String(raw ?? '').trim()
  const cut = path.search(/[?#]/)
  if (cut >= 0) path = path.slice(0, cut)
  if (!path.startsWith('/')) path = `/${path}`
  path = path.replace(/\/{2,}/g, '/')
  if (path.length > 1) path = path.replace(/\/+$/, '')
  return path.slice(0, SITE_JOURNEY_KEY_MAX)
}

/**
 * One step, cleaned, or the reason it cannot be a step. Accepts what a
 * client or a model sends, so every field is coerced and bounded.
 */
export function normalizeFunnelStep(
  raw: unknown,
): { step: FunnelStep } | { error: string } {
  const input = (raw ?? {}) as Record<string, unknown>
  const type = input['type']
  if (!isSiteJourneyStepType(type)) return { error: 'Pick what the step is.' }
  let key = String(input['key'] ?? '').trim().slice(0, SITE_JOURNEY_KEY_MAX)
  const label = String(input['label'] ?? '').trim().slice(0, FUNNEL_LABEL_MAX)
  if (type === 'page') {
    if (!key) return { error: 'A page step needs a path.' }
    key = normalizeFunnelPath(key)
    const match = input['match'] === 'prefix' ? 'prefix' : 'exact'
    return { step: { type, key, match, ...(label ? { label } : {}) } }
  }
  if (type === 'order') {
    return { step: { type, key: '', ...(label ? { label } : {}) } }
  }
  if (type === 'event') {
    if (!EVENT_NAME.test(key)) {
      return { error: 'A custom event step needs the event’s name, as the interaction sends it.' }
    }
  } else if (!key && !ANY_ALLOWED.has(type)) {
    return { error: 'Pick what the step names.' }
  }
  return { step: { type, key, ...(label ? { label } : {}) } }
}

/** A whole definition, cleaned, or the first reason it cannot be saved. */
export function normalizeFunnelDefinition(
  raw: unknown,
): { funnel: FunnelDefinition } | { error: string } {
  const input = (raw ?? {}) as Record<string, unknown>
  const name = String(input['name'] ?? '').trim().slice(0, FUNNEL_NAME_MAX)
  if (!name) return { error: 'Name the funnel.' }
  const rawSteps = Array.isArray(input['steps']) ? input['steps'] : []
  if (rawSteps.length < FUNNEL_MIN_STEPS || rawSteps.length > FUNNEL_MAX_STEPS) {
    return {
      error: `A funnel has ${FUNNEL_MIN_STEPS} to ${FUNNEL_MAX_STEPS} steps.`,
    }
  }
  const steps: FunnelStep[] = []
  for (const [index, rawStep] of rawSteps.entries()) {
    const normalized = normalizeFunnelStep(rawStep)
    if ('error' in normalized) return { error: `Step ${index + 1}: ${normalized.error}` }
    steps.push(normalized.step)
  }
  return { funnel: { name, steps } }
}

/** Whether one recorded step satisfies one funnel step. */
export function funnelStepMatches(step: FunnelStep, event: JourneyStepRecord): boolean {
  if (event.t !== step.type) return false
  if (step.type === 'page') {
    const path = normalizeFunnelPath(event.k)
    if (step.match === 'prefix') {
      if (step.key === '/') return true
      return path === step.key || path.startsWith(`${step.key}/`)
    }
    return path === step.key
  }
  if (step.type === 'order') return true
  return !step.key || step.key === event.k
}

/** The words a result shows for a step: its label, else a description. */
export function funnelStepTitle(step: FunnelStep): string {
  if (step.label) return step.label
  const what = FUNNEL_STEP_TYPE_LABELS[step.type]
  if (step.type === 'page') {
    return step.match === 'prefix' ? `${what}: ${step.key} and below` : `${what}: ${step.key}`
  }
  if (step.type === 'order') return what
  return step.key ? `${what}: ${step.key}` : `${what} (any)`
}
