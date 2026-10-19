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

import type { AiBuildPlan } from './ai-build-plan'
import type { AiJobInputField, AiJobInputRequest } from './ai-jobs.types'

/**
 * A job that waits for a person's answer (AGL-3978) — a tracking change with
 * no Meta pixel ID — and the answer it goes on with. Pure, so the console's
 * field, the resume door and the machine all read one set of rules.
 */

/** What one field's answer is sent under: the item it fills and the argument. */
export function aiJobInputKey(field: Pick<AiJobInputField, 'item' | 'arg'>): string {
  return `${field.item}/${field.arg}`
}

/** "a Meta pixel ID", "an …". */
const article = (label: string): string => `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}`

/**
 * Why each answer cannot be used, by its key, or an empty map when every
 * field is answered with an id of its shape: a field left empty, and an
 * answer its pattern refuses, in the card's own words.
 */
export function aiJobInputProblems(
  request: AiJobInputRequest,
  values: Readonly<Record<string, unknown>> | null | undefined,
): Record<string, string> {
  const problems: Record<string, string> = {}
  for (const field of request.fields) {
    const key = aiJobInputKey(field)
    const raw = values?.[key]
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (!value) problems[key] = `Enter your ${field.label}. It looks like ${field.shape}.`
    else if (!new RegExp(field.pattern).test(value)) {
      problems[key] = `“${value.slice(0, 40)}” is not ${article(field.label)}, which looks like ${field.shape}.`
    }
  }
  return problems
}

/** The plan with each answer written to the argument its field names. Call once `aiJobInputProblems` is empty. */
export function aiPlanWithInput<P extends AiBuildPlan>(
  plan: P,
  request: AiJobInputRequest,
  values: Readonly<Record<string, unknown>>,
): P {
  const items = (plan.items ?? []).map((item) => {
    const answers = request.fields.filter((field) => field.item === item.name)
    if (!answers.length) return item
    const args = { ...item.args }
    for (const field of answers) args[field.arg] = String(values[aiJobInputKey(field)] ?? '').trim()
    return { ...item, args }
  })
  return { ...plan, items }
}
