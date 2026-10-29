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

import { FORM_FIELD_DATA_SUFFIX } from '@aglyn/aglyn/app-utils/forms'
import {
  formFileRefsFromInputs,
  formFileInputValue,
  isFormUploadKey,
  mintFormUploadKey,
  parseFormFileRefs,
  readFormSubmissionFiles,
  splitFormFieldData,
} from './form-request'

/** The parts a request form sends (AGL-4098), as the browser posts them and the route reads them. */
describe('a request form’s parts', () => {
  it('mints a pending key nobody guesses, in the shape the route takes', () => {
    const key = mintFormUploadKey((bytes) => bytes.fill(171))
    expect(key).toBe('ab'.repeat(16))
    expect(isFormUploadKey(key)).toBe(true)
    expect(isFormUploadKey(mintFormUploadKey())).toBe(true)
    expect(isFormUploadKey('../x')).toBe(false)
  })

  it('posts each kept file as field:id and reads them back', () => {
    expect(formFileRefsFromInputs([formFileInputValue('artwork', 'f1'), formFileInputValue('a:b', 'f2'), 'junk'])).toEqual([
      { field: 'artwork', id: 'f1' },
      { field: 'a:b', id: 'f2' },
    ])
  })

  it('reads the files a body names: shape only, no repeats, at most ten', () => {
    const key = 'c'.repeat(32)
    expect(parseFormFileRefs(undefined)).toBeNull()
    expect(parseFormFileRefs({ key, refs: [] })).toBeNull()
    expect(parseFormFileRefs({ key, refs: [{ field: 'a', id: 'f1' }, { field: 'a', id: 'f1' }] })).toEqual({
      key,
      refs: [{ field: 'a', id: 'f1' }],
    })
    expect(parseFormFileRefs({ key: 'short', refs: [{ field: 'a', id: 'f1' }] })).toHaveProperty('error')
    expect(parseFormFileRefs({ key, refs: [{ field: 'a', id: '../f1' }] })).toHaveProperty('error')
    expect(
      parseFormFileRefs({ key, refs: Array.from({ length: 11 }, (_, index) => ({ field: 'a', id: `f${index}` })) }),
    ).toEqual({ error: 'A form can send up to 10 files.' })
  })

  it('keeps a field’s machine value apart from the answers a person reads', () => {
    expect(
      splitFormFieldData({ name: 'Jane', product: 'Banner — Matte', [`product${FORM_FIELD_DATA_SUFFIX}`]: '{"productId":"p1"}' }),
    ).toEqual({ answers: { name: 'Jane', product: 'Banner — Matte' }, fieldData: { product: '{"productId":"p1"}' } })
  })

  it('reads a stored submission’s files defensively', () => {
    expect(readFormSubmissionFiles([{ id: 'f1', name: 'a.png', field: 'x', contentType: 'image/png', size: 3 }, { id: '../x', name: 'b' }, 'junk'])).toEqual([
      { id: 'f1', field: 'x', name: 'a.png', contentType: 'image/png', size: 3, uploadedAtMs: 0 },
    ])
    expect(readFormSubmissionFiles(null)).toEqual([])
  })
})
