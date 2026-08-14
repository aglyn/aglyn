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
 * The pure half of asset quarantine (AGL-1512): key derivation, the
 * malformed-record refusal, expiry, and the owner-facing copy.
 *
 * The properties worth pinning here are the ones a future edit could break
 * without any test failing elsewhere: that a hash key is the DEFAULT and the
 * asset key only a fallback, that a record with an unrecognised reason is
 * refused whole rather than defaulted (a takedown must not guess), that the
 * staff-only `note` can never reach a rendered surface, and that every
 * owner notice says the file still EXISTS — because for every reason in the
 * enum it does, and a customer who concludes their data was deleted has
 * been told something false by a lever whose whole point is reversibility.
 */

import {
  isMediaQuarantineActive,
  isMediaQuarantineReason,
  MEDIA_QUARANTINE_MESSAGE_MAX,
  MEDIA_QUARANTINE_REASON_LABELS,
  MEDIA_QUARANTINE_REASONS,
  type MediaQuarantineEntry,
  mediaQuarantineAssetKey,
  mediaQuarantineHashKey,
  mediaQuarantineKey,
  mediaQuarantineKeys,
  mediaQuarantineNotice,
  normalizeMediaQuarantine,
} from './media-quarantine'

describe('AGL-1512 · quarantine keys', () => {
  it('prefers the content hash — the key that survives a re-upload', () => {
    expect(
      mediaQuarantineKey({
        contentHash: '0123456789abcdef',
        scopeSegment: 'org:acme',
        mediaId: 'm1',
      }),
    ).toBe('hash--0123456789abcdef')
  })

  it('falls back to the asset key ONLY when there is no hash', () => {
    // Legacy uploads and GCS composite objects carry no `contentHash`; a
    // takedown lever that could not touch them would leave the largest
    // files in the product beyond reach.
    expect(
      mediaQuarantineKey({ scopeSegment: 'org:acme', mediaId: 'm1' }),
    ).toBe('asset--org:acme--m1')
    expect(
      mediaQuarantineKey({
        contentHash: '   ',
        scopeSegment: 'h1',
        mediaId: 'm1',
      }),
    ).toBe('asset--h1--m1')
  })

  it('returns null rather than a key that would match nothing', () => {
    expect(mediaQuarantineKey({})).toBeNull()
    expect(mediaQuarantineKey({ mediaId: 'm1' })).toBeNull()
    expect(mediaQuarantineKey({ scopeSegment: 'org:acme' })).toBeNull()
  })

  it('normalizes hash case so a hand-typed hash finds its own record', () => {
    expect(mediaQuarantineHashKey('ABCDEF0123456789')).toBe(
      mediaQuarantineHashKey('abcdef0123456789'),
    )
  })

  it('scope-qualifies the asset key — a media id is unique per library', () => {
    expect(mediaQuarantineAssetKey('org:acme', 'm1')).not.toBe(
      mediaQuarantineAssetKey('h1', 'm1'),
    )
  })
})

/**
 * AGL-1614 introduced a SECOND, stronger digest beside the truncated
 * `contentHash`. The whole risk of doing that is a takedown that quietly
 * stops biting because the document it covers grew a better field, so these
 * are the properties that make it safe rather than the ones that make it
 * nice.
 */
describe('AGL-1614 · the strong digest never strands a live takedown', () => {
  const SHA = 'a'.repeat(64)
  const LEGACY = '0123456789abcdef'

  it('an entry keyed on the LEGACY hash still matches an asset that gained a sha256', () => {
    // The failure this prevents: staff quarantine a file today (legacy key),
    // the owner replaces it with the same bytes tomorrow, the new write adds
    // `contentSha256`, and a preference-only lookup would serve the file
    // again. A takedown lifting itself is the worst outcome this lever has.
    expect(
      mediaQuarantineKeys({
        contentSha256: SHA,
        contentHash: LEGACY,
        scopeSegment: 'org:acme',
        mediaId: 'm1',
      }),
    ).toEqual([`hash--${SHA}`, `hash--${LEGACY}`, 'asset--org:acme--m1'])
  })

  it('prefers the strong digest but never at the cost of the others', () => {
    expect(
      mediaQuarantineKey({ contentSha256: SHA, contentHash: LEGACY }),
    ).toBe(`hash--${SHA}`)
    expect(mediaQuarantineKeys({ contentSha256: SHA })).toEqual([
      `hash--${SHA}`,
    ])
  })

  it('is a no-op for the documents that have no strong digest', () => {
    // Every asset written before this change, plus every non-SVG landed
    // through the signed-upload route, which never holds the bytes.
    expect(
      mediaQuarantineKeys({
        contentHash: LEGACY,
        scopeSegment: 'h1',
        mediaId: 'm1',
      }),
    ).toEqual([`hash--${LEGACY}`, 'asset--h1--m1'])
    expect(mediaQuarantineKeys({ scopeSegment: 'h1', mediaId: 'm1' })).toEqual([
      'asset--h1--m1',
    ])
    expect(mediaQuarantineKeys({})).toEqual([])
  })

  it('never emits the same key twice when both digests agree', () => {
    // Not hypothetical: a legacy document whose `contentHash` was already a
    // sha256 prefix can be handed the same string in both fields by an
    // import that copies whatever it was given.
    expect(
      mediaQuarantineKeys({ contentSha256: SHA, contentHash: SHA }),
    ).toEqual([`hash--${SHA}`])
  })
})

describe('AGL-1512 · reason vocabulary', () => {
  it('accepts exactly the enum and nothing else', () => {
    for (const reason of MEDIA_QUARANTINE_REASONS) {
      expect(isMediaQuarantineReason(reason)).toBe(true)
    }
    // The LOCKDOWN vocabulary is deliberately not this one: a takedown
    // recorded as "security" cannot answer the only question anyone asks
    // about it a year later.
    expect(isMediaQuarantineReason('security')).toBe(false)
    expect(isMediaQuarantineReason('billing')).toBe(false)
    expect(isMediaQuarantineReason('')).toBe(false)
    expect(isMediaQuarantineReason(undefined)).toBe(false)
  })

  it('every reason has a staff label', () => {
    for (const reason of MEDIA_QUARANTINE_REASONS) {
      expect(MEDIA_QUARANTINE_REASON_LABELS[reason]).toBeTruthy()
    }
  })
})

describe('AGL-1512 · normalizing a stored entry', () => {
  const entry: Partial<MediaQuarantineEntry> = {
    reason: 'dmca',
    message: 'Disabled pending a copyright claim.',
    note: 'Notice #4417 from Example Records, staff eyes only',
    atMs: 1_700_000_000_000,
    untilMs: null,
    actorUid: 'staff-1',
  }

  it('carries the field family AGL-1501 established', () => {
    expect(normalizeMediaQuarantine(entry, 'hash--abc')).toEqual({
      key: 'hash--abc',
      reason: 'dmca',
      message: 'Disabled pending a copyright claim.',
      atMs: 1_700_000_000_000,
      untilMs: undefined,
      actorUid: 'staff-1',
    })
  })

  it('NEVER carries the staff note into the state', () => {
    // `note` is internal rationale. The state is what feeds the owner
    // notice, so the only safe place for the note is the stored entry and
    // the audit row — never a shape a renderer can reach.
    const state = normalizeMediaQuarantine(entry, 'hash--abc')
    expect(JSON.stringify(state)).not.toContain('Example Records')
    expect(state).not.toHaveProperty('note')
  })

  it('refuses a record with no recognised reason, whole', () => {
    expect(normalizeMediaQuarantine({ reason: 'oops' as never }, 'k')).toBeNull()
    expect(normalizeMediaQuarantine({}, 'k')).toBeNull()
    expect(normalizeMediaQuarantine(null, 'k')).toBeNull()
    expect(normalizeMediaQuarantine(undefined, 'k')).toBeNull()
  })

  it('bounds the owner-facing message', () => {
    const state = normalizeMediaQuarantine(
      { reason: 'abuse', message: 'x'.repeat(2000) },
      'k',
    )
    expect(state?.message).toHaveLength(MEDIA_QUARANTINE_MESSAGE_MAX)
  })

  it('drops a non-finite expiry rather than treating it as a deadline', () => {
    expect(
      normalizeMediaQuarantine(
        { reason: 'malware', untilMs: Number.NaN },
        'k',
      )?.untilMs,
    ).toBeUndefined()
  })
})

describe('AGL-1512 · expiry', () => {
  const state = (untilMs?: number) =>
    normalizeMediaQuarantine({ reason: 'abuse', untilMs: untilMs ?? null }, 'k')

  it('no expiry stays active', () => {
    expect(isMediaQuarantineActive(state(), 1_000)).toBe(true)
  })

  it('a future expiry is active; a passed one restores with NO write', () => {
    expect(isMediaQuarantineActive(state(2_000), 1_000)).toBe(true)
    expect(isMediaQuarantineActive(state(1_000), 1_000)).toBe(false)
    expect(isMediaQuarantineActive(state(999), 1_000)).toBe(false)
  })

  it('null state is never active', () => {
    expect(isMediaQuarantineActive(null, 1_000)).toBe(false)
  })
})

describe('AGL-1512 · the owner-facing notice', () => {
  it('every reason says the file was NOT deleted and how to reach us', () => {
    for (const reason of MEDIA_QUARANTINE_REASONS) {
      const notice = mediaQuarantineNotice({ reason })
      expect(notice.title).toBe('This file was disabled')
      expect(notice.body.toLowerCase()).toContain('not been deleted')
      // The storage counter is untouched by design, and the customer is
      // told so rather than left to discover it on an invoice.
      expect(notice.body.toLowerCase()).toContain('storage')
      expect(notice.contact).toBe('support@aglyn.com')
    }
  })

  it('a staff message replaces the body but never the contact affordance', () => {
    const notice = mediaQuarantineNotice({
      reason: 'dmca',
      message: 'Disabled pending review of a copyright claim.',
    })
    expect(notice.body).toBe('Disabled pending review of a copyright claim.')
    expect(notice.contact).toBe('support@aglyn.com')
    expect(notice.title).toBe('This file was disabled')
  })

  it('a blank message falls back to the per-reason copy', () => {
    expect(mediaQuarantineNotice({ reason: 'malware', message: '   ' }).body).toBe(
      mediaQuarantineNotice({ reason: 'malware' }).body,
    )
  })
})
