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
 * The binding the server derives must be the binding the browser used to send
 * (AGL-2773), or moving the decision server-side moves existing forms'
 * records somewhere else. So each case states what the page's form submitted
 * before: `datasetId` and `datasetName` off the Form node, and one
 * `fieldName → datasetFieldId` entry per mapped field, the last field under a
 * name winning, exactly as the `FormData` loop built it.
 */

import {
  FORM_DATASET_BINDING_MAX_FIELDS,
  formDatasetBindingOf,
  formDatasetBindingsOf,
} from './form-dataset-binding'

const ROOT = '_@_'

const form = (props: Record<string, unknown>, children: string[]) => ({
  $id: 'contact',
  componentId: 'form',
  parentId: ROOT,
  props,
  nodes: children,
})

const field = (id: string, parentId: string, props: Record<string, unknown>) => ({
  $id: id,
  componentId: 'formField',
  parentId,
  props,
})

describe('formDatasetBindingOf', () => {
  it('reads the dataset id, the legacy name and every mapped field', () => {
    const nodes = {
      contact: form({ datasetId: 'leads', datasetName: 'Leads' }, ['row']),
      // Fields need not be direct children: the form rides the DOM.
      row: { $id: 'row', componentId: 'muiStack', nodes: ['email', 'note'] },
      email: field('email', 'row', {
        fieldName: 'email',
        datasetFieldId: 'contact_email',
      }),
      note: field('note', 'row', { fieldName: 'message' }),
    } as any

    expect(formDatasetBindingOf(nodes, 'contact')).toEqual({
      datasetId: 'leads',
      datasetName: 'Leads',
      fieldMap: { email: 'contact_email' },
    })
  })

  it('keys an unnamed field as the browser does, and lets the later field win', () => {
    const nodes = {
      contact: form({ datasetId: 'leads' }, ['a', 'b', 'c']),
      a: field('a', 'contact', { datasetFieldId: 'first' }),
      b: field('b', 'contact', { fieldName: 'stars', datasetFieldId: 'old' }),
      c: field('c', 'contact', { fieldName: 'stars', datasetFieldId: 'rating' }),
    } as any

    expect(formDatasetBindingOf(nodes, 'contact')?.fieldMap).toEqual({
      field: 'first',
      stars: 'rating',
    })
  })

  it('declares nothing for a form with no dataset', () => {
    const nodes = {
      contact: form({ formName: 'Contact', datasetId: '  ' }, ['a']),
      a: field('a', 'contact', { fieldName: 'email', datasetFieldId: 'x' }),
    } as any

    expect(formDatasetBindingOf(nodes, 'contact')).toBeNull()
  })

  it('reads only a form node', () => {
    const nodes = {
      contact: { $id: 'contact', componentId: 'muiStack', props: { datasetId: 'leads' } },
    } as any

    expect(formDatasetBindingOf(nodes, 'contact')).toBeNull()
  })

  it('names no more fields than a submission may carry', () => {
    const count = FORM_DATASET_BINDING_MAX_FIELDS + 5
    const ids = Array.from({ length: count }, (_, index) => `f${index}`)
    const nodes = {
      contact: form({ datasetId: 'leads' }, ids),
      ...Object.fromEntries(
        ids.map((id) => [
          id,
          field(id, 'contact', { fieldName: id, datasetFieldId: `d_${id}` }),
        ]),
      ),
    } as any

    expect(
      Object.keys(formDatasetBindingOf(nodes, 'contact')?.fieldMap ?? {}),
    ).toHaveLength(FORM_DATASET_BINDING_MAX_FIELDS)
  })
})

describe('formDatasetBindingsOf', () => {
  it('finds every bound form in a composed tree and skips the unbound ones', () => {
    const nodes = {
      [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['contact', 'newsletter'] },
      contact: form({ datasetId: 'leads' }, []),
      newsletter: { ...form({ formName: 'Newsletter' }, []), $id: 'newsletter' },
    } as any

    expect(formDatasetBindingsOf(nodes)).toEqual([
      { nodeId: 'contact', binding: { datasetId: 'leads', fieldMap: {} } },
    ])
  })
})
