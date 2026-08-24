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
 * AGL-1881 — a media document cannot address someone else's object.
 *
 * `storagePath` is client-writable (the org media rule freezes only
 * `visibleTo`; `media` is in neither exclusion list of the host catch-all) and
 * seven code paths hand it to `bucket.file()` on the ADMIN SDK, which the
 * Storage rules do not constrain. The named payloads below are the real
 * targets in the shared bucket, not invented ones — the retention prefixes in
 * particular are FIXED and guessable, which is what separates this from
 * "needs a stolen object key".
 */

import {
  isMediaStoragePathInScope,
  mediaStoragePathInScope,
} from './media-storage-path'

const ORG = 'orgs/org_acme'
const HOST = 'hosts/host_acme'
const MEDIA_ID = 'md_1234'

describe('the object key must be inside the document own scope', () => {
  it.each([
    ['another org library', `orgs/org_victim/media/md_secret`],
    ['another host library', `hosts/host_victim/media/md_secret`],
    ['a user avatar', 'users/uid_victim/avatar.png'],
    ['the admin audit archive', 'adminAudit-archive/2026-08/audit.jsonl'],
    ['an erasure record', 'erasures/uid_victim/record.json'],
    ['the bucket root', 'backup.tar.gz'],
    ['a sibling prefix that merely starts the same', `${ORG}-evil/media/x`],
    ['the scope without the media segment', `${ORG}/private/x`],
    ['a traversal out of the prefix', `${ORG}/media/../../org_victim/media/x`],
    ['a doubled separator', `${ORG}/media//x`],
    ['the media prefix with nothing after it', `${ORG}/media/`],
  ])('refuses %s', (_label, candidate) => {
    expect(isMediaStoragePathInScope(candidate, ORG)).toBe(false)
    // And the resolver hands back the document's OWN object instead, so a
    // tampered record addresses nothing but itself.
    expect(
      mediaStoragePathInScope({ storagePath: candidate, base: ORG, mediaId: MEDIA_ID }),
    ).toBe(`${ORG}/media/${MEDIA_ID}`)
  })

  it.each([
    ['the flat layout', `${ORG}/media/${MEDIA_ID}`],
    ['an asset inside one folder', `${ORG}/media/brand/${MEDIA_ID}`],
    ['an asset nested several folders deep', `${ORG}/media/a/b/c/${MEDIA_ID}`],
    ['a generated variant', `${ORG}/media/brand/${MEDIA_ID}__w640.webp`],
    ['a name with dots that are not traversal', `${ORG}/media/logo.v2.png`],
  ])('allows %s', (_label, candidate) => {
    expect(isMediaStoragePathInScope(candidate, ORG)).toBe(true)
    expect(
      mediaStoragePathInScope({ storagePath: candidate, base: ORG, mediaId: MEDIA_ID }),
    ).toBe(candidate)
  })

  it('applies the same rule to a host scope', () => {
    expect(isMediaStoragePathInScope(`${HOST}/media/${MEDIA_ID}`, HOST)).toBe(true)
    // The exact cross-scope confusion the host catch-all left open.
    expect(isMediaStoragePathInScope(`${ORG}/media/${MEDIA_ID}`, HOST)).toBe(false)
  })

  /**
   * Every writer in the repo builds the key as
   * `` `${base}/media/` + optional folder path + mediaId ``. This reproduces
   * that construction rather than asserting a literal, so the predicate and
   * the writers cannot drift apart without this failing.
   */
  it.each([
    ['no folder', ''],
    ['one folder', 'brand'],
    ['nested folders', 'brand/logos/2026'],
  ])('accepts what the upload routes actually build — %s', (_label, folder) => {
    const built = `${ORG}/media/` + (folder ? `${folder}/` : '') + MEDIA_ID
    expect(isMediaStoragePathInScope(built, ORG)).toBe(true)
  })
})

describe('the legacy fallback is not treated as tampering', () => {
  it.each([[undefined], [null], ['']])(
    'falls back quietly for %p, which is the pre-folders shape',
    (absent) => {
      const onRefused = jest.fn()
      const resolved = mediaStoragePathInScope({
        storagePath: absent,
        base: ORG,
        mediaId: MEDIA_ID,
        onRefused,
      })
      expect(resolved).toBe(`${ORG}/media/${MEDIA_ID}`)
      // An ordinary legacy document must not page anyone.
      expect(onRefused).not.toHaveBeenCalled()
    },
  )

  it('DOES report a non-empty out-of-scope path', () => {
    // The other half: a refusal is not a normal condition, because every
    // writer in the repo produces an in-scope key. If this stopped firing,
    // tampering would be silent.
    const onRefused = jest.fn()
    mediaStoragePathInScope({
      storagePath: 'adminAudit-archive/2026-08/audit.jsonl',
      base: ORG,
      mediaId: MEDIA_ID,
      onRefused,
    })
    expect(onRefused).toHaveBeenCalledWith('adminAudit-archive/2026-08/audit.jsonl')
  })

  it.each([[42], [{}], [[]], [true]])(
    'refuses the non-string %p rather than coercing it',
    (candidate) => {
      expect(isMediaStoragePathInScope(candidate, ORG)).toBe(false)
      expect(
        mediaStoragePathInScope({
          storagePath: candidate,
          base: ORG,
          mediaId: MEDIA_ID,
        }),
      ).toBe(`${ORG}/media/${MEDIA_ID}`)
    },
  )

  it('refuses a path with surrounding whitespace rather than trimming into scope', () => {
    // Trimming would mean the string that was validated is not the string
    // that addresses the object.
    expect(isMediaStoragePathInScope(` ${ORG}/media/${MEDIA_ID}`, ORG)).toBe(false)
  })

  it('refuses everything when the base is empty', () => {
    // A caller that lost its scope must not accidentally admit the whole
    // bucket by comparing against a `/media/` prefix with nothing in front.
    expect(isMediaStoragePathInScope('/media/x', '')).toBe(false)
    expect(isMediaStoragePathInScope(`${ORG}/media/x`, '')).toBe(false)
  })
})
