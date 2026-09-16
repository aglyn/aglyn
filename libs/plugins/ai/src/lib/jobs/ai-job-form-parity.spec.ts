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
 *  - THE FIELD SETTINGS. The palette props a generated Form and Form Field may
 *    carry are the forms plugin's attributes, less the record pickers the
 *    palette generator leaves off; the field types are the declaration's
 *    `FormFieldType`, and each one survives the declaration reader.
 *  - THE CONSENT FIELD. The editor's Marketing consent preset places
 *    `MARKETING_CONSENT_FORM_FIELD`, a generated form carries exactly it, its props
 *    are palette props, its one option survives the Options split as one, and
 *    its ticked value is read as consent.
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
  formFieldDeclsFromNodes,
  isMarketingConsentFieldName,
  MARKETING_CONSENT_FORM_FIELD,
  readFormDeclaredConsent,
} from '@aglyn/aglyn/app-utils/forms'
import { MARKETING_CONSENT_FIELD } from '@aglyn/aglyn/app-utils/marketing-consent'
import { AI_PALETTE, AI_SURFACES } from '../runtime/ai-palette.generated'
import {
  AI_FORM_CONSENT_NODE_ID,
  AI_FORM_ROUTING_KINDS,
  AI_JOB_FORM_TOOL,
  aiFormDraft,
} from './ai-job-form-step'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const FORMS_PLUGIN = readFileSync(
  join(REPO_ROOT, 'libs/plugins/forms/src/lib/components/form.tsx'),
  'utf8',
)
const FORMS_MODEL = readFileSync(join(REPO_ROOT, 'libs/aglyn/src/lib/app-utils/forms.ts'), 'utf8')

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

/** A design with one field of each given props, under a form node. */
function formWith(...fields: Array<Record<string, unknown>>) {
  const nodes: Record<string, any> = {
    form: { $id: 'form', componentId: 'form', props: {}, nodes: fields.map((_, index) => `field-${index}`) },
  }
  fields.forEach((props, index) => {
    nodes[`field-${index}`] = {
      $id: `field-${index}`,
      componentId: 'formField',
      parentId: 'form',
      props,
      nodes: [],
    }
  })
  return { rootId: 'form', nodes }
}

describe('the field settings', () => {
  it('lets a generated Form Field carry exactly the settings the Forms editor offers, less the record pickers', () => {
    const attributes = attributesOf('formFieldSchema')
    expect(attributes.map((attribute) => attribute.name)).toContain('fieldType')
    expect(Object.keys(AI_PALETTE['formField'].propsSchema.properties).sort()).toEqual(
      attributes
        .filter((attribute) => !RECORD_PICKERS.has(attribute.component))
        .map((attribute) => attribute.name)
        .sort(),
    )
  })

  it('lets a generated Form carry exactly its settings, less the pickers, and stamps the one binding itself', () => {
    const attributes = attributesOf('formSchema')
    expect(Object.keys(AI_PALETTE['form'].propsSchema.properties).sort()).toEqual(
      attributes
        .filter((attribute) => !RECORD_PICKERS.has(attribute.component))
        .map((attribute) => attribute.name)
        .sort(),
    )
    const draft = aiFormDraft(formWith({ fieldName: 'name', label: 'Name' }), {}, { formId: 'f-1', name: 'Contact' })
    expect(draft.nodes['form'].props).toMatchObject({ formId: 'f-1', formName: 'Contact' })
    expect(attributes.map((attribute) => attribute.name)).toEqual(expect.arrayContaining(['formId', 'formName']))
    // A generated tree is the Form and its Form Fields, and nothing else.
    expect(AI_SURFACES.form).toEqual({ root: 'form', allow: ['form', 'formField'] })
  })

  it('offers the declaration’s field types, and every one of them survives the declaration reader', () => {
    const union = FORMS_MODEL.slice(
      FORMS_MODEL.indexOf('export type FormFieldType'),
      FORMS_MODEL.indexOf('\n\n', FORMS_MODEL.indexOf('export type FormFieldType')),
    )
    const declared = [...union.matchAll(/'([a-z]+)'/g)].map((match) => match[1])
    const offered = AI_PALETTE['formField'].propsSchema.properties['fieldType'].enum ?? []
    expect([...offered].sort()).toEqual([...declared].sort())
    for (const fieldType of offered) {
      const { nodes } = formWith({ fieldName: 'answer', fieldType })
      expect([fieldType, formFieldDeclsFromNodes(nodes, 'form')[0]?.fieldType]).toEqual([fieldType, fieldType])
    }
  })
})

describe('the consent field', () => {
  it('is what the editor’s Marketing consent preset places, and what a generated form carries whole', () => {
    const preset = presetNamed('Marketing consent')
    expect(preset).toContain('componentId: FORM_FIELD_ID')
    expect(preset).toMatch(/props: \{ \.\.\.Aglyn\.MARKETING_CONSENT_FORM_FIELD \}/)
    expect(AI_PALETTE['formField'].presets).toContain('Marketing consent')
    const draft = aiFormDraft(
      formWith({ fieldName: 'email', label: 'Email', fieldType: 'email' }),
      {},
      { formId: 'f-1', name: 'Signup' },
    )
    expect(draft.nodes[AI_FORM_CONSENT_NODE_ID].props).toEqual({ ...MARKETING_CONSENT_FORM_FIELD })
    expect(draft.consentFieldName).toBe(MARKETING_CONSENT_FORM_FIELD.fieldName)
  })

  it('holds to the palette: known props, a known type, text within its limits', () => {
    const entry = AI_PALETTE['formField']
    for (const [prop, value] of Object.entries(MARKETING_CONSENT_FORM_FIELD)) {
      const schema = entry.propsSchema.properties[prop]
      expect([prop, Boolean(schema)]).toEqual([prop, true])
      if (schema?.enum) expect(schema.enum).toContain(value)
      if (schema?.type === 'boolean') expect(typeof value).toBe('boolean')
      if (typeof value === 'string' && entry.textLimits[prop]) {
        expect(value.length).toBeLessThanOrEqual(entry.textLimits[prop])
      }
    }
    expect(isMarketingConsentFieldName(MARKETING_CONSENT_FORM_FIELD.fieldName)).toBe(true)
    // The form field is named as the contact record's own consent field.
    expect(MARKETING_CONSENT_FORM_FIELD.fieldName).toBe(MARKETING_CONSENT_FIELD)
  })

  it('keeps its one option through the Options split, and its tick reads as consent', () => {
    const { nodes } = formWith({ ...MARKETING_CONSENT_FORM_FIELD })
    const declared = formFieldDeclsFromNodes(nodes, 'form')
    expect(declared).toEqual([
      {
        fieldName: MARKETING_CONSENT_FORM_FIELD.fieldName,
        label: MARKETING_CONSENT_FORM_FIELD.label,
        fieldType: 'checkbox',
        options: [MARKETING_CONSENT_FORM_FIELD.options],
      },
    ])
    const form = { consentFieldName: MARKETING_CONSENT_FORM_FIELD.fieldName, fields: declared }
    expect(
      readFormDeclaredConsent(form, { [MARKETING_CONSENT_FORM_FIELD.fieldName]: MARKETING_CONSENT_FORM_FIELD.options }),
    ).toBe(true)
    expect(readFormDeclaredConsent(form, {})).toBe(false)
  })
})

describe('the routing', () => {
  it('writes only what the form’s page edits: a lead for a lead, nothing for the Inbox or a list', () => {
    const start = FORMS_MODEL.indexOf('export interface FormRouting')
    const routingKeys = [
      ...FORMS_MODEL.slice(start, FORMS_MODEL.indexOf('\n}', start)).matchAll(/^\s+([A-Za-z]+)\?:/gm),
    ].map((match) => match[1])
    expect(routingKeys.sort()).toEqual(['datasetId', 'lead'])

    const design = formWith({ fieldName: 'email', label: 'Email', fieldType: 'email' })
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
