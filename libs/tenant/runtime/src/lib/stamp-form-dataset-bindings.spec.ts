/**
 * @jest-environment node
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
 * The binding a published page signs is the binding its form declares
 * (AGL-2773), read off the tree the page ships.
 *
 * The case that matters most is the placed form. A form placed from an entity
 * keeps the PAGE's own props — its `datasetId` — while its fields come from the
 * entity's design, and that combination is what the browser submitted before
 * the route stopped trusting it. Signing either side alone would move a live
 * form's records.
 */

import { verifyFormDatasetBinding } from '@aglyn/tenant-data-admin/server/form-dataset-binding-token'
import {
  FORM_DATASET_BINDING_PROP,
  stampFormDatasetBindings,
} from './stamp-form-dataset-bindings'

const SITE = 'site-1'
const ROOT = '_@_'

const secret = process.env['TOKEN_SIGNING_SECRET']

beforeEach(() => {
  process.env['TOKEN_SIGNING_SECRET'] = 'test-signing-secret'
})
afterAll(() => {
  if (secret === undefined) delete process.env['TOKEN_SIGNING_SECRET']
  else process.env['TOKEN_SIGNING_SECRET'] = secret
})

/** A placed form as compose leaves it: the page's node, the entity's fields. */
const composedPlacedForm = () => ({
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['contact', 'copy'] },
  contact: {
    $id: 'contact',
    componentId: 'form',
    parentId: ROOT,
    props: { formId: 'contact-form', datasetId: 'leads' },
    nodes: ['cmp__contact__f-email'],
  },
  'cmp__contact__f-email': {
    $id: 'cmp__contact__f-email',
    componentId: 'formField',
    parentId: 'contact',
    props: { fieldName: 'email', datasetFieldId: 'contact_email' },
  },
  copy: {
    $id: 'copy',
    componentId: 'muiTypography',
    parentId: ROOT,
    props: { children: 'Write to us' },
  },
})

const tokenOn = (nodes: Record<string, any>, id: string) =>
  nodes[id]?.props?.[FORM_DATASET_BINDING_PROP]

describe('stampFormDatasetBindings', () => {
  it('signs a placed form as it renders: the page’s dataset, the entity’s fields', () => {
    const stamped = stampFormDatasetBindings(composedPlacedForm(), SITE)

    expect(verifyFormDatasetBinding(SITE, tokenOn(stamped, 'contact'))).toEqual(
      { datasetId: 'leads', fieldMap: { email: 'contact_email' } },
    )
  })

  it('signs for the site that rendered the page and no other', () => {
    const stamped = stampFormDatasetBindings(composedPlacedForm(), SITE)

    expect(
      verifyFormDatasetBinding('another-site', tokenOn(stamped, 'contact')),
    ).toBeNull()
  })

  it('leaves a form with no dataset, and the tree around it, untouched', () => {
    const nodes = composedPlacedForm()
    delete (nodes.contact.props as Record<string, unknown>)['datasetId']

    const stamped = stampFormDatasetBindings(nodes, SITE)

    expect(stamped).toBe(nodes)
    expect(tokenOn(stamped, 'contact')).toBeUndefined()
  })

  it('never mutates the tree it was given', () => {
    const nodes = composedPlacedForm()
    const before = JSON.parse(JSON.stringify(nodes))

    stampFormDatasetBindings(nodes, SITE)

    expect(nodes).toEqual(before)
  })

  it('renders an unsigned tree, not a failed page, when no secret is configured', () => {
    delete process.env['TOKEN_SIGNING_SECRET']
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})
    const nodes = composedPlacedForm()

    let stamped: Record<string, any> = {}
    expect(() => {
      stamped = stampFormDatasetBindings(nodes, SITE)
    }).not.toThrow()

    expect(stamped).toBe(nodes)
    expect(tokenOn(stamped, 'contact')).toBeUndefined()
    error.mockRestore()
  })
})
