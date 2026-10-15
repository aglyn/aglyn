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

import type * as Aglyn from '@aglyn/aglyn'

/*
 * A CALCULATOR READS THE SITE'S OWN FORM FIELDS (AGL-3825).
 *
 * A calculator's questions do not need a calculator-only control. Any form
 * field the site builder offers — an Input, a Select, a Checkbox, a Radio
 * Group, a Rating, a Date or Time Picker — placed inside a Calculator and
 * named after one of its function's parameters is that parameter's input.
 * The Calculator listens on its own box for the `input` and `change` events
 * those fields raise (the pickers raise one for every date or time picked),
 * reads the field the way a form would send it, and hands the function the
 * text.
 *
 * Read exactly as a form submits them, so a field means the same thing in a
 * form and in a calculator: a Checkbox sends its Value when ticked (several
 * of one name, joined with `, `), a Radio Group the checked Radio's Value,
 * a Select its option's value, everything else what it holds. The one
 * translation is for a true/false parameter, which a lone Checkbox or a
 * Switch answers as `true` or `false`.
 */

/** A form control as the DOM hands it over. */
interface FieldElement {
  name: string
  value: string
  type?: string
  checked?: boolean
}

const FIELD_SELECTOR = 'input[name], select[name], textarea[name]'

function asField(target: EventTarget | Element | null): FieldElement | null {
  const field = target as Partial<FieldElement> & { tagName?: string } | null
  if (!field || typeof field.name !== 'string' || !field.name) return null
  const tag = String(field.tagName ?? '').toUpperCase()
  if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') return null
  return field as FieldElement
}

/** Every field of `name` inside `root`, in document order. */
function fieldsNamed(root: ParentNode, name: string): FieldElement[] {
  const found: FieldElement[] = []
  for (const element of Array.from(root.querySelectorAll(FIELD_SELECTOR))) {
    const field = asField(element)
    if (field && field.name === name) found.push(field)
  }
  return found
}

/**
 * What the field `name` inside `root` answers for `parameter`, or `null`
 * when nothing in `root` is named that.
 */
export function readFieldAnswer(
  root: ParentNode,
  name: string,
  parameter: Pick<Aglyn.HostFunctionParameter, 'type'> | undefined,
): string | null {
  const fields = fieldsNamed(root, name)
  if (!fields.length) return null
  const boxes = fields.filter((field) => field.type === 'checkbox')
  if (boxes.length) {
    if (parameter?.type === 'boolean') return boxes.some((box) => box.checked) ? 'true' : 'false'
    return boxes
      .filter((box) => box.checked)
      .map((box) => box.value)
      .join(', ')
  }
  const radios = fields.filter((field) => field.type === 'radio')
  if (radios.length) return radios.find((radio) => radio.checked)?.value ?? ''
  return fields[0].value ?? ''
}

/**
 * Starts listening on `root` for the fields that answer `definition`'s
 * parameters, and reads each one once now so a field that starts filled
 * (a Select's first option, a Date Picker set to start on today) counts
 * before anyone touches it. Returns the stop.
 */
export function listenToFunctionFields(
  root: HTMLElement,
  definition: Aglyn.HostFunction,
  setArgument: (name: string, value: string) => void,
): () => void {
  const parameters = new Map(
    (definition.parameters ?? []).map((parameter) => [parameter.name, parameter]),
  )
  const answer = (name: string) => {
    const value = readFieldAnswer(root, name, parameters.get(name))
    if (value !== null) setArgument(name, value)
  }
  for (const name of parameters.keys()) answer(name)
  const onField = (event: Event) => {
    const field = asField(event.target)
    if (field && parameters.has(field.name)) answer(field.name)
  }
  root.addEventListener('input', onField)
  root.addEventListener('change', onField)
  return () => {
    root.removeEventListener('input', onField)
    root.removeEventListener('change', onField)
  }
}
