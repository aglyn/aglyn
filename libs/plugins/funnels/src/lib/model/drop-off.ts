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

import { journeyProgress } from './funnel-compute'
import { funnelStepTitle } from './funnel-definition'
import type { FunnelStep, JourneyStepRecord } from './funnels.types'

/**
 * "ACT ON THIS DROP-OFF" (AGL-3605): what happens to a person who reached a
 * funnel's step N and did not reach step N + 1 within a wait.
 *
 * A funnel keeps WATCHES — `{ step, afterHours }` — and each one is the
 * reason the plugin raises the `funnelLeft` host event, which an automation
 * the workflows plugin keeps starts on. The funnels plugin never imports the
 * workflows plugin: the draft is written through core's resource-drafts seam
 * (the `automation` writer the workflows plugin registers), and the trigger
 * is a host event declared in `plugins.config.json`, which every trigger
 * picker and the automation engine read without loading this plugin.
 *
 * ONLY A PERSON. A watch is checked only on a visit a person identified by
 * submitting a form (the form door ties the visit to the address it took),
 * never on an anonymous visit, and the person is judged on every visit of
 * theirs the site recorded — someone who came back in another tab and booked
 * did not leave.
 *
 * Everything here is pure; the sweep and the door hold the I/O.
 */

/** One watch on a funnel: step N (1-based) left for `afterHours`. */
export interface FunnelDropOffWatch {
  step: number
  afterHours: number
}

/** The waits the card offers, in hours. */
export const DROP_OFF_WAIT_HOURS: readonly number[] = [1, 24, 72, 168]

/** The longest wait a watch may hold: a visit is kept 90 days, a follow-up is not that late. */
export const DROP_OFF_MAX_HOURS = 30 * 24

/** The most watches one funnel keeps. */
export const DROP_OFF_WATCHES_MAX = 12

/**
 * How long a person's visit counts as still going: a person short of the
 * watched step is looked at again until their last step is this old.
 */
export const DROP_OFF_LIVE_MS = 2 * 60 * 60 * 1000

/** How soon a person still on the site is looked at again. */
export const DROP_OFF_RECHECK_MS = 30 * 60 * 1000

/** What the follow-up does. */
export type DropOffAction = 'email' | 'task'

export const DROP_OFF_ACTIONS: readonly DropOffAction[] = ['email', 'task']

/** The host event a watch raises, as `plugins.config.json` declares it. */
export const FUNNEL_LEFT_EVENT = 'funnelLeft'

/** A watch as a client or a stored funnel sends it, or why it is not one. */
export function normalizeDropOffWatch(
  raw: unknown,
  stepCount: number,
): { watch: FunnelDropOffWatch } | { error: string } {
  const input = (raw ?? {}) as Record<string, unknown>
  const step = Number(input['step'])
  const afterHours = Number(input['afterHours'])
  if (!Number.isInteger(step) || step < 1 || step >= stepCount) {
    return { error: 'Pick a step that has a step after it.' }
  }
  if (!Number.isInteger(afterHours) || afterHours < 1 || afterHours > DROP_OFF_MAX_HOURS) {
    return { error: `Wait between 1 hour and ${DROP_OFF_MAX_HOURS / 24} days.` }
  }
  return { watch: { step, afterHours } }
}

/** A funnel's stored watches, cleaned; a malformed one is dropped. */
export function funnelWatches(raw: unknown, stepCount: number): FunnelDropOffWatch[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const watches: FunnelDropOffWatch[] = []
  for (const one of raw) {
    const normalized = normalizeDropOffWatch(one, stepCount)
    if ('error' in normalized) continue
    const key = `${normalized.watch.step}_${normalized.watch.afterHours}`
    if (seen.has(key)) continue
    seen.add(key)
    watches.push(normalized.watch)
  }
  return watches.slice(0, DROP_OFF_WATCHES_MAX)
}

/** The mark a fired watch leaves on the person's visits, so it fires once. */
export function dropOffMarkKey(funnelId: string, watch: FunnelDropOffWatch): string {
  return `${funnelId}_${watch.step}_${watch.afterHours}`
}

/** How a wait reads: "1 hour", "3 days". */
export function waitLabel(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24
    return days === 1 ? '1 day' : `${days} days`
  }
  return hours === 1 ? '1 hour' : `${hours} hours`
}

/** A funnel as the sweep reads it. */
export interface WatchedFunnel {
  id: string
  name: string
  steps: readonly FunnelStep[]
  watches: readonly FunnelDropOffWatch[]
}

/** One watch that has come due for a person. */
export interface DueDropOff {
  funnel: WatchedFunnel
  watch: FunnelDropOffWatch
  key: string
  /** When the person reached the watched step, epoch ms. */
  reachedAt: number
}

export interface DropOffVerdict {
  due: DueDropOff[]
  /** When to look at this person again, or null when nothing is left to wait for. */
  nextCheckAt: number | null
}

/**
 * Which watches a person has come due on, from every step the site recorded
 * of theirs, and when to look again.
 *
 * A watch on step N is DUE when the person's furthest progress through the
 * funnel is exactly N, step N was reached at least `afterHours` ago, and it
 * has not fired for them before. Not yet due: look again when it will be. Short of
 * step N while their last step is recent: look again soon, they may get
 * there. Past step N, or short of it and gone: nothing to wait for.
 */
export function dropOffVerdict(options: {
  funnels: readonly WatchedFunnel[]
  steps: readonly JourneyStepRecord[]
  fired: ReadonlySet<string>
  lastAt: number
  now: number
}): DropOffVerdict {
  const { funnels, steps, fired, lastAt, now } = options
  const due: DueDropOff[] = []
  let next: number | null = null
  const later = (at: number) => {
    next = next === null ? at : Math.min(next, at)
  }
  for (const funnel of funnels) {
    if (!funnel.watches.length) continue
    const { reached, times } = journeyProgress(funnel.steps, { steps })
    for (const watch of funnel.watches) {
      const key = dropOffMarkKey(funnel.id, watch)
      if (fired.has(key)) continue
      if (reached === watch.step) {
        const reachedAt = times[watch.step - 1]
        const dueAt = reachedAt + watch.afterHours * 60 * 60 * 1000
        if (now >= dueAt) due.push({ funnel, watch, key, reachedAt })
        else later(dueAt)
      } else if (reached < watch.step && now - lastAt < DROP_OFF_LIVE_MS) {
        later(now + DROP_OFF_RECHECK_MS)
      }
    }
  }
  return { due, nextCheckAt: next }
}

/** The flat scope the `funnelLeft` event hands an automation. */
export function funnelLeftPayload(drop: DueDropOff, email: string): Record<string, string | number> {
  const { funnel, watch } = drop
  const at = funnel.steps[watch.step - 1]
  const next = funnel.steps[watch.step]
  return {
    funnelId: funnel.id,
    funnelName: funnel.name,
    step: watch.step,
    stepLabel: at ? funnelStepTitle(at) : '',
    nextStepLabel: next ? funnelStepTitle(next) : '',
    afterHours: watch.afterHours,
    email,
  }
}

/** The longest automation name the Actions editor stores. */
const AUTOMATION_NAME_MAX = 60

/**
 * The automation "Act on this drop-off" drafts, as the `automation` draft
 * writer reads `content`: a trigger on this funnel's step and wait, and one
 * step — an email to the person, or a CRM task for the team. It is written
 * switched off, and every word of it is a person's to change before it runs.
 *
 * The email is a MAILING, never a transactional reply: leaving a funnel is
 * not the person's own request, so the message carries its unsubscribe link,
 * goes to the site's default topic, and is not sent to anyone who left it or
 * whose address is suppressed — the send step's own rules.
 */
export function dropOffAutomationContent(options: {
  funnelId: string
  funnelName: string
  steps: readonly FunnelStep[]
  watch: FunnelDropOffWatch
  action: DropOffAction
}): { name: string; content: Record<string, unknown> } {
  const { funnelId, funnelName, steps, watch, action } = options
  const at = steps[watch.step - 1]
  const next = steps[watch.step]
  const atLabel = at ? funnelStepTitle(at) : `step ${watch.step}`
  const nextLabel = next ? funnelStepTitle(next) : `step ${watch.step + 1}`
  const name = `${action === 'email' ? 'Follow up' : 'Task'}: ${funnelName} step ${watch.step}`
    .replace(/\s+/g, ' ')
    .slice(0, AUTOMATION_NAME_MAX)
  const trigger = {
    event: FUNNEL_LEFT_EVENT,
    conditions: [
      { field: 'funnelId', op: 'equals', value: funnelId },
      { field: 'step', op: 'equals', value: String(watch.step) },
      { field: 'afterHours', op: 'equals', value: String(watch.afterHours) },
    ],
    combinator: 'and',
  }
  const step =
    action === 'email'
      ? {
          type: 'sendEmail',
          subject: 'Can we help with anything?',
          body:
            'Hi,\n\nThanks for stopping by. If you have a question before you go ahead, ' +
            'just reply to this email and we will help.\n\nThank you',
          toField: 'email',
          transactional: false,
        }
      : {
          type: 'createCrmTask',
          title: `Follow up: reached “${atLabel}”, not “${nextLabel}”`.slice(0, 120),
          kind: 'email',
          priority: 'normal',
          dueInDays: 1,
        }
  return { name, content: { action: { name, trigger, steps: [step] } } }
}
