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

/**
 * EVERY ALL-IN-ONE FORM FIELD, REBUILT FROM MUI'S SEPARATE FORM ELEMENTS.
 *
 * The move must keep three things exactly: the field's id (on the wrapper),
 * the name it submits under, and whatever a placement overrode on it.
 */

import type { AglynNodeSchema, NodeId } from '../foundation/definitions/components.types'
import {
  FORM_FIELD_ELEMENT_IDS,
  formFieldLayoutIn,
  formFieldToElements,
  migrateFormFieldNodes,
  muiClassSelectorsIn,
  rekeyFormFieldOverrides,
  type StoredFormNode,
} from './form-field-elements'
import {
  FORM_INPUT_ELEMENT_IDS,
  formFieldDeclsFromNodes,
  MARKETING_CONSENT_FORM_FIELD,
} from './forms'

const field = (
  $id: string,
  props: Record<string, unknown>,
  extra: Partial<StoredFormNode> = {},
): StoredFormNode => ({
  $id,
  componentId: 'formField',
  pluginId: 'forms',
  parentId: 'form',
  props,
  ...extra,
})

/** The new tree as `componentId(props) › children`, for readable assertions. */
function shape(nodes: Record<string, StoredFormNode>, id: string): unknown {
  const node = nodes[id] as StoredFormNode
  return {
    id,
    componentId: node.componentId,
    pluginId: node.pluginId,
    props: node.props,
    ...(node.nodes?.length
      ? { children: node.nodes.map((child) => shape(nodes, String(child))) }
      : {}),
  }
}

describe('formFieldToElements', () => {
  it('ignores anything that is not an all-in-one field', () => {
    expect(formFieldToElements({ $id: 'x', componentId: 'muiInput' })).toBeNull()
    expect(formFieldToElements(null)).toBeNull()
  })

  it('rebuilds a text field: Form Control › Form Label + Input, keeping id, sx and parent', () => {
    const result = formFieldToElements(
      field(
        'f1',
        { fieldName: 'name', label: 'Your name', placeholder: 'Jane', required: true, datasetFieldId: 'ds_name' },
        { sx: { marginTop: 2 }, interactions: [{ id: 'i' }] },
      ),
    )
    expect(result?.rootId).toBe('f1')
    expect(result?.nodes['f1']).toMatchObject({
      $id: 'f1',
      parentId: 'form',
      sx: { marginTop: 2 },
      interactions: [{ id: 'i' }],
    })
    expect(shape(result?.nodes ?? {}, 'f1')).toEqual({
      id: 'f1',
      componentId: 'muiFormControl',
      pluginId: 'mui',
      props: { fullWidth: true, required: true },
      children: [
        { id: 'f1-label', componentId: 'muiFormLabel', pluginId: 'mui', props: { children: 'Your name' } },
        {
          id: 'f1-input',
          componentId: 'muiInput',
          pluginId: 'mui',
          props: {
            name: 'name',
            type: 'text',
            placeholder: 'Jane',
            required: true,
            fullWidth: true,
            datasetFieldId: 'ds_name',
          },
        },
      ],
    })
    expect(result?.nodes['f1-input']?.parentId).toBe('f1')
    expect(result?.nodes['f1-label']?.parentId).toBe('f1')
  })

  it('rebuilds an email field as an email Input, labelled by its name when unlabelled', () => {
    const result = formFieldToElements(field('e', { fieldName: 'email', fieldType: 'email' }))
    expect(result?.nodes['e-label']?.props).toEqual({ children: 'email' })
    expect(result?.nodes['e-input']?.props).toEqual({ name: 'email', type: 'email', fullWidth: true })
  })

  it('rebuilds a textarea as a multi-line Input starting at three rows', () => {
    const result = formFieldToElements(field('m', { fieldName: 'message', label: 'Message', fieldType: 'textarea' }))
    expect(result?.nodes['m-input']?.props).toEqual({
      name: 'message',
      type: 'text',
      multiline: true,
      minRows: 3,
      fullWidth: true,
    })
  })

  it('rebuilds a select as a Select of Select Options', () => {
    const result = formFieldToElements(
      field('s', { fieldName: 'topic', label: 'Topic', fieldType: 'select', options: 'Sales\nSupport, Billing', placeholder: 'Pick', required: true }),
    )
    expect(shape(result?.nodes ?? {}, 's')).toEqual({
      id: 's',
      componentId: 'muiFormControl',
      pluginId: 'mui',
      props: { fullWidth: true, required: true },
      children: [
        { id: 's-label', componentId: 'muiFormLabel', pluginId: 'mui', props: { children: 'Topic' } },
        {
          id: 's-input',
          componentId: 'muiSelect',
          pluginId: 'mui',
          props: { name: 'topic', placeholder: 'Pick', required: true, fullWidth: true },
          children: [
            { id: 's-opt-0', componentId: 'muiSelectOption', pluginId: 'mui', props: { children: 'Sales' } },
            { id: 's-opt-1', componentId: 'muiSelectOption', pluginId: 'mui', props: { children: 'Support' } },
            { id: 's-opt-2', componentId: 'muiSelectOption', pluginId: 'mui', props: { children: 'Billing' } },
          ],
        },
      ],
    })
  })

  it('rebuilds a radio field as a Radio Group of Radios in Choice Labels', () => {
    const result = formFieldToElements(
      field('r', { fieldName: 'plan', label: 'Plan', fieldType: 'radio', options: 'Free,Pro', datasetFieldId: 'ds_plan' }),
    )
    expect(shape(result?.nodes ?? {}, 'r')).toEqual({
      id: 'r',
      componentId: 'muiFormControl',
      pluginId: 'mui',
      props: {},
      children: [
        { id: 'r-label', componentId: 'muiFormLabel', pluginId: 'mui', props: { children: 'Plan' } },
        {
          id: 'r-input',
          componentId: 'muiRadioGroup',
          pluginId: 'mui',
          props: { name: 'plan', datasetFieldId: 'ds_plan' },
          children: [
            {
              id: 'r-opt-0',
              componentId: 'muiFormControlLabel',
              pluginId: 'mui',
              props: { label: 'Free' },
              children: [{ id: 'r-opt-0-input', componentId: 'muiRadio', pluginId: 'mui', props: { value: 'Free' } }],
            },
            {
              id: 'r-opt-1',
              componentId: 'muiFormControlLabel',
              pluginId: 'mui',
              props: { label: 'Pro' },
              children: [{ id: 'r-opt-1-input', componentId: 'muiRadio', pluginId: 'mui', props: { value: 'Pro' } }],
            },
          ],
        },
      ],
    })
  })

  it('rebuilds a checkbox group: a Form Label over one named Checkbox per option, none required', () => {
    const result = formFieldToElements(
      field('c', { fieldName: 'interests', label: 'Interests', fieldType: 'checkbox', options: 'A\nB', required: true }),
    )
    expect(shape(result?.nodes ?? {}, 'c')).toEqual({
      id: 'c',
      componentId: 'muiFormControl',
      pluginId: 'mui',
      props: { required: true },
      children: [
        { id: 'c-label', componentId: 'muiFormLabel', pluginId: 'mui', props: { children: 'Interests' } },
        {
          id: 'c-opt-0',
          componentId: 'muiFormControlLabel',
          pluginId: 'mui',
          props: { label: 'A' },
          children: [{ id: 'c-opt-0-input', componentId: 'muiCheckbox', pluginId: 'mui', props: { name: 'interests', value: 'A' } }],
        },
        {
          id: 'c-opt-1',
          componentId: 'muiFormControlLabel',
          pluginId: 'mui',
          props: { label: 'B' },
          children: [{ id: 'c-opt-1-input', componentId: 'muiCheckbox', pluginId: 'mui', props: { name: 'interests', value: 'B' } }],
        },
      ],
    })
  })

  it('rebuilds a single checkbox with no Form Label, required on the box itself', () => {
    const result = formFieldToElements(
      field('t', { fieldName: 'terms', label: 'Terms', fieldType: 'checkbox', options: 'I agree', required: true }),
    )
    expect(result?.nodes['t']?.nodes).toEqual(['t-opt-0'])
    expect(result?.nodes['t-label']).toBeUndefined()
    expect(result?.nodes['t-opt-0-input']?.props).toEqual({ name: 'terms', value: 'I agree', required: true })
  })

  it('keeps the marketing consent box posting its option text, under its exact name', () => {
    const result = formFieldToElements(field('mc', { ...MARKETING_CONSENT_FORM_FIELD }))
    expect(result?.nodes['mc-opt-0']?.props).toEqual({ label: MARKETING_CONSENT_FORM_FIELD.options })
    expect(result?.nodes['mc-opt-0-input']?.props).toEqual({
      name: 'marketingConsent',
      value: MARKETING_CONSENT_FORM_FIELD.options,
    })
  })

  it('rebuilds a rating as a Form Label and a Rating', () => {
    const result = formFieldToElements(field('g', { fieldName: 'score', label: 'How did we do?', fieldType: 'rating', datasetFieldId: 'ds' }))
    expect(result?.nodes['g']?.nodes).toEqual(['g-label', 'g-input'])
    expect(result?.nodes['g-input']).toMatchObject({ componentId: 'muiRating', props: { name: 'score', datasetFieldId: 'ds' } })
  })

  it('keeps a field name EXACTLY, and an unnamed field submitting under "field" as before', () => {
    expect(formFieldToElements(field('a', { fieldName: 'First Name ' }))?.nodes['a-input']?.props?.['name']).toBe('First Name ')
    expect(formFieldToElements(field('b', {}))?.nodes['b-input']?.props?.['name']).toBe('field')
  })

  it('draws an unknown type (such as tel) as the one-line text box it always was', () => {
    expect(formFieldToElements(field('p', { fieldName: 'phone', fieldType: 'tel' }))?.nodes['p-input']?.props?.['type']).toBe('text')
  })

  it('never mints an id the tree already holds', () => {
    const result = formFieldToElements(field('f', { fieldName: 'x' }), { 'f-label': { $id: 'f-label' } })
    expect(result?.labelId).toBe('f-label-2')
    expect(result?.nodes['f']?.nodes).toEqual(['f-label-2', 'f-input'])
  })

  it('names the same element ids forms.ts reads', () => {
    expect(FORM_FIELD_ELEMENT_IDS).toEqual(FORM_INPUT_ELEMENT_IDS)
  })
})

describe('migrateFormFieldNodes', () => {
  const tree: Record<string, StoredFormNode> = {
    form: { $id: 'form', componentId: 'form', pluginId: 'forms', parentId: null, props: { formId: 'f' }, nodes: ['a', 'b', 'c', 'd', 'e', 'mc'] },
    a: field('a', { fieldName: 'name', label: 'Name', required: true }),
    b: field('b', { fieldName: 'email', label: 'Email', fieldType: 'email', required: true, datasetFieldId: 'ds_email' }),
    c: field('c', { fieldName: 'topic', label: 'Topic', fieldType: 'select', options: 'One\nTwo' }),
    d: field('d', { fieldName: 'plan', label: 'Plan', fieldType: 'radio', options: 'Free,Pro', required: true }),
    e: field('e', { fieldName: 'likes', label: 'Likes', fieldType: 'checkbox', options: 'X\nY', required: true }),
    mc: field('mc', { ...MARKETING_CONSENT_FORM_FIELD }),
  }

  it('replaces each field in place and leaves the parent’s child list untouched', () => {
    const result = migrateFormFieldNodes(tree)
    expect(result?.converted).toEqual(['a', 'b', 'c', 'd', 'e', 'mc'])
    expect(result?.nodes['form']).toBe(tree['form'])
    expect(Object.values(result?.nodes ?? {}).some((node) => node.componentId === 'formField')).toBe(false)
    // Not mutated.
    expect(tree['a']?.componentId).toBe('formField')
  })

  it('returns null for a tree with nothing to migrate, so a re-run writes nothing', () => {
    const once = migrateFormFieldNodes(tree)
    expect(migrateFormFieldNodes(once?.nodes)).toBeNull()
    expect(migrateFormFieldNodes({})).toBeNull()
  })

  it('declares the same fields after the move as before it', () => {
    const before = formFieldDeclsFromNodes(tree as Record<NodeId, AglynNodeSchema>, 'form')
    const after = formFieldDeclsFromNodes(
      migrateFormFieldNodes(tree)?.nodes as Record<NodeId, AglynNodeSchema>,
      'form',
    )
    const comparable = (decls: typeof before) =>
      decls.map(({ fieldName, fieldType, options, required, datasetFieldId }) => ({
        fieldName,
        fieldType,
        options,
        required,
        datasetFieldId,
      }))
    expect(comparable(after)).toEqual(comparable(before))
    // Labels too, except the lone consent box, whose words are now its option.
    expect(after.slice(0, 5).map((decl) => decl.label)).toEqual(before.slice(0, 5).map((decl) => decl.label))
  })
})

describe('rekeyFormFieldOverrides', () => {
  const design: Record<string, StoredFormNode> = {
    root: { $id: 'root', componentId: 'form', props: { formId: 'f' }, nodes: ['a', 'c', 'mc'] },
    a: field('a', { fieldName: 'name', label: 'Name' }, { parentId: 'root' }),
    c: field('c', { fieldName: 'likes', label: 'Likes', fieldType: 'checkbox', options: 'X\nY' }, { parentId: 'root' }),
    mc: field('mc', { ...MARKETING_CONSENT_FORM_FIELD }, { parentId: 'root' }),
  }

  it('moves label, placeholder, name and mapping onto the pieces that own them, sx stays on the wrapper', () => {
    const result = rekeyFormFieldOverrides(
      {
        root: { submitLabel: 'Go' },
        a: { label: 'Full name', placeholder: 'Jane Doe', fieldName: 'fullName', datasetFieldId: 'ds', sx: { color: 'red' }, required: true },
      },
      design,
    )
    expect(result?.attrOverrides).toEqual({
      root: { submitLabel: 'Go' },
      a: { sx: { color: 'red' }, required: true },
      'a-label': { children: 'Full name' },
      'a-input': { placeholder: 'Jane Doe', name: 'fullName', datasetFieldId: 'ds', required: true },
    })
    expect(result?.dropped).toEqual([])
  })

  it('renames every box of a checkbox group, and reports what has no home', () => {
    const result = rekeyFormFieldOverrides(
      { c: { fieldName: 'hobbies', options: 'P\nQ' }, mc: { label: 'News?' } },
      design,
    )
    expect(result?.attrOverrides).toEqual({
      'c-opt-0-input': { name: 'hobbies' },
      'c-opt-1-input': { name: 'hobbies' },
    })
    expect(result?.dropped).toEqual([
      { key: 'c', prop: 'options' },
      { key: 'mc', prop: 'label' },
    ])
  })

  it('re-keys the same way after the design itself was migrated', () => {
    const migrated = migrateFormFieldNodes(design)?.nodes ?? {}
    expect(formFieldLayoutIn(migrated, 'a')).toEqual(formFieldLayoutIn(design, 'a'))
    expect(formFieldLayoutIn(migrated, 'c')).toEqual(formFieldLayoutIn(design, 'c'))
    expect(
      rekeyFormFieldOverrides({ a: { label: 'Full name' } }, migrated)?.attrOverrides,
    ).toEqual({ 'a-label': { children: 'Full name' } })
  })

  it('leaves overrides that name no field prop alone (null: nothing to write)', () => {
    expect(rekeyFormFieldOverrides({ a: { sx: { color: 'red' } } }, design)).toBeNull()
    expect(rekeyFormFieldOverrides({ zzz: { label: 'x' } }, design)).toBeNull()
    expect(rekeyFormFieldOverrides(undefined, design)).toBeNull()
  })
})

describe('muiClassSelectorsIn', () => {
  it('lists the MUI classes an sx reaches into, at any depth', () => {
    expect(
      muiClassSelectorsIn({
        color: 'red',
        '& .MuiInputLabel-root': { color: 'blue' },
        '@media (min-width:600px)': { '& .MuiOutlinedInput-notchedOutline': { border: 0 } },
        '&.Mui-focused .MuiInputBase-input': {},
      }),
    ).toEqual(['MuiInputBase-input', 'MuiInputLabel-root', 'MuiOutlinedInput-notchedOutline'])
    expect(muiClassSelectorsIn({ color: 'red' })).toEqual([])
    expect(muiClassSelectorsIn(undefined)).toEqual([])
  })
})
