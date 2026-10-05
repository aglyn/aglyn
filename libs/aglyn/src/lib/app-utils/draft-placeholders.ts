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
  type InteractionStepBase,
  interactionStepTypedFields,
  normalizeTriggerConditions,
  type SiteInteraction,
} from './site-interactions'

/**
 * PLACEHOLDERS IN A DRAFTED INTERACTION (AGL-2919).
 *
 * A placeholder is a value a person still has to supply, written in square
 * brackets where the value belongs: `[newsletter]` where a list is named,
 * `[your phone number]` in an email's body. An interaction drafted for
 * somebody to review — by a generator working from a description, an importer
 * bringing flows over from another tool — carries one wherever the draft could
 * not name a real record or did not know a fact.
 *
 * Square brackets because they are inert everywhere an interaction reads a
 * value. A bracketed record name matches no record by name, so the step
 * reports the unknown name in the run history rather than acting on the wrong
 * record; a bracketed condition value equals no field an event carries, so a
 * trigger never fires on a guess; and the Reference health audit already
 * reports a name that resolves to nothing.
 *
 * Only the fields a person types words into are read: the conditions, and
 * each step's `typedFields` — the platform's own for its client steps, and
 * the declaring plugin's for every other (`interactionSteps` in
 * `plugins.config.json`). Selectors, class names, HTML and scripts use
 * brackets as syntax and never hold a placeholder. The drafter that writes
 * placeholders, the editor that highlights them and the switch that names them
 * before an interaction runs all read them here, so they never disagree about
 * what is missing.
 */

/**
 * A bracketed placeholder inside a value. Not one followed by `(`, which is a
 * written link (`[our menu](https://…)`) rather than a gap, and never across a
 * line or longer than a phrase.
 */
export const DRAFT_PLACEHOLDER_PATTERN = /\[([^[\]\n]{1,120})\](?!\()/

/** The longest words a placeholder keeps. */
export const DRAFT_PLACEHOLDER_MAX_CHARS = 100

/** The words inside the first placeholder in a value, or `null` when it holds none. */
export function draftPlaceholderIn(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = DRAFT_PLACEHOLDER_PATTERN.exec(value)
  const words = match?.[1]?.trim()
  return words ? words : null
}

/**
 * `words` as a placeholder: on one line, without brackets of their own, cut
 * to a phrase. Empty words still make a placeholder, so a value that must be
 * supplied is never written as an empty string a validator would refuse.
 */
export function draftPlaceholder(words: string): string {
  const clean = words
    .replace(/[[\]\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DRAFT_PLACEHOLDER_MAX_CHARS)
    .trim()
  return `[${clean || 'to fill in'}]`
}

/** One placeholder an interaction holds. */
export interface InteractionPlaceholder {
  /** The 1-based step holding it; `null` for the trigger's own conditions. */
  step: number | null
  /** The stored field it is in, or `condition` for a condition's value. */
  field: string
  /** What a sentence calls that field: "the list", "a condition value". */
  names: string
  /** The words inside the brackets. */
  text: string
}

/** The field a condition's placeholder is reported as, and its words. */
const CONDITION = { field: 'condition', names: 'a condition value' } as const

/** The placeholders one step holds, in its fields' order: its guard, then its typed fields. */
export function interactionStepPlaceholders(
  step: InteractionStepBase,
  index: number,
): InteractionPlaceholder[] {
  const found: InteractionPlaceholder[] = []
  const number = index + 1
  for (const clause of step.when?.conditions ?? []) {
    const text = draftPlaceholderIn(clause?.value)
    if (text) found.push({ step: number, ...CONDITION, text })
  }
  for (const { key, names } of interactionStepTypedFields(step.type)) {
    const text = draftPlaceholderIn(step[key])
    if (text) found.push({ step: number, field: key, names, text })
  }
  return found
}

/** Every placeholder an interaction holds: its trigger's conditions first, then each step's. */
export function interactionPlaceholders(
  interaction: Pick<SiteInteraction<InteractionStepBase>, 'trigger' | 'steps'> | null | undefined,
): InteractionPlaceholder[] {
  if (!interaction) return []
  const found: InteractionPlaceholder[] = []
  for (const condition of normalizeTriggerConditions(interaction.trigger)) {
    const text = draftPlaceholderIn(condition?.value)
    if (text) found.push({ step: null, ...CONDITION, text })
  }
  ;(interaction.steps ?? []).forEach((step, index) => {
    if (step) found.push(...interactionStepPlaceholders(step, index))
  })
  return found
}

/** One placeholder as a person reads it: where it is, and what it stands in for. */
export function describeInteractionPlaceholder(placeholder: InteractionPlaceholder): string {
  const where = placeholder.step === null ? 'The trigger' : `Step ${placeholder.step}`
  return `${where}: ${placeholder.names} (“${placeholder.text}”)`
}
