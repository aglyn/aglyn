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

import type { AglynNodeSchema } from '../foundation/definitions/components.types'
import {
  formFieldDataOwner,
  formFieldDeclsFromNodes,
  formSendsConfirmation,
  FORM_PLUGIN_ANSWER_ELEMENTS,
  isFormInputNode,
  readFormRequest,
} from './forms'
import {
  checkVisitorUploadRequest,
  checkVisitorUploadSelection,
  describeVisitorUploadTypes,
  readVisitorUploadKinds,
  visitorUploadAccept,
  visitorUploadTypeInKinds,
} from './visitor-upload'

/**
 * A request form's fields and settings (AGL-4098): the File upload and the
 * Product and options fields declared like any input, a form's request and
 * its confirmation default, and the kinds of file a field can take.
 */

const node = (id: string, componentId: string, props: Record<string, unknown>, nodes: string[] = [], parentId?: string) =>
  ({ $id: id, componentId, props, nodes, ...(parentId ? { parentId } : {}) }) as unknown as AglynNodeSchema

describe('the answer elements other plugins draw in a form', () => {
  const nodes = {
    form: node('form', 'form', {}, ['name', 'files', 'product']),
    name: node('name', 'muiInput', { name: 'name' }, [], 'form'),
    files: node('files', 'formFileUpload', { name: 'artwork', label: 'Logo or artwork', required: true, kinds: 'images,design', maxFiles: '3' }, [], 'form'),
    product: node('product', 'product-options-field', { name: 'product', label: 'What should we price?' }, [], 'form'),
  }

  it('declares a File upload with its kinds and number, and a product field by its own label', () => {
    expect(isFormInputNode(nodes.files)).toBe(true)
    expect(isFormInputNode(nodes.product)).toBe(true)
    expect(formFieldDeclsFromNodes(nodes, 'form')).toEqual([
      { fieldName: 'name', fieldType: 'text' },
      {
        fieldName: 'artwork',
        fieldType: 'file',
        label: 'Logo or artwork',
        required: true,
        fileKinds: ['images', 'design'],
        maxFiles: 3,
      },
      { fieldName: 'product', fieldType: 'product', label: 'What should we price?' },
    ])
  })

  it('takes every kind and ten files when the author set neither, and never more than ten', () => {
    const open = { ...nodes, files: node('files', 'formFileUpload', { name: 'artwork', maxFiles: '50' }, [], 'form') }
    expect(formFieldDeclsFromNodes(open, 'form')[1]).toMatchObject({
      fileKinds: ['images', 'pdf', 'design'],
      maxFiles: 10,
    })
  })

  it('names exactly the two elements, with the types they declare', () => {
    expect(FORM_PLUGIN_ANSWER_ELEMENTS).toEqual({ formFileUpload: 'file', 'product-options-field': 'product' })
  })
})

describe('a field’s machine value beside its answer', () => {
  it('belongs to the field it is named after', () => {
    expect(formFieldDataOwner('product__data')).toBe('product')
    expect(formFieldDataOwner('product')).toBeNull()
    expect(formFieldDataOwner('__data')).toBeNull()
    expect(formFieldDataOwner('____data')).toBeNull()
  })
})

describe('what a form asks for, and whether it confirms', () => {
  it('reads a quote request off the stored form, and nothing else', () => {
    expect(readFormRequest({ request: { kind: 'quote' } })).toEqual({ kind: 'quote' })
    expect(readFormRequest({ request: { kind: 'refund' } })).toBeNull()
    expect(readFormRequest({})).toBeNull()
    expect(readFormRequest(null)).toBeNull()
  })

  it('confirms a request by default and an ordinary form only when set, so no form that existed starts emailing', () => {
    expect(formSendsConfirmation({})).toBe(false)
    expect(formSendsConfirmation({ request: { kind: 'quote' } })).toBe(true)
    expect(formSendsConfirmation({ request: { kind: 'quote' }, confirmationEmail: false })).toBe(false)
    expect(formSendsConfirmation({ confirmationEmail: true })).toBe(true)
  })
})

describe('the kinds of file a field takes', () => {
  it('reads a stored list, and every kind for none', () => {
    expect(readVisitorUploadKinds('pdf,images')).toEqual(['images', 'pdf'])
    expect(readVisitorUploadKinds(['design'])).toEqual(['design'])
    expect(readVisitorUploadKinds('')).toEqual(['images', 'pdf', 'design'])
    expect(readVisitorUploadKinds('nonsense')).toEqual(['images', 'pdf', 'design'])
  })

  it('takes only the types of the kinds named, and says which in its refusal', () => {
    expect(visitorUploadTypeInKinds('application/pdf', ['pdf'])).toBe(true)
    expect(visitorUploadTypeInKinds('image/png', ['pdf'])).toBe(false)
    expect(visitorUploadTypeInKinds('image/png')).toBe(true)
    expect(describeVisitorUploadTypes(['pdf'])).toBe('PDF')
    const refused = checkVisitorUploadRequest({ name: 'logo.png', contentType: 'image/png', size: 10 }, { kinds: ['pdf'] })
    expect(refused).toEqual({ ok: false, code: 'type', error: "logo.png can't be sent. Send a PDF file." })
    expect(checkVisitorUploadRequest({ name: 'brief.pdf', contentType: 'application/pdf', size: 10 }, { kinds: ['pdf'] })).toMatchObject({ ok: true })
  })

  it('offers the picker only those kinds, and holds a selection to the field’s number', () => {
    expect(visitorUploadAccept(['pdf'])).toBe('.pdf,application/pdf')
    expect(checkVisitorUploadSelection([{ name: 'a.pdf', type: 'application/pdf', size: 1 }], 1, 1, ['pdf'])).toBe('Send one file.')
    expect(checkVisitorUploadSelection([{ name: 'a.png', type: 'image/png', size: 1 }], 0, 3, ['pdf'])).toMatch(/Send a PDF file/)
  })
})
