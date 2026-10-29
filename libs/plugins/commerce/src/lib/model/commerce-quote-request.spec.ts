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

import { variantForOptions } from '../components/product-options-field-body'
import { formFieldDataKey } from './commerce-product-field'
import {
  encodeProductFieldValue,
  parseProductFieldValue,
  productFieldLabel,
  quoteLinesFromFieldData,
  quoteStartFromRequest,
  readQuoteRequestFacts,
} from './commerce-quote-request'

/**
 * A quote request's parts as this plugin reads them (AGL-4098): what the
 * Product and options field posts, a request's facts from the forms plugin's
 * reader, and the start a quote takes from them.
 */

describe('the Product and options field’s value', () => {
  it('round-trips the product, its variant and options, and posts beside its answer', () => {
    const value = { productId: 'banner', variantId: 'v-3x6-matte', options: { Size: '3 × 6 ft', Finish: 'Matte' } }
    expect(parseProductFieldValue(encodeProductFieldValue(value))).toEqual(value)
    expect(formFieldDataKey('product')).toBe('product__data')
    expect(productFieldLabel('Vinyl banner', value.options)).toBe('Vinyl banner — 3 × 6 ft / Matte')
    expect(productFieldLabel('Sticker', {})).toBe('Sticker')
  })

  it('reads nothing from a value that is not one', () => {
    expect(parseProductFieldValue('')).toBeNull()
    expect(parseProductFieldValue('not json')).toBeNull()
    expect(parseProductFieldValue('[1,2]')).toBeNull()
    expect(parseProductFieldValue('{"variantId":"v"}')).toBeNull()
    expect(parseProductFieldValue('{"productId":"a/b"}')).toBeNull()
    expect(parseProductFieldValue(42)).toBeNull()
    expect(parseProductFieldValue('x'.repeat(5000))).toBeNull()
  })

  it('keeps only well-formed options and add-ons, and drops a variant id that cannot be one', () => {
    expect(
      parseProductFieldValue(
        JSON.stringify({ productId: 'p1', variantId: 'a/b', options: { Size: 'L', Empty: '', Bad: 3 }, modifiers: [{ groupId: 'g', optionId: 'o' }, { groupId: '' }] }),
      ),
    ).toEqual({ productId: 'p1', options: { Size: 'L' }, modifiers: [{ groupId: 'g', optionId: 'o' }] })
  })

  it('becomes one product line per field on the quote', () => {
    expect(
      quoteLinesFromFieldData({
        product: encodeProductFieldValue({ productId: 'p1', variantId: 'v1' }),
        notAProduct: 'hello',
      }),
    ).toEqual([{ kind: 'catalog', productId: 'p1', variantId: 'v1', quantity: 1 }])
  })

  it('finds the variant the picked options make, and none for a combination not offered', () => {
    const detail = {
      options: [
        { name: 'Size', values: ['S', 'L'] },
        { name: 'Finish', values: ['Matte', 'Gloss'] },
      ],
      variants: [
        { id: 's-matte', options: { Size: 'S', Finish: 'Matte' } },
        { id: 'l-gloss', options: { Size: 'L', Finish: 'Gloss' } },
      ],
    }
    expect(variantForOptions(detail, { Size: 'L', Finish: 'Gloss' })).toBe('l-gloss')
    expect(variantForOptions(detail, { Size: 'L', Finish: 'Matte' })).toBeNull()
    expect(variantForOptions(detail, { Size: 'L' })).toBeNull()
    expect(variantForOptions({ options: [], variants: [{ id: 'default' }] }, {})).toBe('default')
  })
})

describe('a request’s facts, and the quote started from them', () => {
  const THREAD = { messageId: '<form.1@mail.test>', references: ['<form.1@mail.test>'], subject: 'We got your quote request — Acme' }
  const RAW = {
    record: 'formSubmission',
    hostId: 'site1',
    formName: 'Request a quote',
    createdAtMs: 7,
    request: { kind: 'quote' },
    person: { name: 'Jane Doe', email: 'jane@example.com', phone: '555', company: '' },
    message: 'Two banners.',
    fieldData: { product: encodeProductFieldValue({ productId: 'p1', options: { Finish: 'Matte' } }) },
    files: [
      { id: 'f1', name: 'logo.ai', contentType: 'application/illustrator', size: 9, path: 'hosts/site1/private/uploads/form-file/s1/f1' },
      { id: 'f2', name: 'outside.ai', contentType: 'application/illustrator', size: 9, path: 'elsewhere/f2' },
    ],
    emailThread: THREAD,
  }

  it('reads the facts defensively: only a submission, only files kept under a site', () => {
    expect(readQuoteRequestFacts({ record: 'contact' })).toBeNull()
    const facts = readQuoteRequestFacts(RAW)
    expect(facts?.files.map((file) => file.id)).toEqual(['f1'])
    expect(facts?.emailThread).toEqual(THREAD)
    expect(facts?.requestKind).toBe('quote')
  })

  it('prefills the customer, the product line and the notes, and carries the request, its files and its conversation', () => {
    const facts = readQuoteRequestFacts(RAW)
    if (!facts) throw new Error('no facts')
    expect(quoteStartFromRequest('s1', facts)).toEqual({
      prefill: {
        customer: { name: 'Jane Doe', email: 'jane@example.com', phone: '555' },
        lines: [{ kind: 'catalog', productId: 'p1', quantity: 1 }],
        notes: 'Two banners.',
      },
      request: { submissionId: 's1', formName: 'Request a quote', receivedAtMs: 7 },
      files: [{ id: 'f1', name: 'logo.ai', contentType: 'application/illustrator', size: 9, path: 'hosts/site1/private/uploads/form-file/s1/f1' }],
      emailThread: THREAD,
    })
  })

  it('has no conversation to reply into when the request sent no confirmation', () => {
    const facts = readQuoteRequestFacts({ ...RAW, emailThread: null })
    expect(facts && quoteStartFromRequest('s1', facts).emailThread).toBeNull()
  })
})
