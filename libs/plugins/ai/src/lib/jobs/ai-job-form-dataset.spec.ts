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
 * submission — the form node's `datasetId` and each field's `datasetFieldId`.
 */

const RSVP: NodesMap = {
  form: { $id: 'form', componentId: 'form', nodes: ['name', 'guests', 'diet', 'rating', 'consent'], props: { datasetName: 'Old', formId: 'frm1' } },
  name: { $id: 'name', componentId: 'formField', parentId: 'form', nodes: [], props: { fieldName: 'attendee', label: 'Your name' } },
  guests: { $id: 'guests', componentId: 'formField', parentId: 'form', nodes: [], props: { fieldName: 'guests', label: 'Guests', fieldType: 'select', options: '1\n2\n3' } },
  diet: { $id: 'diet', componentId: 'formField', parentId: 'form', nodes: [], props: { fieldName: 'dietaryNeeds', label: 'Dietary needs', fieldType: 'checkbox', options: 'Vegetarian\nVegan' } },
  rating: { $id: 'rating', componentId: 'formField', parentId: 'form', nodes: [], props: { fieldName: 'excitement', label: 'Excitement', fieldType: 'rating', datasetFieldId: 'drawn' } },
  consent: { $id: 'consent', componentId: 'formField', parentId: 'form', nodes: [], props: { fieldName: 'marketingConsent', label: 'Keep me posted', fieldType: 'checkbox' } },
} as unknown as NodesMap

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
    // The consent field is never a record's.
    expect((nodes['consent']?.props as Record<string, unknown>)['datasetFieldId']).toBeUndefined()
  })

  it('takes each dataset field once', () => {
    const nodes = copy(RSVP)
    // A second field labelled "Your name" finds that field taken, and its name before its label.
    ;(nodes['guests']?.props as Record<string, unknown>)['fieldName'] = 'guestName'
    ;(nodes['guests']?.props as Record<string, unknown>)['label'] = 'Your name'
    ;(nodes['guests']?.props as Record<string, unknown>)['fieldType'] = 'text'
    ;(nodes['name']?.props as Record<string, unknown>)['fieldName'] = 'fullName'
    const binding = aiBindFormToDataset(nodes, 'form', ATTENDEES)
    expect(binding.bound).toEqual(['fullName', 'guestName', 'excitement'])
    const again = copy(RSVP)
    ;(again['guests']?.props as Record<string, unknown>)['label'] = 'Your name'
    ;(again['guests']?.props as Record<string, unknown>)['fieldType'] = 'text'
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
