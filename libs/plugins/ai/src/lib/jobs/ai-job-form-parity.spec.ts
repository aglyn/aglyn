/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * The form step's vocabulary is the Forms editor's (AGL-2913), held in both
 * directions against the sources the editor is built from. A plugin never
 * imports another plugin, so the forms plugin's schema is read as source.
 *
 *  - THE FIELD SETTINGS. A generated form is a Form built from MUI's
 *    separate form elements (each piece of a field its own element) and an
 *    optional Button, never the all-in-one Form Field. The Form's palette
 *    props are the forms plugin's attributes, less the record pickers the
 *    palette generator leaves off — the dataset field picker on each answer
 *    element among them; every declared `FormFieldType` is reachable from the
 *    elements with props the palette offers, and survives the declaration
 *    reader.
 *  - THE CONSENT FIELD. A Choice Label holding one Checkbox, in the words of
 *    the editor's Marketing consent preset; its props are palette props, it
 *    declares one option, and its ticked value is read as consent. It takes
 *    the place of a consent box the model drew in any shape, frame and all.
 *  - THE ROUTING. A proposal writes only what the form's page edits, and the
 *    tool offers exactly the kinds the step reads.
 *  - THE TOOL. Strict: every object closes its properties and requires each.
 */

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async () => null,
}))

jest.mock('@aglyn/tenant-data-admin/server/duplicate-resource', () => ({
  __esModule: true,
  duplicateResource: jest.fn(),
}))

jest.mock('../runtime/site-inventory', () => ({
  __esModule: true,
  readSiteInventory: jest.fn(),
}))

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FORM_INPUT_ELEMENT_IDS,
  FORM_PLUGIN_ANSWER_ELEMENTS,
  formFieldDeclsFromNodes,
  isMarketingConsentFieldName,
  MARKETING_CONSENT_FORM_FIELD,
  readFormDeclaredConsent,
} from '@aglyn/aglyn/app-utils/forms'
import { MARKETING_CONSENT_FIELD } from '@aglyn/aglyn/app-utils/marketing-consent'
import { AI_PALETTE, AI_SURFACES } from '../runtime/ai-palette.generated'
import {
  AI_FORM_CONSENT_CHECKBOX_NODE_ID,
  AI_FORM_CONSENT_NODE_ID,
  AI_FORM_CONSENT_VALUE,
  AI_FORM_ROUTING_KINDS,
  AI_JOB_FORM_TOOL,
  aiFormConsentNodes,
  aiFormDraft,
} from './ai-job-form-step'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const FORMS_PLUGIN = readFileSync(
  join(REPO_ROOT, 'libs/plugins/forms/src/lib/components/form.tsx'),
  'utf8',
)
const FORMS_MODEL = readFileSync(join(REPO_ROOT, 'libs/aglyn/src/lib/app-utils/forms.ts'), 'utf8')
const MUI_FORM_CONTROLS = readFileSync(
  join(REPO_ROOT, 'libs/plugins/mui/src/lib/components/form-controls.tsx'),
  'utf8',
)

/**
 * Field editors that pick a record the site holds — a form, a dataset, a
 * dataset's field, another element. The palette generator leaves them off,
 * because a model cannot write one from a description; the step stamps the
 * one binding a generated form needs, its `formId`, itself.
 */
const RECORD_PICKERS = new Set(['FORM_SELECT', 'DATASET_SELECT', 'DATASET_FIELD_SELECT', 'NODE_SELECT'])

/** A schema's attributes, name and field editor, as the forms plugin declares them. */
function attributesOf(schema: string): Array<{ name: string; component: string }> {
  const start = FORMS_PLUGIN.indexOf(`export const ${schema}`)
  expect([schema, start > -1]).toEqual([schema, true])
  const block = FORMS_PLUGIN.slice(start, FORMS_PLUGIN.indexOf('\n}\n', start))
  return [
    ...block.matchAll(/name: '([A-Za-z]+)',[\s\S]*?component: Aglyn\.FieldComponentType\.([A-Z_]+)/g),
  ].map((match) => ({ name: match[1], component: match[2] }))
}

/** One preset's literal, by its display name. */
function presetNamed(displayName: string): string {
  const at = FORMS_PLUGIN.indexOf(`displayName: '${displayName}'`)
  expect([displayName, at > -1]).toEqual([displayName, true])
  return FORMS_PLUGIN.slice(FORMS_PLUGIN.lastIndexOf('\n  {', at), FORMS_PLUGIN.indexOf('\n  },', at))
}

/** One piece of a design: an element, its props and the pieces it holds. */
interface Piece {
  id: string
  componentId: string
  props?: Record<string, unknown>
  nodes?: Piece[]
}

/** A design of the given pieces under a form node, flattened into a node map. */
function formOf(...pieces: Piece[]) {
  const nodes: Record<string, any> = {
    form: { $id: 'form', componentId: 'form', props: {}, nodes: pieces.map((piece) => piece.id) },
  }
  const add = (piece: Piece, parentId: string) => {
    nodes[piece.id] = {
      $id: piece.id,
      componentId: piece.componentId,
      parentId,
      props: { ...(piece.props ?? {}) },
      nodes: (piece.nodes ?? []).map((child) => child.id),
    }
    for (const child of piece.nodes ?? []) add(child, piece.id)
  }
  for (const piece of pieces) add(piece, 'form')
  return { rootId: 'form', nodes }
}

/** A field as the form job draws one: a Form Control over a Form Label and its answer. */
const field = (id: string, label: string, answer: Omit<Piece, 'id'>): Piece => ({
  id,
  componentId: 'muiFormControl',
  props: { fullWidth: true },
  nodes: [
    { id: `${id}Label`, componentId: 'muiFormLabel', props: { children: label } },
    { id: `${id}Answer`, ...answer },
  ],
})

/** A box with words beside it: a Choice Label holding one Checkbox. */
const tick = (id: string, label: string, props: Record<string, unknown>): Piece => ({
  id,
  componentId: 'muiFormControlLabel',
  props: { label },
  nodes: [{ id: `${id}Box`, componentId: 'muiCheckbox', props }],
})

/** MUI's separate form elements, as the declaration reader names them, and Helper Text. */
const FORM_ELEMENTS = [...Object.values(FORM_INPUT_ELEMENT_IDS), 'muiFormHelperText']

/** The elements whose `name` is the key an answer is submitted under. */
const ANSWER_ELEMENTS = ['muiInput', 'muiSelect', 'muiRadioGroup', 'muiCheckbox', 'muiRating', 'muiDatePicker', 'muiTimePicker']

describe('the field settings', () => {
  it('builds a generated form from MUI’s separate form elements and a Button, never the all-in-one Form Field', () => {
    const allow = AI_SURFACES.form.allow
    expect(AI_SURFACES.form.root).toBe('form')
    expect(allow).not.toContain('formField')
    expect([...allow].sort()).toEqual(['form', ...FORM_ELEMENTS, 'muiButton'].sort())
    // A Button may be the form's submit: its type is offered.
    expect(AI_PALETTE['muiButton'].propsSchema.properties['type'].enum).toContain('submit')
  })

  it('lets each answer element carry the name it submits under, never the dataset field picker the step binds itself', () => {
    expect(MUI_FORM_CONTROLS).toMatch(
      /name: 'datasetFieldId',[\s\S]*?component: Aglyn\.FieldComponentType\.DATASET_FIELD_SELECT/,
    )
    expect(RECORD_PICKERS.has('DATASET_FIELD_SELECT')).toBe(true)
    for (const componentId of ANSWER_ELEMENTS) {
      const properties = AI_PALETTE[componentId].propsSchema.properties
      expect([componentId, Boolean(properties['name']), Boolean(properties['datasetFieldId'])]).toEqual([
        componentId,
        true,
        false,
      ])
    }
  })

  it('lets a generated Form carry exactly its settings, less the pickers, and stamps the one binding itself', () => {
    const attributes = attributesOf('formSchema')
    expect(Object.keys(AI_PALETTE['form'].propsSchema.properties).sort()).toEqual(
      attributes
        .filter((attribute) => !RECORD_PICKERS.has(attribute.component))
        .map((attribute) => attribute.name)
        .sort(),
    )
    const draft = aiFormDraft(
      formOf(field('name', 'Name', { componentId: 'muiInput', props: { name: 'name' } })),
      {},
      { formId: 'f-1', name: 'Contact' },
    )
    expect(draft.nodes['form'].props).toMatchObject({ formId: 'f-1', formName: 'Contact' })
    expect(attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['formId', 'formName']))
  })

  it('reaches every field type the declaration names, with props the palette offers', () => {
    const union = FORMS_MODEL.slice(
      FORMS_MODEL.indexOf('export type FormFieldType'),
      FORMS_MODEL.indexOf('\n\n', FORMS_MODEL.indexOf('export type FormFieldType')),
    )
    const declared = [...union.matchAll(/'([a-z]+)'/g)].map((match) => match[1])
    const answers: Record<string, Omit<Piece, 'id'>> = {
      text: { componentId: 'muiInput', props: { name: 'answer' } },
      email: { componentId: 'muiInput', props: { name: 'answer', type: 'email' } },
      textarea: { componentId: 'muiInput', props: { name: 'answer', multiline: true } },
      select: {
        componentId: 'muiSelect',
        props: { name: 'answer' },
        nodes: [{ id: 'option', componentId: 'muiSelectOption', props: { children: 'One' } }],
      },
      radio: {
        componentId: 'muiRadioGroup',
        props: { name: 'answer' },
        nodes: [
          {
            id: 'choice',
            componentId: 'muiFormControlLabel',
            props: { label: 'One' },
            nodes: [{ id: 'radio', componentId: 'muiRadio', props: { value: 'One' } }],
          },
        ],
      },
      checkbox: { componentId: 'muiCheckbox', props: { name: 'answer', value: 'Yes' } },
      rating: { componentId: 'muiRating', props: { name: 'answer' } },
      date: { componentId: 'muiDatePicker', props: { name: 'answer', disablePast: true } },
      time: { componentId: 'muiTimePicker', props: { name: 'answer', minutesStep: '15' } },
    }
    // A File upload and a Product and options field (AGL-4098) are other
    // plugins' elements, not MUI's: a generated form is built from MUI's
    // alone, so their two types are the ones it does not reach.
    const otherPlugins = new Set<string>(Object.values(FORM_PLUGIN_ANSWER_ELEMENTS))
    expect([...otherPlugins].sort()).toEqual(['file', 'product'])
    expect(Object.keys(answers).sort()).toEqual(declared.filter((type) => !otherPlugins.has(type)).sort())
    for (const [fieldType, answer] of Object.entries(answers)) {
      const { nodes } = formOf(field('question', 'Question', answer))
      expect([fieldType, formFieldDeclsFromNodes(nodes, 'form')[0]?.fieldType]).toEqual([fieldType, fieldType])
      for (const node of Object.values(nodes)) {
        if (node.componentId === 'form') continue
        const schema = AI_PALETTE[node.componentId].propsSchema.properties
        for (const [prop, value] of Object.entries(node.props as Record<string, unknown>)) {
          expect([node.componentId, prop, Boolean(schema[prop])]).toEqual([node.componentId, prop, true])
          if (schema[prop]?.enum) expect(schema[prop].enum).toContain(value)
        }
      }
    }
  })
})

describe('the consent field', () => {
  const signup = () =>
    aiFormDraft(
      formOf(field('email', 'Email', { componentId: 'muiInput', props: { name: 'email', type: 'email' } })),
      {},
      { formId: 'f-1', name: 'Signup' },
    )

  it('is a Choice Label holding one Checkbox, in the words of the editor’s Marketing consent preset', () => {
    const preset = presetNamed('Marketing consent')
    expect(preset).toMatch(/fieldPresetData\(\{ \.\.\.Aglyn\.MARKETING_CONSENT_FORM_FIELD \}\)/)
    const draft = signup()
    expect(draft.nodes[AI_FORM_CONSENT_NODE_ID]).toMatchObject({
      componentId: 'muiFormControlLabel',
      parentId: 'form',
      nodes: [AI_FORM_CONSENT_CHECKBOX_NODE_ID],
      props: { label: MARKETING_CONSENT_FORM_FIELD.options },
    })
    expect(draft.nodes[AI_FORM_CONSENT_CHECKBOX_NODE_ID]).toMatchObject({
      componentId: 'muiCheckbox',
      parentId: AI_FORM_CONSENT_NODE_ID,
      props: { name: MARKETING_CONSENT_FORM_FIELD.fieldName, value: AI_FORM_CONSENT_VALUE },
    })
    expect((draft.nodes['form'].nodes as string[]).at(-1)).toBe(AI_FORM_CONSENT_NODE_ID)
    expect(draft.consentFieldName).toBe(MARKETING_CONSENT_FORM_FIELD.fieldName)
  })

  it('holds to the palette: known props, text within its limits, unticked and never required', () => {
    for (const node of aiFormConsentNodes('form')) {
      const entry = AI_PALETTE[String(node.componentId)]
      expect(node.pluginId).toBe(entry.pluginId)
      for (const [prop, value] of Object.entries(node.props as Record<string, unknown>)) {
        expect([prop, Boolean(entry.propsSchema.properties[prop])]).toEqual([prop, true])
        if (typeof value === 'string' && entry.textLimits[prop]) {
          expect(value.length).toBeLessThanOrEqual(entry.textLimits[prop])
        }
      }
      expect(node.props).not.toHaveProperty('required')
      expect(node.props).not.toHaveProperty('checked')
    }
    expect(isMarketingConsentFieldName(MARKETING_CONSENT_FORM_FIELD.fieldName)).toBe(true)
    // The form field is named as the contact record's own consent field.
    expect(MARKETING_CONSENT_FORM_FIELD.fieldName).toBe(MARKETING_CONSENT_FIELD)
  })

  it('declares one option, and its tick reads as consent', () => {
    const draft = signup()
    expect(draft.fields.at(-1)).toEqual({
      fieldName: MARKETING_CONSENT_FORM_FIELD.fieldName,
      label: MARKETING_CONSENT_FORM_FIELD.options,
      fieldType: 'checkbox',
      options: [AI_FORM_CONSENT_VALUE],
    })
    const form = { consentFieldName: draft.consentFieldName ?? '', fields: draft.fields }
    expect(readFormDeclaredConsent(form, { [MARKETING_CONSENT_FORM_FIELD.fieldName]: AI_FORM_CONSENT_VALUE })).toBe(true)
    expect(readFormDeclaredConsent(form, {})).toBe(false)
  })

  it.each([
    [
      'an all-in-one Form Field',
      {
        id: 'optIn',
        componentId: 'formField',
        props: { fieldName: 'newsletterOptIn', label: 'News', fieldType: 'checkbox', options: 'Yes' },
      },
      ['optIn'],
    ],
    ['a Choice Label holding a Checkbox', tick('optIn', 'Keep me posted', { name: 'subscribe', value: 'Yes' }), ['optIn', 'optInBox']],
    [
      'a Form Control over a Form Label and a Checkbox',
      field('optIn', 'Newsletter', { componentId: 'muiCheckbox', props: { name: 'emailOptIn', value: 'Yes' } }),
      ['optIn', 'optInLabel', 'optInAnswer'],
    ],
  ] as const)('takes the place of a consent box the model drew as %s, frame and all', (_shape, drawn, gone) => {
    const draft = aiFormDraft(
      formOf(field('email', 'Email', { componentId: 'muiInput', props: { name: 'email', type: 'email' } }), drawn as Piece),
      {},
      { formId: 'f-1', name: 'Signup' },
    )
    for (const id of gone) expect([id, draft.nodes[id]]).toEqual([id, undefined])
    expect(draft.nodes['form'].nodes).toEqual(['email', AI_FORM_CONSENT_NODE_ID])
    expect(draft.fields.map((one) => one.fieldName)).toEqual(['email', MARKETING_CONSENT_FORM_FIELD.fieldName])
  })

  it('leaves a question’s other boxes, and its label, where only one of them was a consent box', () => {
    const draft = aiFormDraft(
      formOf(
        field('email', 'Email', { componentId: 'muiInput', props: { name: 'email', type: 'email' } }),
        {
          id: 'contact',
          componentId: 'muiFormControl',
          nodes: [
            { id: 'contactLabel', componentId: 'muiFormLabel', props: { children: 'How should we reach you?' } },
            tick('byPhone', 'By phone', { name: 'contactBy', value: 'Phone' }),
            tick('optIn', 'And send me news', { name: 'subscribe', value: 'Yes' }),
          ],
        },
      ),
      {},
      { formId: 'f-1', name: 'Signup' },
    )
    expect(draft.nodes['contact'].nodes).toEqual(['contactLabel', 'byPhone'])
    expect(draft.nodes['optIn']).toBeUndefined()
    expect(draft.nodes['optInBox']).toBeUndefined()
    expect(draft.fields.map((one) => [one.fieldName, one.label])).toEqual([
      ['email', 'Email'],
      ['contactBy', 'How should we reach you?'],
      [MARKETING_CONSENT_FORM_FIELD.fieldName, MARKETING_CONSENT_FORM_FIELD.options],
    ])
  })
})

describe('the routing', () => {
  it('writes only what the form’s page edits: a lead for a lead, nothing for the Inbox or a list', () => {
    const start = FORMS_MODEL.indexOf('export interface FormRouting')
    const routingKeys = [
      ...FORMS_MODEL.slice(start, FORMS_MODEL.indexOf('\n}', start)).matchAll(/^\s+([A-Za-z]+)\?:/gm),
    ].map((match) => match[1])
    expect(routingKeys.sort()).toEqual(['datasetId', 'lead'])

    const design = formOf(field('email', 'Email', { componentId: 'muiInput', props: { name: 'email', type: 'email' } }))
    const written = AI_FORM_ROUTING_KINDS.map((kind) => [
      kind,
      aiFormDraft(design, { routing: { kind, list: 'Customers' } }, { formId: 'f-1', name: 'Signup' }).routing,
    ])
    expect(written).toEqual([
      ['inbox', null],
      ['list', null],
      ['lead', { lead: true }],
    ])
    // The dataset binding is the one routing key a proposal never writes.
    for (const [, routing] of written) {
      for (const key of Object.keys(routing ?? {})) expect(routingKeys).toContain(key)
    }
  })

  it('offers exactly the routing kinds the step reads', () => {
    const properties = AI_JOB_FORM_TOOL.inputSchema['properties'] as Record<string, any>
    expect(properties['routing'].properties.kind.enum).toEqual([...AI_FORM_ROUTING_KINDS])
  })
})

describe('the tool', () => {
  it('is strict: every object closes its properties and requires each one', () => {
    const visit = (schema: unknown, path: string): void => {
      if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return
      const node = schema as Record<string, unknown>
      if (node['type'] === 'object') {
        expect([path, node['additionalProperties']]).toEqual([path, false])
        expect([path, [...(node['required'] as string[])].sort()]).toEqual([
          path,
          Object.keys(node['properties'] as object).sort(),
        ])
      }
      for (const [name, child] of Object.entries((node['properties'] as object) ?? {})) {
        visit(child, `${path}.${name}`)
      }
      visit(node['items'], `${path}[]`)
      for (const branch of (node['anyOf'] as unknown[]) ?? []) visit(branch, path)
    }
    expect(AI_JOB_FORM_TOOL.strict).toBe(true)
    visit(AI_JOB_FORM_TOOL.inputSchema, 'input')
  })
})
