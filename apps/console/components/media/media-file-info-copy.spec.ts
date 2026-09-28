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

import type { MediaEmbeddedField } from '@aglyn/aglyn/app-utils/media-embedded-fields'
import {
  embeddedDraftValue,
  embeddedPatchFromDrafts,
  groupEmbeddedFields,
  mediaStoredFacts,
} from './media-file-info-copy'

const field = (
  key: string,
  value: string | string[],
  group: MediaEmbeddedField['group'] = 'description',
): MediaEmbeddedField => ({
  key,
  label: key,
  group,
  ...(Array.isArray(value) ? { values: value } : { value }),
  sources: ['xmp'],
  editable: true,
})

describe('mediaStoredFacts (AGL-3331)', () => {
  it('lists what the platform measured, in order', () => {
    const facts = mediaStoredFacts({
      contentType: 'image/jpeg',
      sizeBytes: 2_621_440,
      width: 4000,
      height: 3000,
      contentSha256: 'a'.repeat(64),
    })
    expect(facts).toEqual([
      { label: 'Type', value: 'image/jpeg' },
      { label: 'Size', value: '2.5 MB' },
      { label: 'Dimensions', value: '4000 × 3000 px' },
      { label: 'SHA-256', value: 'aaaaaaaaaaaa…' },
    ])
  })

  it('takes a film its size and running time from the video record', () => {
    const facts = mediaStoredFacts({
      contentType: 'video/mp4',
      sizeBytes: 900,
      video: { width: 1920, height: 1080, durationMs: 83_400 },
    })
    expect(facts).toContainEqual({ label: 'Dimensions', value: '1920 × 1080 px' })
    expect(facts).toContainEqual({ label: 'Duration', value: '1:23' })
    expect(facts).toContainEqual({ label: 'Size', value: '900 B' })
  })

  it('names an API upload and nobody else', () => {
    expect(mediaStoredFacts({ uploadedBy: 'api:key_1' })).toContainEqual({
      label: 'Uploaded by',
      value: 'API key',
    })
    expect(
      mediaStoredFacts({ uploadedBy: 'uid123' }).some((f) => f.label === 'Uploaded by'),
    ).toBe(false)
  })
})

describe('groupEmbeddedFields', () => {
  it('buckets in display order and drops empty groups', () => {
    const grouped = groupEmbeddedFields([
      field('make', 'Canon', 'capture'),
      field('title', 'Harbor'),
    ])
    expect(grouped.map((bucket) => bucket.group)).toEqual(['description', 'capture'])
  })
})

describe('embeddedPatchFromDrafts', () => {
  const fields = [
    field('title', 'Harbor'),
    field('keywords', ['boats', 'harbor']),
    field('createdAt', '2021-05-03T10:11:12+02:00', 'capture'),
    field('copyright', '© Ana'),
  ]
  const drafts = () =>
    Object.fromEntries(fields.map((f) => [f.key, embeddedDraftValue(f)]))

  it('sends nothing for untouched drafts', () => {
    expect(embeddedPatchFromDrafts(fields, drafts())).toEqual({})
  })

  it('sends only what changed, a list one entry per line', () => {
    expect(
      embeddedPatchFromDrafts(fields, {
        ...drafts(),
        title: 'Harbor at dusk',
        keywords: 'boats\n  harbor \n\nnight',
      }),
    ).toEqual({ title: 'Harbor at dusk', keywords: ['boats', 'harbor', 'night'] })
  })

  it('keeps a creator with a comma in it whole', () => {
    const creator = field('creator', ['Doe, Jane'], 'rights')
    expect(
      embeddedPatchFromDrafts([creator], { creator: 'Doe, Jane\nRoe, Ann' }),
    ).toEqual({ creator: ['Doe, Jane', 'Roe, Ann'] })
  })

  it('gives an edited date its seconds and its original zone back', () => {
    expect(
      embeddedPatchFromDrafts(fields, { ...drafts(), createdAt: '2021-05-04T09:30' }),
    ).toEqual({ createdAt: '2021-05-04T09:30:00+02:00' })
  })

  it('turns a cleared draft and a removed field into removals', () => {
    expect(
      embeddedPatchFromDrafts(fields, { ...drafts(), title: '  ' }, new Set(['copyright'])),
    ).toEqual({ title: null, copyright: null })
  })

  it('adds a new field only when it was filled in', () => {
    expect(embeddedPatchFromDrafts(fields, { ...drafts(), credit: '' })).toEqual({})
    expect(embeddedPatchFromDrafts(fields, { ...drafts(), credit: 'Aglyn' })).toEqual({
      credit: 'Aglyn',
    })
  })
})
