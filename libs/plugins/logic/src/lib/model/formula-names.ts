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


/** A name a formula can read, grouped the way the picker lists it. */
export interface FormulaName {
  value: string
  label: string
  group: string
}

const VALID_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/

/**
 * Everything a function's formula can read, in the order the evaluator
 * resolves a clash: its parameters, its own variables, then the site's
 * variables — each dictionary's members listed under it as `name.member`,
 * since that is how a step reads one (AGL-3202).
 */
export function formulaNames(input: {
  parameters: readonly { name: string }[]
  locals: readonly { name: string }[]
  siteVariables: readonly { name?: string; type?: string; value?: string }[]
}): FormulaName[] {
  const names: FormulaName[] = []
  const seen = new Set<string>()
  const push = (value: string, label: string, group: string) => {
    if (seen.has(value)) return
    seen.add(value)
    names.push({ value, label, group })
  }
  for (const parameter of input.parameters) {
    if (VALID_NAME.test(parameter.name)) {
      push(parameter.name, parameter.name, 'Parameters')
    }
  }
  for (const local of input.locals) {
    if (VALID_NAME.test(local.name)) {
      push(local.name, local.name, 'This function’s variables')
    }
  }
  const sorted = [...input.siteVariables].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  for (const variable of sorted) {
    const name = String(variable.name ?? '')
    if (!VALID_NAME.test(name)) continue
    if (variable.type === 'collection') continue
    if (variable.type !== 'dictionary') {
      push(name, name, 'Site variables')
      continue
    }
    let entries: Record<string, unknown> | null = null
    try {
      const parsed: unknown = JSON.parse(String(variable.value ?? ''))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        entries = parsed as Record<string, unknown>
      }
    } catch {
      entries = null
    }
    for (const [member, value] of Object.entries(entries ?? {})) {
      if (!VALID_NAME.test(member)) continue
      if (!['number', 'string', 'boolean'].includes(typeof value)) continue
      push(`${name}.${member}`, `${name} → ${member}`, 'Site variables')
    }
  }
  return names
}
