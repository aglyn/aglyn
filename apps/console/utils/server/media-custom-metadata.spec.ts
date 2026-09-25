/**
 * @jest-environment node
 */

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
 * Custom metadata saves (AGL-822, AGL-3331).
 *
 * The defect this pins: removing or renaming a field in the Details drawer
 * did not stick. The Firestore write merged into the map and the Storage
 * write PATCHed the object's custom map, and neither of those ever removes a
 * key it is not sent. The Firestore half is pinned against the route's
 * source below; the Storage half is `customMetadataStorageMap`.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CUSTOM_METADATA_MAX_PAIRS,
  customMetadataStorageMap,
  sanitizeCustomMetadata,
} from './media-scope'

describe('sanitizeCustomMetadata', () => {
  it('coerces values to strings and trims keys', () => {
    expect(sanitizeCustomMetadata({ ' campaign ': 'q3', year: 2026 })).toEqual({
      campaign: 'q3',
      year: '2026',
    })
  })

  it('drops the download token, blank keys and null values', () => {
    expect(
      sanitizeCustomMetadata({
        firebaseStorageDownloadTokens: 'forged',
        '  ': 'x',
        gone: null,
        kept: '',
      }),
    ).toEqual({ kept: '' })
  })

  it('refuses a non-object', () => {
    expect(sanitizeCustomMetadata(['a'])).toEqual({})
    expect(sanitizeCustomMetadata('a=b')).toEqual({})
  })

  it('caps the pair count', () => {
    const many = Object.fromEntries(
      Array.from({ length: 50 }, (_, index) => [`k${index}`, 'v']),
    )
    expect(Object.keys(sanitizeCustomMetadata(many))).toHaveLength(
      CUSTOM_METADATA_MAX_PAIRS,
    )
  })
})

describe('customMetadataStorageMap', () => {
  it('nulls a removed field so the PATCH deletes it', () => {
    expect(
      customMetadataStorageMap({
        previous: { campaign: 'q3', photographer: 'Ana' },
        next: { campaign: 'q3' },
        token: 't',
      }),
    ).toEqual({
      photographer: null,
      firebaseStorageDownloadTokens: 't',
      campaign: 'q3',
    })
  })

  it('nulls the old name of a renamed field', () => {
    expect(
      customMetadataStorageMap({
        previous: { photog: 'Ana' },
        next: { photographer: 'Ana' },
      }),
    ).toEqual({ photog: null, photographer: 'Ana' })
  })

  it('never nulls the download token, even if a stale map held it', () => {
    const map = customMetadataStorageMap({
      previous: { firebaseStorageDownloadTokens: 'x' },
      next: {},
      token: 't',
    })
    expect(map['firebaseStorageDownloadTokens']).toBe('t')
  })

  it('writes plain pairs when nothing was stored before', () => {
    expect(
      customMetadataStorageMap({ previous: undefined, next: { a: '1' } }),
    ).toEqual({ a: '1' })
  })
})

describe('the custom-metadata action', () => {
  const source = readFileSync(
    join(__dirname, '../../app/api/media/folders/route.ts'),
    'utf8',
  )
  const action = source.slice(
    source.indexOf("action === 'custom-metadata'"),
    source.indexOf("return Response.json({ error: 'Unknown action' }"),
  )

  it('replaces the Firestore map rather than merging into it', () => {
    // A merge set keeps every key it is not sent — the reason a deleted
    // field reappeared. `update` replaces the field whole.
    expect(action).toMatch(/snapshot\.ref\.update\(\{\s*customMetadata: clean/)
    const code = action.replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/snapshot\.ref\.set\(/)
  })

  it('sends the Storage object the map with removals in it', () => {
    expect(action).toContain('customMetadataStorageMap(')
  })
})
