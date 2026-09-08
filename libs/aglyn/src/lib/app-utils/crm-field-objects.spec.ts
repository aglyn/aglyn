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
 * Custom fields on every object (AGL-2661): the one reader of a
 * definition's `object`, and the click-to-call href.
 *
 * The reader has to answer `contact` for a definition that predates the
 * key — every definition ever written before companies and deals could
 * carry fields — and for a value no reader understands, because both sit
 * on contacts. The href has to refuse anything a dialer could not ring.
 */

import {
  CRM_FIELD_OBJECT_LABELS,
  CRM_FIELD_OBJECTS,
  crmTelHref,
  fieldDefinitionObject,
  isCrmFieldObject,
} from './crm'

describe('fieldDefinitionObject (AGL-2661)', () => {
  it('reads an absent object as contact — no backfill needed', () => {
    expect(fieldDefinitionObject({})).toBe('contact')
    expect(fieldDefinitionObject({ object: undefined })).toBe('contact')
    expect(fieldDefinitionObject(null)).toBe('contact')
    expect(fieldDefinitionObject(undefined)).toBe('contact')
  })

  it('reads a stored object back, and a stranger as contact', () => {
    expect(fieldDefinitionObject({ object: 'company' })).toBe('company')
    expect(fieldDefinitionObject({ object: 'deal' })).toBe('deal')
    expect(fieldDefinitionObject({ object: 'contact' })).toBe('contact')
    expect(fieldDefinitionObject({ object: 'lead' as never })).toBe('contact')
    expect(fieldDefinitionObject({ object: 42 as never })).toBe('contact')
  })

  it('names every object exactly once, with a label', () => {
    expect([...CRM_FIELD_OBJECTS]).toEqual(['contact', 'company', 'deal'])
    for (const object of CRM_FIELD_OBJECTS) {
      expect(isCrmFieldObject(object)).toBe(true)
      expect(CRM_FIELD_OBJECT_LABELS[object]).toEqual(expect.any(String))
    }
    expect(isCrmFieldObject('lead')).toBe(false)
    expect(isCrmFieldObject('')).toBe(false)
  })
})

describe('crmTelHref (AGL-2661)', () => {
  it('turns a stored E.164 number into a tel: link', () => {
    expect(crmTelHref('+15125550123')).toBe('tel:+15125550123')
  })

  it('drops the punctuation a pre-normalization value may carry', () => {
    expect(crmTelHref('+1 (512) 555-0123')).toBe('tel:+15125550123')
    expect(crmTelHref('512.555.0123')).toBe('tel:5125550123')
  })

  it('refuses what a dialer could not ring', () => {
    expect(crmTelHref('')).toBeNull()
    expect(crmTelHref('   ')).toBeNull()
    expect(crmTelHref(undefined)).toBeNull()
    expect(crmTelHref(null)).toBeNull()
    expect(crmTelHref('call me')).toBeNull()
    expect(crmTelHref('+1 512 555 0123 x44')).toBeNull()
    expect(crmTelHref('12')).toBeNull()
  })
})
