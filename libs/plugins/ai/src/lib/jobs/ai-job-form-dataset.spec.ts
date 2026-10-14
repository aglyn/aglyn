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

import { formFieldDeclsFromNodes } from '@aglyn/aglyn/app-utils/forms'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { emptyAiSiteInventory } from '../model/ai-site-inventory'
import {
  aiBindFormToDataset,
  aiFormDatasetNote,
  aiFormFieldFitsDataset,
  aiFormFieldKey,
  aiReadFormDataset,
  type AiFormDataset,
} from './ai-job-form-dataset'

/**
 * A form bound to a dataset (AGL-3616): the props the Form element's own
 * binding writes, which the data plugin's record target reads at each
 * submission — the form node's `datasetId` and each answer element's
 * `datasetFieldId`.
 */

/** One node of a design, under its parent. */
const node = (
  $id: string,
  componentId: string,
  parentId: string,
  props: Record<string, unknown>,
  nodes: string[] = [],
) => ({ $id, componentId, parentId, props, nodes })

/**
 * An RSVP built from MUI's separate form elements, as the form job draws one:
 * each field a Form Control over a Form Label and its answer element.
 */
const RSVP: NodesMap = Object.fromEntries(
  [
    { $id: 'form', componentId: 'form', nodes: ['nameField', 'guestsField', 'dietField', 'ratingField', 'consent'], props: { datasetName: 'Old', formId: 'frm1' } },
    node('nameField', 'muiFormControl', 'form', {}, ['nameLabel', 'name']),
    node('nameLabel', 'muiFormLabel', 'nameField', { children: 'Your name' }),
    node('name', 'muiInput', 'nameField', { name: 'attendee' }),
    node('guestsField', 'muiFormControl', 'form', {}, ['guestsLabel', 'guests']),
    node('guestsLabel', 'muiFormLabel', 'guestsField', { children: 'Guests' }),
    node('guests', 'muiSelect', 'guestsField', { name: 'guests' }, ['guests1', 'guests2']),
    node('guests1', 'muiSelectOption', 'guests', { children: '1' }),
    node('guests2', 'muiSelectOption', 'guests', { children: '2' }),
    node('dietField', 'muiFormControl', 'form', {}, ['dietLabel', 'vegetarian', 'vegan']),
    node('dietLabel', 'muiFormLabel', 'dietField', { children: 'Dietary needs' }),
    node('vegetarian', 'muiFormControlLabel', 'dietField', { label: 'Vegetarian' }, ['vegetarianBox']),
    node('vegetarianBox', 'muiCheckbox', 'vegetarian', { name: 'dietaryNeeds', value: 'Vegetarian' }),
    node('vegan', 'muiFormControlLabel', 'dietField', { label: 'Vegan' }, ['veganBox']),
    node('veganBox', 'muiCheckbox', 'vegan', { name: 'dietaryNeeds', value: 'Vegan' }),
    node('ratingField', 'muiFormControl', 'form', {}, ['ratingLabel', 'rating']),
    node('ratingLabel', 'muiFormLabel', 'ratingField', { children: 'Excitement' }),
    node('rating', 'muiRating', 'ratingField', { name: 'excitement', datasetFieldId: 'drawn' }),
    node('consent', 'muiFormControlLabel', 'form', { label: 'Keep me posted' }, ['consentBox']),
    node('consentBox', 'muiCheckbox', 'consent', { name: 'marketingConsent', value: 'Yes' }),
  ].map((one) => [one.$id, one]),
) as unknown as NodesMap

const ATTENDEES: AiFormDataset = {
  id: 'dsAttendees',
  name: 'Attendees',
  fields: [
    { id: 'full_name', name: 'Full name', type: 'text' },
    { id: 'guests', name: 'Guests', type: 'int32' },
    { id: 'dietary_needs', name: 'Dietary needs', type: 'sorted' },
    { id: 'excitement', name: 'Excitement', type: 'int32' },
    { id: 'your_name', name: 'Your name', type: 'text' },
  ],
}

const copy = (nodes: NodesMap): NodesMap => JSON.parse(JSON.stringify(nodes))

describe('matching a form’s fields to a dataset’s', () => {
  it('reads one name however it is spelled', () => {
    expect(aiFormFieldKey('fullName')).toBe(aiFormFieldKey('Full name'))
    expect(aiFormFieldKey('full_name')).toBe(aiFormFieldKey('Full Name'))
    expect(aiFormFieldKey('email')).not.toBe(aiFormFieldKey('Email address'))
  })

  it('reads a name in any language, its accents and all (AGL-3791)', () => {
    expect(aiFormFieldKey('telefono')).toBe(aiFormFieldKey('Teléfono'))
    expect(aiFormFieldKey('correoElectronico')).toBe(aiFormFieldKey('Correo electrónico'))
    expect(aiFormFieldKey('Número de personas')).toBe('numerodepersonas')
    // A name in another script is its own letters, not an empty key every such name shares.
    expect(aiFormFieldKey('Имя')).toBe('имя')
    expect(aiFormFieldKey('Имя')).not.toBe(aiFormFieldKey('Телефон'))
  })

  it('stores any answer in text and only a rating in a number', () => {
    expect(aiFormFieldFitsDataset('checkbox', 'text')).toBe(true)
    expect(aiFormFieldFitsDataset('rating', 'int32')).toBe(true)
    expect(aiFormFieldFitsDataset('select', 'int32')).toBe(false)
    expect(aiFormFieldFitsDataset('checkbox', 'sorted')).toBe(false)
  })
})

describe('binding a form to a dataset', () => {
  it('binds the form and each field the dataset can hold, as the record target reads it', () => {
    const nodes = copy(RSVP)
    const binding = aiBindFormToDataset(nodes, 'form', ATTENDEES)
    // The label matches where the name does not; a select is text, never a number; a list is left alone.
    expect(binding).toEqual({ bound: ['attendee', 'excitement'], unbound: ['Guests', 'Dietary needs'] })
    expect(nodes['form']?.props).toEqual({ formId: 'frm1', datasetId: 'dsAttendees' })
    const map = Object.fromEntries(
      formFieldDeclsFromNodes(nodes as never, 'form').flatMap((field) => (field.datasetFieldId ? [[field.fieldName, field.datasetFieldId]] : [])),
    )
    expect(map).toEqual({ attendee: 'your_name', excitement: 'excitement' })
    expect(formFieldDeclsFromNodes(nodes as never, 'form').find((field) => field.fieldName === 'excitement')?.datasetFieldId).toBe('excitement')
    // The binding is written on the answer element itself, never its frame or label.
    expect((nodes['name']?.props as Record<string, unknown>)['datasetFieldId']).toBe('your_name')
    expect((nodes['nameField']?.props as Record<string, unknown>)['datasetFieldId']).toBeUndefined()
    // The consent field is never a record's.
    expect((nodes['consentBox']?.props as Record<string, unknown>)['datasetFieldId']).toBeUndefined()
  })

  it('binds Checkboxes sharing a name together, as the one answer they are', () => {
    const nodes = copy(RSVP)
    const binding = aiBindFormToDataset(nodes, 'form', {
      ...ATTENDEES,
      fields: [{ id: 'dietary_needs', name: 'Dietary needs', type: 'text' }],
    })
    expect(binding).toEqual({ bound: ['dietaryNeeds'], unbound: ['Your name', 'Guests', 'Excitement'] })
    expect((nodes['vegetarianBox']?.props as Record<string, unknown>)['datasetFieldId']).toBe('dietary_needs')
    expect((nodes['veganBox']?.props as Record<string, unknown>)['datasetFieldId']).toBe('dietary_needs')
    // A binding the model drew is dropped, not kept where nothing matched.
    expect((nodes['rating']?.props as Record<string, unknown>)['datasetFieldId']).toBeUndefined()
  })

  it('takes each dataset field once', () => {
    const nodes = copy(RSVP)
    /** The guests question as a text Input under the label "Your name", submitted as `name`. */
    const textGuests = (design: NodesMap, name: string) => {
      design['guests'] = { ...design['guests'], componentId: 'muiInput', nodes: [], props: { name } } as never
      ;(design['guestsLabel']?.props as Record<string, unknown>)['children'] = 'Your name'
    }
    // A second field labelled "Your name" finds that field taken, and its name before its label.
    textGuests(nodes, 'guestName')
    ;(nodes['name']?.props as Record<string, unknown>)['name'] = 'fullName'
    const binding = aiBindFormToDataset(nodes, 'form', ATTENDEES)
    expect(binding.bound).toEqual(['fullName', 'guestName', 'excitement'])
    const again = copy(RSVP)
    textGuests(again, 'guests')
    expect(aiBindFormToDataset(again, 'form', ATTENDEES).unbound).toContain('Your name')
  })

  it('says what stays in the Inbox', () => {
    expect(aiFormDatasetNote(ATTENDEES, { bound: ['a'], unbound: [] })).toBe('Each submission is also saved as a record of the “Attendees” dataset, in Data.')
    expect(aiFormDatasetNote(ATTENDEES, { bound: [], unbound: ['Guests'] })).toContain('no field for “Guests”, so that answer stays in the Inbox only.')
  })
})

describe('reading the dataset a form writes to', () => {
  const read = jest.fn(async ({ id }: { id: string }) => ({
    id,
    name: 'Attendees',
    versionId: null,
    facts: { fields: [...ATTENDEES.fields, { id: 'slug', name: 'Page address', type: 'text' }], addressField: 'slug' },
  }))
  const writerFor = (() => ({ pluginId: 'data', writer: { read } })) as never
  const PAID = { plan: 'starter', billingStatus: 'active' }
  const inventory = { ...emptyAiSiteInventory('host-1'), datasets: [{ id: 'dsOnSite', name: 'Guests', fields: [] }] }

  it('reads one the job made, or one on the site, without its page address', async () => {
    const made = await aiReadFormDataset({ hostId: 'host-1', id: 'dsAttendees', org: PAID, inventory, madeId: 'dsAttendees' }, { writerFor })
    expect(made?.fields.map((field) => field.id)).toEqual(ATTENDEES.fields.map((field) => field.id))
    expect(await aiReadFormDataset({ hostId: 'host-1', id: 'dsOnSite', org: PAID, inventory }, { writerFor })).not.toBeNull()
  })

  it('reads none on a plan with no data store, of another site, or with no writer', async () => {
    expect(await aiReadFormDataset({ hostId: 'host-1', id: 'dsAttendees', org: {}, inventory, madeId: 'dsAttendees' }, { writerFor })).toBeNull()
    expect(await aiReadFormDataset({ hostId: 'host-1', id: 'dsElsewhere', org: PAID, inventory }, { writerFor })).toBeNull()
    expect(await aiReadFormDataset({ hostId: 'host-1', id: 'dsOnSite', org: PAID, inventory }, { writerFor: (() => null) as never })).toBeNull()
    expect(await aiReadFormDataset({ hostId: 'host-1', id: null, org: PAID, inventory }, { writerFor })).toBeNull()
  })
})
