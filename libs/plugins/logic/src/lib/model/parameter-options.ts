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

import type { HostFunctionParameterOption } from '@aglyn/aglyn'

/**
 * A parameter's choice list as ONE line of text (AGL-3202):
 * `cms: A CMS and room to grow, entry: The entry plan only`. A bare entry is
 * both the value and what the visitor reads.
 *
 * One line, not a nested editor, because the Edit Function dialog already
 * asks for a name, a type and a required switch per parameter. The cost is
 * that a value cannot itself contain a comma, and a label cannot either; a
 * choice that needs one is a sign the question wants rewording.
 */
export function parseParameterOptions(
  text: string,
): HostFunctionParameterOption[] {
  const options: HostFunctionParameterOption[] = []
  const seen = new Set<string>()
  for (const part of String(text ?? '').split(',')) {
    const colon = part.indexOf(':')
    const value = (colon < 0 ? part : part.slice(0, colon)).trim()
    // The second copy of a value is a typo, not a second choice: a select
    // with two identical values cannot tell the function which was picked.
    if (!value || seen.has(value)) continue
    seen.add(value)
    const label = colon < 0 ? '' : part.slice(colon + 1).trim()
    options.push(label && label !== value ? { value, label } : { value })
  }
  return options
}

/** The inverse, for showing a stored list in that one line. */
export function formatParameterOptions(
  options: HostFunctionParameterOption[] | undefined,
): string {
  return (options ?? [])
    .map((option) =>
      option.label && option.label !== option.value
        ? `${option.value}: ${option.label}`
        : option.value,
    )
    .join(', ')
}
