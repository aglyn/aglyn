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

import {
  IMAGE_UPLOAD_TYPES,
  isImageUploadContentType,
  normalizeImageContentType,
} from './image-upload-types'
import { inspectUploadBytes } from './upload-inspection'

const PNG_HEADER = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
])

describe('isImageUploadContentType', () => {
  it('accepts the formats a browser actually produces', () => {
    for (const type of IMAGE_UPLOAD_TYPES) {
      expect(isImageUploadContentType(type)).toBe(true)
    }
  })

  it('refuses an image label nothing recognises', () => {
    // The bypass this replaced: `image/*` made all three of the entitlement,
    // the ceiling and the signature check answer for a made-up format.
    expect(isImageUploadContentType('image/x-anything')).toBe(false)
    expect(isImageUploadContentType('image/')).toBe(false)
    expect(isImageUploadContentType('image/vnd.adobe.photoshop')).toBe(false)
  })

  it('ignores parameters and case, which a header may carry either way', () => {
    expect(isImageUploadContentType('IMAGE/PNG')).toBe(true)
    expect(isImageUploadContentType('image/svg+xml; charset=utf-8')).toBe(true)
  })

  it('folds the aliases browsers emit onto one canonical type', () => {
    expect(normalizeImageContentType('image/jpg')).toBe('image/jpeg')
    expect(normalizeImageContentType('image/x-png')).toBe('image/png')
    expect(normalizeImageContentType('image/svg')).toBe('image/svg+xml')
    expect(normalizeImageContentType('image/x-ms-bmp')).toBe('image/bmp')
  })

  it('never widens: an unknown type comes back unchanged and still refused', () => {
    expect(normalizeImageContentType('image/x-anything')).toBe('image/x-anything')
    expect(isImageUploadContentType(normalizeImageContentType('image/x-anything'))).toBe(
      false,
    )
  })
})

/**
 * The point of the allowlist is that a declared type has BYTES to check it
 * against. A format on this list that `upload-inspection` does not know is
 * one whose bytes are never verified, which is the hole the prefix left —
 * so the two lists are pinned together here rather than by a comment.
 *
 * Asked behaviourally: feed a PNG header under each type. Anything with a
 * signature refuses it as a mismatch; a type the table has never heard of
 * accepts it silently. SVG is exempt because it is text and correctly has no
 * signature at all.
 */
describe('every accepted image type has a byte signature', () => {
  for (const type of IMAGE_UPLOAD_TYPES) {
    if (type === 'image/svg+xml' || type === 'image/png') continue
    it(`${type} checks its bytes`, () => {
      const refusal = inspectUploadBytes({
        bytes: PNG_HEADER,
        contentType: type,
        fileName: `probe.${type.split('/')[1]}`,
      })
      expect(refusal?.code).toBe('type_mismatch')
    })
  }

  it('png accepts its own header', () => {
    expect(
      inspectUploadBytes({
        bytes: PNG_HEADER,
        contentType: 'image/png',
        fileName: 'probe.png',
      }),
    ).toBeNull()
  })

  it('svg is exempt, because text has no magic number', () => {
    expect(
      inspectUploadBytes({
        bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        contentType: 'image/svg+xml',
        fileName: 'logo.svg',
      }),
    ).toBeNull()
  })
})
