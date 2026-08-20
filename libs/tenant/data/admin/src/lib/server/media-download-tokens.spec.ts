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
 * The AGL-1526 raw-URL revocation itself: does rotation actually change the
 * token, and does it leave alone everything it must?
 *
 * The bucket double models the two `@google-cloud/storage` behaviours this
 * module's correctness rests on
 * (`feedback_a_test_double_must_model_real_semantics`):
 *
 *  - `getFiles({ autoPaginate: false })` resolves `[files, nextQuery]`, and
 *    `nextQuery` is UNDEFINED on the last page — a double that always
 *    returned a page token would loop forever, and one that never returned
 *    a token would fake a clean scan of a truncated library;
 *  - `setMetadata({ metadata })` REPLACES the whole custom-metadata map
 *    rather than merging into it (the trap `POST /api/media/folders`
 *    documents at its move path). The double replaces, so the spec below
 *    that asserts customer metadata survives is a real assertion and not a
 *    property of a forgiving fake.
 */

import {
  DOWNLOAD_TOKEN_METADATA_KEY,
  lockRotatesDownloadTokens,
  rotateDownloadTokensUnderPrefix,
  rotateScopeDownloadTokens,
} from './media-download-tokens'

interface FakeObject {
  name: string
  custom: Record<string, unknown>
  /** Make this object's rewrite throw, to exercise the fail-soft path. */
  failing?: boolean
}

function fakeBucket(objects: FakeObject[], pageSize = 500) {
  const files = objects.map((object) => ({
    name: object.name,
    metadata: { metadata: object.custom },
    setMetadata: async (next: { metadata: Record<string, unknown> }) => {
      if (object.failing) throw new Error('403 from the edge')
      // REPLACE, exactly as GCS does.
      object.custom = { ...next.metadata }
    },
  }))
  return {
    calls: [] as Array<Record<string, unknown>>,
    async getFiles(query: Record<string, unknown>) {
      this.calls.push(query)
      const prefix = String(query['prefix'] ?? '')
      const matching = files.filter((file) => file.name.startsWith(prefix))
      const start = Number(query['pageToken'] ?? 0)
      const page = matching.slice(start, start + pageSize)
      const nextStart = start + page.length
      return [
        page,
        nextStart < matching.length ? { pageToken: String(nextStart) } : undefined,
      ]
    },
  }
}

const tokened = (name: string, token: string, extra = {}): FakeObject => ({
  name,
  custom: { [DOWNLOAD_TOKEN_METADATA_KEY]: token, ...extra },
})

describe('lockRotatesDownloadTokens', () => {
  it('rotates for a full security lock and nothing else', () => {
    expect(lockRotatesDownloadTokens({ reason: 'security', mode: 'full' })).toBe(true)
    // Mode absent means full — a lock written before AGL-1511 must not be
    // read as read-only and quietly skip the revocation.
    expect(lockRotatesDownloadTokens({ reason: 'security' })).toBe(true)
  })

  it('NEVER rotates for a non-security reason, or for read-only', () => {
    // The destructive-to-embeds price is worth paying for malware, not for
    // an unpaid invoice.
    expect(lockRotatesDownloadTokens({ reason: 'billing', mode: 'full' })).toBe(false)
    expect(lockRotatesDownloadTokens({ reason: 'maintenance' })).toBe(false)
    expect(lockRotatesDownloadTokens({ reason: 'manual' })).toBe(false)
    // A read-only lock promises the sites keep serving; killing their asset
    // URLs would break that promise in the most visible way possible.
    expect(lockRotatesDownloadTokens({ reason: 'security', mode: 'read-only' })).toBe(
      false,
    )
    expect(lockRotatesDownloadTokens({} as never)).toBe(false)
  })
})

describe('rotateDownloadTokensUnderPrefix', () => {
  it('replaces the token on every already-tokened object under the prefix', async () => {
    const objects = [
      tokened('orgs/acme/media/a', 'token-a'),
      tokened('orgs/acme/media/b', 'token-b'),
      tokened('orgs/acme/media/a__w320.webp', 'token-variant'),
    ]
    const bucket = fakeBucket(objects)

    const result = await rotateDownloadTokensUnderPrefix({
      prefix: 'orgs/acme/',
      bucket,
    })

    expect(result.ok).toBe(true)
    expect(result.scanned).toBe(3)
    expect(result.rotated).toBe(3)
    expect(result.truncated).toBe(false)
    // The point of the whole issue: the OLD token is gone, so the raw
    // `?alt=media&token=token-a` URL 403s at Google's edge.
    expect(objects[0].custom[DOWNLOAD_TOKEN_METADATA_KEY]).not.toBe('token-a')
    expect(objects[1].custom[DOWNLOAD_TOKEN_METADATA_KEY]).not.toBe('token-b')
    // CDN variants share the prefix tree (`${objectPath}__w{n}.webp`) and
    // are rotated too — a variant with a live token is a live raw URL.
    expect(objects[2].custom[DOWNLOAD_TOKEN_METADATA_KEY]).not.toBe('token-variant')
    // Each object gets its OWN new token; one shared value would be a
    // single guessable credential for the whole library.
    const issued = objects.map((o) => o.custom[DOWNLOAD_TOKEN_METADATA_KEY])
    expect(new Set(issued).size).toBe(3)
  })

  it('NEGATIVE CONTROL: an object outside the locked prefix keeps its token', async () => {
    // The unlocked org's assets must go on serving. Without this, a
    // rotation that ignored `prefix` — or a helper that swept the whole
    // bucket — would pass every other spec in this file.
    const locked = tokened('orgs/acme/media/a', 'token-a')
    const untouched = tokened('orgs/other/media/z', 'token-z')
    const alsoUntouched = tokened('hosts/other-site/media/z', 'token-host-z')
    const bucket = fakeBucket([locked, untouched, alsoUntouched])

    const result = await rotateDownloadTokensUnderPrefix({
      prefix: 'orgs/acme/',
      bucket,
    })

    expect(result.rotated).toBe(1)
    expect(result.scanned).toBe(1)
    expect(locked.custom[DOWNLOAD_TOKEN_METADATA_KEY]).not.toBe('token-a')
    expect(untouched.custom[DOWNLOAD_TOKEN_METADATA_KEY]).toBe('token-z')
    expect(alsoUntouched.custom[DOWNLOAD_TOKEN_METADATA_KEY]).toBe('token-host-z')
  })

  it('does not MINT a token on an object that never had one', async () => {
    // Narrowing (2): writing a token here would create a public raw URL for
    // an object that had none — the exposure this module exists to remove.
    const tokenless: FakeObject = {
      name: 'orgs/acme/media/private',
      custom: { alt: 'a private asset' },
    }
    const bucket = fakeBucket([tokenless, tokened('orgs/acme/media/a', 'token-a')])

    const result = await rotateDownloadTokensUnderPrefix({
      prefix: 'orgs/acme/',
      bucket,
    })

    expect(result.scanned).toBe(2)
    expect(result.rotated).toBe(1)
    expect(tokenless.custom[DOWNLOAD_TOKEN_METADATA_KEY]).toBeUndefined()
    expect(tokenless.custom).toEqual({ alt: 'a private asset' })
  })

  it('preserves the customer custom metadata alongside the new token', async () => {
    // `setMetadata` replaces the map, so a naive `{ metadata: { token } }`
    // would erase every customer-set pair on a locked org's library. A lock
    // is not a data-loss event.
    const object = tokened('orgs/acme/media/a', 'token-a', {
      alt: 'Storefront hero',
      credit: 'Jane Doe',
    })
    const bucket = fakeBucket([object])

    await rotateDownloadTokensUnderPrefix({ prefix: 'orgs/acme/', bucket })

    expect(object.custom['alt']).toBe('Storefront hero')
    expect(object.custom['credit']).toBe('Jane Doe')
    expect(object.custom[DOWNLOAD_TOKEN_METADATA_KEY]).not.toBe('token-a')
  })

  it('keeps going when one object refuses, and counts the failure', async () => {
    const failing: FakeObject = {
      name: 'orgs/acme/media/bad',
      custom: { [DOWNLOAD_TOKEN_METADATA_KEY]: 'token-bad' },
      failing: true,
    }
    const after = tokened('orgs/acme/media/zzz', 'token-z')
    const bucket = fakeBucket([failing, after])

    const result = await rotateDownloadTokensUnderPrefix({
      prefix: 'orgs/acme/',
      bucket,
    })

    expect(result.failed).toBe(1)
    // One 403 must not abandon the rest of a security revocation.
    expect(result.rotated).toBe(1)
    expect(after.custom[DOWNLOAD_TOKEN_METADATA_KEY]).not.toBe('token-z')
    expect(result.ok).toBe(true)
  })

  it('pages through a library larger than one Storage page', async () => {
    const objects = Array.from({ length: 12 }, (_, index) =>
      tokened(`orgs/acme/media/${index}`, `token-${index}`),
    )
    const bucket = fakeBucket(objects, 5)

    const result = await rotateDownloadTokensUnderPrefix({
      prefix: 'orgs/acme/',
      bucket,
    })

    expect(result.scanned).toBe(12)
    expect(result.rotated).toBe(12)
    expect(result.truncated).toBe(false)
    expect(bucket.calls.length).toBe(3)
    for (const [index, object] of objects.entries()) {
      expect(object.custom[DOWNLOAD_TOKEN_METADATA_KEY]).not.toBe(`token-${index}`)
    }
  })

  it('reports truncation rather than pretending a capped scan was complete', async () => {
    const objects = Array.from({ length: 12 }, (_, index) =>
      tokened(`orgs/acme/media/${index}`, `token-${index}`),
    )
    const bucket = fakeBucket(objects, 5)

    const result = await rotateDownloadTokensUnderPrefix({
      prefix: 'orgs/acme/',
      bucket,
      maxObjects: 5,
    })

    // An incident reviewer must be able to see that live raw URLs remain.
    expect(result.truncated).toBe(true)
    expect(result.reason).toBe('object-cap')
    expect(result.rotated).toBe(5)
  })

  it('reports truncation when the wall-clock budget runs out', async () => {
    const objects = Array.from({ length: 12 }, (_, index) =>
      tokened(`orgs/acme/media/${index}`, `token-${index}`),
    )
    const bucket = fakeBucket(objects, 5)
    let clock = 0
    const result = await rotateDownloadTokensUnderPrefix({
      prefix: 'orgs/acme/',
      bucket,
      budgetMs: 100,
      now: () => (clock += 60),
    })

    expect(result.truncated).toBe(true)
    expect(result.reason).toBe('time-budget')
  })

  it('fails soft when Storage itself is unreachable', async () => {
    const result = await rotateDownloadTokensUnderPrefix({
      prefix: 'orgs/acme/',
      bucket: {
        getFiles: async () => {
          throw new Error('storage down')
        },
      },
    })
    // The lock is already durable; rotation cannot be allowed to throw it away.
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('error')
  })
})

describe('rotateScopeDownloadTokens', () => {
  it('covers the org tree AND each site tree, and reports per prefix', async () => {
    // A site's library is its own Storage tree; an org lock that cleaned
    // only `orgs/{id}/` would leave most of the assets serving.
    const orgAsset = tokened('orgs/acme/media/a', 'token-a')
    const siteAsset = tokened('hosts/acme-site/media/b', 'token-b')
    const otherOrg = tokened('orgs/other/media/z', 'token-z')
    const bucket = fakeBucket([orgAsset, siteAsset, otherOrg])

    const results = await rotateScopeDownloadTokens({
      prefixes: ['orgs/acme/', 'hosts/acme-site/'],
      bucket,
    })

    expect(results.map((r) => r.prefix)).toEqual(['orgs/acme/', 'hosts/acme-site/'])
    expect(results.every((r) => r.rotated === 1)).toBe(true)
    expect(orgAsset.custom[DOWNLOAD_TOKEN_METADATA_KEY]).not.toBe('token-a')
    expect(siteAsset.custom[DOWNLOAD_TOKEN_METADATA_KEY]).not.toBe('token-b')
    // NEGATIVE CONTROL again, at scope level.
    expect(otherOrg.custom[DOWNLOAD_TOKEN_METADATA_KEY]).toBe('token-z')
  })
})
