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
 * The head's view of the assets a social card names (AGL-2850).
 *
 * The composition hands a card's references to the reader it already runs
 * for the page's placements, so what is pinned here is the translation at
 * both ends: which references go into that batch, and what the head is told
 * about each. The read for a page that composes nothing goes through the real
 * reader with only Firestore stubbed, so the CDN's visibility rule is the
 * real one too.
 */

const mockDocs = new Map<string, Record<string, unknown>>()
const mockGetAll = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  ...jest.requireActual('@aglyn/tenant-data-admin'),
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        doc: (path: string) => ({ path }),
        getAll: (...args: unknown[]) => mockGetAll(...args),
      }),
    }),
  },
}))

import { hostScopeToken } from '@aglyn/aglyn/server'
import {
  collectSocialImageFacts,
  getSocialImageAssetFacts,
  socialImageAssetFacts,
  socialImageRefs,
} from './social-image-facts'

const SCREEN_CARD = 'media:site1/screen-card'
const HOST_CARD = 'media:site1/host-card'

/** The document references a call asked for, without its read options. */
const pathsRead = (call: unknown[]) =>
  call
    .filter((arg): arg is { path: string } =>
      typeof (arg as { path?: unknown })?.path === 'string',
    )
    .map((arg) => arg.path)

beforeEach(() => {
  mockDocs.clear()
  mockGetAll.mockReset()
  mockGetAll.mockImplementation(async (...args: unknown[]) =>
    pathsRead(args).map((path) => {
      const data = mockDocs.get(path)
      return { exists: data !== undefined, get: (field: string) => data?.[field] }
    }),
  )
})

describe('socialImageRefs (AGL-2850)', () => {
  it('lists each library asset a card names once, in precedence order', () => {
    expect(
      socialImageRefs([
        undefined,
        '',
        'https://images.example.com/card.png',
        SCREEN_CARD,
        // A pin names bytes, not another asset.
        `${SCREEN_CARD}@abc123`,
        HOST_CARD,
        null,
      ]),
    ).toEqual([
      { scope: 'site1', mediaId: 'screen-card' },
      { scope: 'site1', mediaId: 'host-card' },
    ])
  })
})

describe('socialImageAssetFacts (AGL-2850)', () => {
  it("answers each reference as it is stored, with its asset's pair", () => {
    const facts = new Map([
      ['site1/screen-card', { width: 1080, height: 1080 }],
      ['site1/host-card', { width: 1600, height: 900 }],
    ])
    expect(
      socialImageAssetFacts([SCREEN_CARD, `${HOST_CARD}@abc123`], facts),
    ).toEqual({
      [SCREEN_CARD]: { width: 1080, height: 1080 },
      [`${HOST_CARD}@abc123`]: { width: 1600, height: 900 },
    })
  })

  it('answers only a usable pair, and nothing at all when none is', () => {
    const facts = new Map<string, Record<string, unknown>>([
      ['site1/half', { width: 1200 }],
      ['site1/zero', { width: 0, height: 630 }],
      ['site1/text', { width: '1200', height: '630' }],
      ['site1/nan', { width: Number.NaN, height: 630 }],
      ['site1/svg', {}],
      ['site1/usable', { width: 1080, height: 1080 }],
    ])
    const unusable = ['half', 'zero', 'text', 'nan', 'svg', 'unread'].map(
      (id) => `media:site1/${id}`,
    )
    expect(socialImageAssetFacts(unusable, facts)).toBeUndefined()
    // Anti-vacuity: the one usable pair among them is answered on its own.
    expect(
      socialImageAssetFacts([...unusable, 'media:site1/usable'], facts),
    ).toEqual({ 'media:site1/usable': { width: 1080, height: 1080 } })
  })
})

describe('collectSocialImageFacts (AGL-2850)', () => {
  it('holds what the composition reports, for the caller to hand on', () => {
    const card = collectSocialImageFacts([SCREEN_CARD])
    expect(card.socialImages.images).toEqual([SCREEN_CARD])
    expect(card.collected()).toEqual({})
    card.socialImages.onFacts({ [SCREEN_CARD]: { width: 1080, height: 1080 } })
    expect(card.collected()).toEqual({
      socialImageFacts: { [SCREEN_CARD]: { width: 1080, height: 1080 } },
    })
  })
})

describe('getSocialImageAssetFacts (AGL-2850)', () => {
  it("reads the card's documents in ONE projected query", async () => {
    mockDocs.set('hosts/site1/media/screen-card', { width: 1080, height: 1080 })
    mockDocs.set('hosts/site1/media/host-card', { width: 1600, height: 900 })
    const facts = await getSocialImageAssetFacts({
      hostId: 'site1',
      images: [SCREEN_CARD, HOST_CARD],
    })
    expect(mockGetAll).toHaveBeenCalledTimes(1)
    const call = mockGetAll.mock.calls[0]
    expect(pathsRead(call)).toEqual([
      'hosts/site1/media/screen-card',
      'hosts/site1/media/host-card',
    ])
    expect(call[call.length - 1]).toEqual({
      fieldMask: expect.arrayContaining(['width', 'height']),
    })
    expect(facts).toEqual({
      [SCREEN_CARD]: { width: 1080, height: 1080 },
      [HOST_CARD]: { width: 1600, height: 900 },
    })
  })

  it('reads nothing when no reference names a library asset', async () => {
    expect(
      await getSocialImageAssetFacts({
        hostId: 'site1',
        images: [undefined, '', 'https://images.example.com/card.png'],
      }),
    ).toBeUndefined()
    expect(mockGetAll).not.toHaveBeenCalled()
  })

  it('answers nothing for an asset this site may not be shown', async () => {
    mockDocs.set('orgs/acme/media/card', {
      width: 1080,
      height: 1080,
      visibleTo: [hostScopeToken('site9')],
    })
    expect(
      await getSocialImageAssetFacts({
        hostId: 'site1',
        images: ['media:org:acme/card'],
      }),
    ).toBeUndefined()
    // Anti-vacuity: the site the asset IS shared with is answered.
    expect(
      await getSocialImageAssetFacts({
        hostId: 'site9',
        images: ['media:org:acme/card'],
      }),
    ).toEqual({ 'media:org:acme/card': { width: 1080, height: 1080 } })
  })

  it('answers nothing when the read fails, so the card keeps its stored pair', async () => {
    mockGetAll.mockRejectedValue(new Error('unavailable'))
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(
        await getSocialImageAssetFacts({ hostId: 'site1', images: [SCREEN_CARD] }),
      ).toBeUndefined()
      expect(logged).toHaveBeenCalled()
    } finally {
      logged.mockRestore()
    }
  })
})
