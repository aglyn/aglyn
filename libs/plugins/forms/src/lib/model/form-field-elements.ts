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

/*
 * ONE ALL-IN-ONE FORM FIELD, REBUILT FROM MUI'S SEPARATE FORM ELEMENTS.
 *
 * Every piece of a field is its own Besigner element now (a Form Control
 * holding a Form Label and an Input, a Select of Select Options, a Radio Group
 * of Radios in Choice Labels, Checkboxes in Choice Labels, a Rating), so an
 * author selects and styles each piece with the ordinary Styles panel. The
 * all-in-one `formField` is still registered so a document nobody has migrated
 * keeps drawing, and this module is how each one is moved off it: the seeds,
 * the presets and `tools/scripts/backfill-formfield-elements.mjs` all build the
 * same tree from the same rules.
 *
 * What must survive the move, exactly:
 *
 * - **The field's id.** It stays on the Form Control wrapper, so a parent's
 *   `nodes` list, a reveal target and every placement override keyed by it
 *   still find the field. The wrapper takes the field's `sx` with it.
 * - **The name it submits under.** Contact-field mappings, dataset bindings
 *   and the consent field all key on it, so it is copied verbatim.
 * - **Everything a placement overrode.** A placed form's `attrOverrides`
 *   named the field's id and a prop of the all-in-one element; the slice is
 *   re-keyed onto the piece that now owns that prop.
 *
 * It lives with the forms plugin, which owns the all-in-one element, rather
 * than in core: a form's vocabulary is the plugin's domain (docs/PACKAGES.md
 * rule 3).
 *
 * Pure and dependency-free (no imports at all) on purpose: the backfill is a
 * plain Node script that imports this file directly from its TypeScript
 * source, and an import here would drag a package graph into it.
 */

/** A node as it is stored: a flat map entry with its children by id. */
export interface StoredFormNode {
  $id?: string
  componentId?: string
  pluginId?: string
  parentId?: string | null
  props?: Record<string, unknown>
  nodes?: string[]
  sx?: unknown
  [key: string]: unknown
}

/** The all-in-one element this module migrates away from. Persisted; never rename. */
export const LEGACY_FORM_FIELD_COMPONENT_ID = 'formField'

/** The bundle that registers every element a field is rebuilt from. */
export const FORM_FIELD_ELEMENTS_PLUGIN_ID = 'mui'

/**
 * MUI's form elements, by persisted component id — restated rather than
 * imported (see the module note; a plugin never imports another plugin).
 * `form-field-elements.spec.ts` holds this table equal to core's
 * `FORM_INPUT_ELEMENT_IDS` in `forms.ts`.
 */
export const FORM_FIELD_ELEMENT_IDS = {
  formControl: 'muiFormControl',
  formLabel: 'muiFormLabel',
  input: 'muiInput',
  select: 'muiSelect',
  selectOption: 'muiSelectOption',
  radioGroup: 'muiRadioGroup',
  radio: 'muiRadio',
  checkbox: 'muiCheckbox',
  choiceLabel: 'muiFormControlLabel',
  rating: 'muiRating',
} as const

/** The all-in-one element's types; anything else drew as a one-line text box. */
type LegacyFieldType =
  | 'text'
  | 'email'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'rating'

const LEGACY_FIELD_TYPES = new Set<string>([
  'text',
  'email',
  'textarea',
  'select',
  'radio',
  'checkbox',
  'rating',
])

/** The props the all-in-one element read; anything else rode onto its root. */
const LEGACY_FIELD_PROPS = new Set<string>([
  'fieldName',
  'datasetFieldId',
  'label',
  'placeholder',
  'fieldType',
  'options',
  'required',
])

/**
 * A choice list as the all-in-one element split it: newline- or
 * comma-separated, trimmed, empties dropped (its own `parseFieldOptions`).
 */
export function parseLegacyFieldOptions(options: unknown): string[] {
  return (typeof options === 'string' ? options : '')
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** Which new node owns each prop the all-in-one element had. */
export interface FormFieldElementsLayout {
  /** The Form Control; the field's own id. */
  rootId: string
  /** The Form Label, when the field has one (not a lone checkbox). */
  labelId?: string
  /** Every node that submits the answer and carries `name`. */
  answerIds: string[]
  /** The nodes a placeholder belongs on (Input, Select). */
  placeholderIds: string[]
  /** The nodes `required` is enforced on. */
  requiredIds: string[]
}

export interface FormFieldElements extends FormFieldElementsLayout {
  /** The wrapper and every new node under it, keyed by id. */
  nodes: Record<string, StoredFormNode>
}

/** Child ids of a stored node, in order. */
const childIds = (node: StoredFormNode | undefined): string[] =>
  Array.isArray(node?.nodes) ? (node?.nodes as string[]) : []

/**
 * The all-in-one `formField` node `node`, rebuilt as MUI's separate form
 * elements — or `null` when it is not one.
 *
 * `nodes` is the tree it sits in, read only so a new id never collides with
 * one already there. New ids are derived from the field's own
 * (`<id>-label`, `<id>-input`, `<id>-opt-0`, `<id>-opt-0-input`), so a
 * second run over the same field mints the same tree.
 */
export function formFieldToElements(
  node: StoredFormNode | undefined | null,
  nodes: Record<string, StoredFormNode | undefined> = {},
): FormFieldElements | null {
  if (!node || node.componentId !== LEGACY_FORM_FIELD_COMPONENT_ID) return null
  const id = String(node.$id ?? '')
  if (!id) return null

  const props = (node.props ?? {}) as Record<string, unknown>
  const rawName = props['fieldName']
  // Exactly what the element submitted under: `fieldName || 'field'`.
  const name = rawName === undefined || rawName === null || rawName === ''
    ? 'field'
    : String(rawName)
  const label =
    String(props['label'] || '') || String(rawName || '') || 'Field'
  const rawType = String(props['fieldType'] ?? 'text')
  const fieldType = (
    LEGACY_FIELD_TYPES.has(rawType) ? rawType : 'text'
  ) as LegacyFieldType
  const placeholder =
    typeof props['placeholder'] === 'string' && props['placeholder'].trim()
      ? (props['placeholder'] as string)
      : undefined
  const required = Boolean(props['required'])
  const datasetFieldId =
    typeof props['datasetFieldId'] === 'string' && props['datasetFieldId'].trim()
      ? (props['datasetFieldId'] as string)
      : undefined
  const options = parseLegacyFieldOptions(props['options'])

  // Whatever else the author's props held rode onto the element's root, so
  // it rides onto the wrapper.
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (!LEGACY_FIELD_PROPS.has(key)) rest[key] = value
  }

  const taken = new Set<string>(Object.keys(nodes))
  taken.delete(id)
  const mint = (base: string): string => {
    let candidate = base
    for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}-${n}`
    taken.add(candidate)
    return candidate
  }

  const out: Record<string, StoredFormNode> = {}
  const typed = node.type !== undefined ? { type: node.type } : {}
  const add = (
    nodeId: string,
    parentId: string,
    componentId: string,
    nodeProps: Record<string, unknown>,
  ): string => {
    out[nodeId] = {
      $id: nodeId,
      ...typed,
      componentId,
      pluginId: FORM_FIELD_ELEMENTS_PLUGIN_ID,
      parentId,
      props: nodeProps,
    }
    const parent = out[parentId]
    if (parent) parent.nodes = [...childIds(parent), nodeId]
    return nodeId
  }
  const mapping = datasetFieldId ? { datasetFieldId } : {}
  const req = required ? { required: true } : {}

  const fullWidth =
    fieldType === 'text' ||
    fieldType === 'email' ||
    fieldType === 'textarea' ||
    fieldType === 'select'
  const { nodes: _ownChildren, props: _props, ...shell } = node
  out[id] = {
    ...shell,
    componentId: FORM_FIELD_ELEMENT_IDS.formControl,
    pluginId: FORM_FIELD_ELEMENTS_PLUGIN_ID,
    props: {
      ...rest,
      ...(fullWidth ? { fullWidth: true } : {}),
      ...req,
    },
    nodes: [],
  }

  const layout: FormFieldElementsLayout = {
    rootId: id,
    answerIds: [],
    placeholderIds: [],
    requiredIds: [],
  }
  const addLabel = () => {
    layout.labelId = add(mint(`${id}-label`), id, FORM_FIELD_ELEMENT_IDS.formLabel, {
      children: label,
    })
  }

  switch (fieldType) {
    case 'select': {
      addLabel()
      const select = add(mint(`${id}-input`), id, FORM_FIELD_ELEMENT_IDS.select, {
        name,
        ...(placeholder ? { placeholder } : {}),
        ...req,
        fullWidth: true,
        ...mapping,
      })
      options.forEach((option, index) => {
        add(mint(`${id}-opt-${index}`), select, FORM_FIELD_ELEMENT_IDS.selectOption, {
          children: option,
        })
      })
      layout.answerIds.push(select)
      layout.placeholderIds.push(select)
      layout.requiredIds.push(select)
      break
    }
    case 'radio': {
      addLabel()
      const group = add(mint(`${id}-input`), id, FORM_FIELD_ELEMENT_IDS.radioGroup, {
        name,
        ...mapping,
      })
      options.forEach((option, index) => {
        const choice = add(
          mint(`${id}-opt-${index}`),
          group,
          FORM_FIELD_ELEMENT_IDS.choiceLabel,
          { label: option },
        )
        const radio = add(mint(`${id}-opt-${index}-input`), choice, FORM_FIELD_ELEMENT_IDS.radio, {
          value: option,
          ...req,
        })
        layout.requiredIds.push(radio)
      })
      layout.answerIds.push(group)
      break
    }
    case 'checkbox': {
      // A lone box is its own question: the words beside it say it all. A
      // group of boxes keeps the question above them.
      if (options.length !== 1) addLabel()
      options.forEach((option, index) => {
        const choice = add(
          mint(`${id}-opt-${index}`),
          id,
          FORM_FIELD_ELEMENT_IDS.choiceLabel,
          { label: option },
        )
        // `value` is the option text, as the all-in-one element posted it —
        // which is also what makes a single-option marketing consent box
        // read as ticked (`isConsentCheckboxTicked`). `required` only on a
        // lone box: on a group it meant "at least one", which a box of its
        // own cannot say.
        const box = add(mint(`${id}-opt-${index}-input`), choice, FORM_FIELD_ELEMENT_IDS.checkbox, {
          name,
          value: option,
          ...(options.length === 1 ? req : {}),
          ...mapping,
        })
        layout.answerIds.push(box)
        if (options.length === 1) layout.requiredIds.push(box)
      })
      break
    }
    case 'rating': {
      addLabel()
      const rating = add(mint(`${id}-input`), id, FORM_FIELD_ELEMENT_IDS.rating, {
        name,
        ...mapping,
      })
      layout.answerIds.push(rating)
      break
    }
    default: {
      addLabel()
      const input = add(mint(`${id}-input`), id, FORM_FIELD_ELEMENT_IDS.input, {
        name,
        type: fieldType === 'email' ? 'email' : 'text',
        ...(fieldType === 'textarea' ? { multiline: true, minRows: 3 } : {}),
        ...(placeholder ? { placeholder } : {}),
        ...req,
        fullWidth: true,
        ...mapping,
      })
      layout.answerIds.push(input)
      layout.placeholderIds.push(input)
      layout.requiredIds.push(input)
    }
  }

  // A self-closing field never had children, but one that somehow did keeps
  // them rather than orphaning them.
  const wrapper = out[id] as StoredFormNode
  wrapper.nodes = [...childIds(wrapper), ...childIds(node)]
  return { ...layout, nodes: out }
}

/**
 * Every all-in-one field in a tree, rebuilt — or `null` when the tree holds
 * none. The tree is not mutated; the result is a new map with each field
 * replaced in place (same id) and its new pieces added.
 */
export function migrateFormFieldNodes(
  nodes: Record<string, StoredFormNode | undefined> | null | undefined,
): { nodes: Record<string, StoredFormNode>; converted: string[] } | null {
  if (!nodes || typeof nodes !== 'object') return null
  const next: Record<string, StoredFormNode> = { ...(nodes as Record<string, StoredFormNode>) }
  const converted: string[] = []
  for (const [key, node] of Object.entries(nodes)) {
    if (!node || node.componentId !== LEGACY_FORM_FIELD_COMPONENT_ID) continue
    const elements = formFieldToElements({ ...node, $id: node.$id ?? key }, next)
    if (!elements) continue
    Object.assign(next, elements.nodes)
    converted.push(key)
  }
  return converted.length ? { nodes: next, converted } : null
}

/**
 * Which piece owns each prop of the field at `id` in a DEFINITION tree,
 * whether that tree still holds the all-in-one element or already holds its
 * replacement — so re-keying a placement works before and after the design
 * itself was migrated, and a re-run never double-moves anything.
 */
export function formFieldLayoutIn(
  definition: Record<string, StoredFormNode | undefined>,
  id: string,
): FormFieldElementsLayout | null {
  const node = definition[id]
  if (!node) return null
  if (node.componentId === LEGACY_FORM_FIELD_COMPONENT_ID) {
    const elements = formFieldToElements({ ...node, $id: node.$id ?? id }, definition)
    if (!elements) return null
    const { nodes: _nodes, ...layout } = elements
    return layout
  }
  if (node.componentId !== FORM_FIELD_ELEMENT_IDS.formControl) return null

  const layout: FormFieldElementsLayout = {
    rootId: id,
    answerIds: [],
    placeholderIds: [],
    requiredIds: [],
  }
  const checkboxes: string[] = []
  const stack = [...childIds(node)].reverse()
  const seen = new Set<string>([id])
  while (stack.length) {
    const childId = stack.pop() as string
    if (seen.has(childId)) continue
    seen.add(childId)
    const child = definition[childId]
    if (!child) continue
    switch (child.componentId) {
      case FORM_FIELD_ELEMENT_IDS.formLabel:
        if (!layout.labelId && child.parentId === id) layout.labelId = childId
        break
      case FORM_FIELD_ELEMENT_IDS.input:
      case FORM_FIELD_ELEMENT_IDS.select:
        layout.answerIds.push(childId)
        layout.placeholderIds.push(childId)
        layout.requiredIds.push(childId)
        break
      case FORM_FIELD_ELEMENT_IDS.radioGroup:
      case FORM_FIELD_ELEMENT_IDS.rating:
        layout.answerIds.push(childId)
        break
      case FORM_FIELD_ELEMENT_IDS.radio:
        layout.requiredIds.push(childId)
        break
      case FORM_FIELD_ELEMENT_IDS.checkbox:
        layout.answerIds.push(childId)
        checkboxes.push(childId)
        break
      default:
        break
    }
    const children = childIds(child)
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index] as string)
    }
  }
  if (checkboxes.length === 1) layout.requiredIds.push(checkboxes[0] as string)
  return layout
}

/** A placement override that had nowhere to go, reported rather than kept. */
export interface DroppedFormFieldOverride {
  key: string
  prop: string
}

/**
 * A placement's `attrOverrides` re-keyed for MUI's separate form elements, or
 * `null` when nothing in it named an all-in-one field's props.
 *
 * `overrides` is keyed by DEFINITION node ids (a placed form's design, a
 * reusable component's definition). A slice keyed by a field's id moves:
 * `label` onto the Form Label (as its text), `placeholder` onto the Input or
 * Select, `fieldName` onto every answer element (as `name`), `required` onto
 * the elements that enforce it and the wrapper, `datasetFieldId` onto the
 * answer elements. Anything else in the slice (`sx` among it) stays on the
 * field's id, which is the wrapper. `fieldType` and `options` re-shape the
 * field itself and have no single new home; they are dropped and returned so
 * the caller can report them.
 */
export function rekeyFormFieldOverrides(
  overrides: unknown,
  definition: Record<string, StoredFormNode | undefined> | null | undefined,
): {
  attrOverrides: Record<string, Record<string, unknown>>
  moved: number
  dropped: DroppedFormFieldOverride[]
} | null {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return null
  if (!definition) return null
  const source = overrides as Record<string, unknown>
  const next: Record<string, Record<string, unknown>> = {}
  for (const [key, slice] of Object.entries(source)) {
    if (slice && typeof slice === 'object' && !Array.isArray(slice)) {
      next[key] = { ...(slice as Record<string, unknown>) }
    }
  }
  const put = (targetId: string, prop: string, value: unknown) => {
    next[targetId] = { ...(next[targetId] ?? {}), [prop]: value }
  }
  let moved = 0
  const dropped: DroppedFormFieldOverride[] = []
  for (const [key, slice] of Object.entries(source)) {
    if (!slice || typeof slice !== 'object' || Array.isArray(slice)) continue
    const own = slice as Record<string, unknown>
    if (!Object.keys(own).some((prop) => LEGACY_FIELD_PROPS.has(prop))) continue
    const layout = formFieldLayoutIn(definition, key)
    if (!layout) continue
    const kept: Record<string, unknown> = {}
    for (const [prop, value] of Object.entries(own)) {
      switch (prop) {
        case 'label':
          if (layout.labelId) put(layout.labelId, 'children', value)
          else dropped.push({ key, prop })
          break
        case 'placeholder':
          if (layout.placeholderIds.length) {
            for (const target of layout.placeholderIds) put(target, 'placeholder', value)
          } else dropped.push({ key, prop })
          break
        case 'fieldName':
          if (layout.answerIds.length) {
            for (const target of layout.answerIds) put(target, 'name', value)
          } else dropped.push({ key, prop })
          break
        case 'datasetFieldId':
          if (layout.answerIds.length) {
            for (const target of layout.answerIds) put(target, 'datasetFieldId', value)
          } else dropped.push({ key, prop })
          break
        case 'required':
          kept['required'] = value
          for (const target of layout.requiredIds) put(target, 'required', value)
          break
        case 'fieldType':
        case 'options':
          dropped.push({ key, prop })
          break
        default:
          kept[prop] = value
      }
    }
    moved += 1
    // The wrapper's slice is rebuilt from what stayed, merged over anything
    // a re-key of ANOTHER field put there (none can — ids are per field —
    // but the merge keeps the rule obvious).
    const { label: _l, placeholder: _p, fieldName: _f, datasetFieldId: _d, fieldType: _t, options: _o, required: _r, ...others } =
      next[key] ?? {}
    const wrapper = { ...others, ...kept }
    if (Object.keys(wrapper).length) next[key] = wrapper
    else delete next[key]
  }
  return moved ? { attrOverrides: next, moved, dropped } : null
}

/**
 * The MUI class names a stored `sx` (or a style override slice) selects, such
 * as `& .MuiInputLabel-root` or `& .MuiOutlinedInput-notchedOutline`.
 *
 * The all-in-one element drew a TextField, so an author's styles could reach
 * into its inner classes. After the move a field is separate elements whose
 * own classes differ (`MuiFormLabel`, not `MuiInputLabel`), so such a
 * selector may match nothing; the backfill lists every one for a person to
 * restate on the right element.
 */
export function muiClassSelectorsIn(sx: unknown): string[] {
  const found = new Set<string>()
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 8) return
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      for (const match of key.matchAll(/Mui[A-Z][A-Za-z]*(?:-[A-Za-z]+)?/g)) {
        found.add(match[0])
      }
      visit(entry, depth + 1)
    }
  }
  visit(sx, 0)
  return [...found].sort()
}
