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
  claimPhotoLinkUpload,
  createPhotoLink,
  mintPhotoLinkToken,
  parsePhotoLinkToken,
  PHOTO_LINK_MAX_BYTES,
  PHOTO_LINK_MAX_UPLOADS,
  PHOTO_LINK_TTL_MS,
  photoLinkCallerAddress,
  photoLinkSecretMatches,
  photoLinkState,
  photoLinkUrl,
  readPhotoLinkByToken,
  readPhotoLinkDoc,
  revokePhotoLink,
  storedPhotoLinkBytes,
  type PhotoLinkDoc,
} from './media-photo-links'
import { loadSharp } from './media-variants'
import type { SharpOptions } from 'sharp'

/** A one-collection Firestore stand-in with the reads, writes and transactions the module uses. */
function fakeFirestore() {
  const docs = new Map<string, Record<string, unknown>>()
  const ref = (id: string) => ({
    id,
    get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
    create: async (data: Record<string, unknown>) => {
      if (docs.has(id)) throw new Error('exists')
      docs.set(id, { ...data })
    },
    update: async (patch: Record<string, unknown>) => {
      docs.set(id, { ...(docs.get(id) ?? {}), ...patch })
    },
  })
  const firestore = {
    collection: () => ({ doc: ref }),
    runTransaction: async (run: (transaction: unknown) => Promise<unknown>) =>
      run({
        get: async (r: { id: string }) => ({ exists: docs.has(r.id), data: () => docs.get(r.id) }),
        update: (r: { id: string }, patch: Record<string, unknown>) => {
          docs.set(r.id, { ...(docs.get(r.id) ?? {}), ...patch })
        },
      }),
  }
  return { firestore: firestore as unknown as FirebaseFirestore.Firestore, docs }
}

const live = (overrides: Partial<PhotoLinkDoc> = {}): PhotoLinkDoc => ({
  hostId: 'host-1',
  createdBy: 'uid-1',
  createdAt: 1_000,
  expiresAt: 1_000 + PHOTO_LINK_TTL_MS,
  digest: 'x'.repeat(64),
  folderId: 'folder-1',
  uploads: 0,
  bytes: 0,
  ...overrides,
})

describe('a site photo link (AGL-3957)', () => {
  it('mints a token whose secret the document never holds, and reads it back', () => {
    const minted = mintPhotoLinkToken()
    expect(minted.token).toBe(`${minted.linkId}.${minted.secret}`)
    expect(minted.digest).not.toContain(minted.secret)
    expect(parsePhotoLinkToken(minted.token)).toEqual({ linkId: minted.linkId, secret: minted.secret })
    expect(photoLinkSecretMatches(minted.digest, minted.secret)).toBe(true)
    expect(photoLinkSecretMatches(minted.digest, minted.secret.replace(/./, 'f'))).toBe(false)
    expect(photoLinkSecretMatches(undefined, minted.secret)).toBe(false)
  })

  it('refuses a token that is not shaped like one', () => {
    expect(parsePhotoLinkToken('')).toBeNull()
    expect(parsePhotoLinkToken('abc')).toBeNull()
    expect(parsePhotoLinkToken('../etc.passwd')).toBeNull()
    expect(parsePhotoLinkToken(`${'a'.repeat(24)}.${'z'.repeat(48)}`)).toBeNull()
    expect(parsePhotoLinkToken(`${'a'.repeat(24)}.${'b'.repeat(48)}`)).not.toBeNull()
  })

  it('builds the page address on the console origin, with the secret in the fragment', () => {
    const minted = mintPhotoLinkToken()
    const url = new URL(photoLinkUrl('https://console.example.test/', minted.linkId, minted.secret))
    expect(url.origin).toBe('https://console.example.test')
    // The path is all a request line carries: the id alone, never the secret.
    expect(url.pathname).toBe(`/p/${minted.linkId}`)
    expect(url.pathname).not.toContain(minted.secret)
    expect(url.hash).toBe(`#${minted.secret}`)
    // The page composes the token from path and fragment.
    expect(parsePhotoLinkToken(`${url.pathname.split('/').pop()}.${url.hash.slice(1)}`)).toEqual({
      linkId: minted.linkId,
      secret: minted.secret,
    })
  })

  it('is live for seven days, then expired; revoked and full win over live', () => {
    const doc = live()
    expect(photoLinkState(doc, 1_000)).toBe('live')
    expect(photoLinkState(doc, 1_000 + PHOTO_LINK_TTL_MS - 1)).toBe('live')
    expect(photoLinkState(doc, 1_000 + PHOTO_LINK_TTL_MS)).toBe('expired')
    expect(photoLinkState(live({ revokedAt: 2_000 }), 1_000)).toBe('revoked')
    expect(photoLinkState(live({ uploads: PHOTO_LINK_MAX_UPLOADS }), 1_000)).toBe('full')
    expect(photoLinkState(live({ bytes: PHOTO_LINK_MAX_BYTES }), 1_000)).toBe('full')
  })

  it('reads a stored document defensively', () => {
    expect(readPhotoLinkDoc(undefined)).toBeNull()
    expect(readPhotoLinkDoc({ hostId: 'h' })).toBeNull()
    expect(readPhotoLinkDoc({ hostId: 'h', digest: 'd', uploads: 'three', folderId: '' })).toMatchObject({
      hostId: 'h',
      digest: 'd',
      uploads: 0,
      bytes: 0,
      folderId: null,
    })
  })

  it('creates, finds by token, claims places up to the caps, and revokes', async () => {
    const { firestore, docs } = fakeFirestore()
    const now = 5_000
    const created = await createPhotoLink(firestore, { hostId: 'host-1', uid: 'uid-1', folderId: 'f', now })
    expect(docs.get(created.linkId)).toMatchObject({ hostId: 'host-1', createdBy: 'uid-1', uploads: 0, bytes: 0 })
    expect(JSON.stringify(docs.get(created.linkId))).not.toContain(created.token.split('.')[1])

    const found = await readPhotoLinkByToken(firestore, created.token, now)
    expect(found.ok).toBe(true)
    if (!found.ok) throw new Error('unreachable')
    expect(found.summary).toMatchObject({ state: 'live', remainingUploads: PHOTO_LINK_MAX_UPLOADS })

    expect(await readPhotoLinkByToken(firestore, `${created.linkId}.${'0'.repeat(48)}`, now)).toEqual({ ok: false, reason: 'invalid' })
    expect(await readPhotoLinkByToken(firestore, created.token, now + PHOTO_LINK_TTL_MS)).toEqual({ ok: false, reason: 'expired' })

    expect(await claimPhotoLinkUpload(firestore, found.ref, 10, now)).toEqual({ ok: true })
    expect(docs.get(created.linkId)).toMatchObject({ uploads: 1, bytes: 10, lastUploadAt: now })
    expect(await claimPhotoLinkUpload(firestore, found.ref, PHOTO_LINK_MAX_BYTES, now)).toEqual({ ok: false, reason: 'full' })
    expect(docs.get(created.linkId)).toMatchObject({ uploads: 1, bytes: 10 })

    expect(await revokePhotoLink(firestore, { hostId: 'host-2', linkId: created.linkId, uid: 'uid-2', now })).toBe(false)
    expect(await revokePhotoLink(firestore, { hostId: 'host-1', linkId: created.linkId, uid: 'uid-2', now })).toBe(true)
    expect(await readPhotoLinkByToken(firestore, created.token, now)).toEqual({ ok: false, reason: 'revoked' })
    expect(await claimPhotoLinkUpload(firestore, found.ref, 10, now)).toEqual({ ok: false, reason: 'revoked' })
  })

  it('counts a phone under its first forwarded address', () => {
    const headers = (entries: Record<string, string>) => ({ get: (name: string) => entries[name] ?? null })
    expect(photoLinkCallerAddress(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7')
    expect(photoLinkCallerAddress(headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2')
    expect(photoLinkCallerAddress(headers({}))).toBe('unknown')
  })

  it('stores a phone photo oriented, bounded and stripped of its metadata', async () => {
    const sharp = await loadSharp()
    // The factory as typed takes bytes; a blank canvas is drawn from options alone.
    const draw = sharp as unknown as (options: SharpOptions) => ReturnType<typeof sharp>
    // A 3000-wide photo "held sideways" with EXIF: the stored bytes are
    // turned upright, no wider than the delivery edge, and carry no EXIF.
    const source = await draw({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 120, b: 80 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'somebody', ImageDescription: 'driveway' } } })
      .toBuffer()
    expect((await sharp(source).metadata()).exif).toBeTruthy()
    const stored = await storedPhotoLinkBytes(sharp, source, 'image/jpeg')
    const metadata = await sharp(stored.bytes).metadata()
    expect(stored.contentType).toBe('image/jpeg')
    expect(metadata.exif).toBeUndefined()
    expect(metadata.orientation).toBeUndefined()
    // Orientation 6 is a quarter turn, so the upright photo is taller than wide.
    expect(metadata.height).toBeGreaterThan(metadata.width ?? 0)
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(2560)

    // A clean photo is stored as it came.
    const clean = await draw({ create: { width: 40, height: 30, channels: 3, background: '#fff' } }).png().toBuffer()
    const kept = await storedPhotoLinkBytes(sharp, clean, 'image/png')
    expect(kept.bytes).toBe(clean)
  })
})
