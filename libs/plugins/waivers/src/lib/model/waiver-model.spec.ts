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
  addDays,
  dayKeyIn,
  draftChangesText,
  isDayKey,
  normalizeWaiverDraft,
  validThroughDayKey,
  validityLabel,
  waiverBodyText,
  type WaiverDraft,
} from './waiver'
import {
  ageOn,
  nameSearchTokens,
  normalizeSignInput,
  parseSignatureSearch,
  signatureCsvRow,
  waiverDayStatus,
  waiverSignedText,
  waiverStatusLabel,
  WAIVER_SIGNATURE_CSV_HEADER,
  type StoredWaiverSignature,
} from './waiver-signature'

/** The waiver and signature rules (AGL-4042) the console, the signing form and the server share. */

const DRAFT: WaiverDraft & { version: number } = {
  title: 'Rider release',
  body: '## Risks\n\nMotocross is **dangerous**.\n\n- Wear a helmet\n- Ride in control\n\n1. Sign\n2. Ride',
  checkboxes: [
    { id: 'read', label: 'I have read this waiver.' },
    { id: 'gear', label: 'I will wear my gear.' },
  ],
  allowMinors: true,
  validity: { kind: 'visit' },
  version: 3,
}

const SIGNING = {
  version: 3,
  signer: { name: 'Jordan Lee', email: 'Jordan@Example.com', phone: '555 0100', dateOfBirth: '1990-04-02' },
  minors: [{ name: 'Pat Lee', dateOfBirth: '2014-09-30' }],
  guardianRelationship: 'Parent',
  checked: ['read', 'gear'],
  signature: { kind: 'drawn', strokes: [[[10, 10], [20, 30], [40, 60]], [[100, 100], [200, 300]]] },
  consent: true,
}

describe('a waiver draft', () => {
  it('keeps a well-formed draft and trims what was typed', () => {
    const result = normalizeWaiverDraft({ ...DRAFT, title: '  Rider   release ' })
    expect(result).toEqual({
      ok: true,
      draft: { title: 'Rider release', body: DRAFT.body, checkboxes: DRAFT.checkboxes, allowMinors: true, validity: { kind: 'visit' } },
    })
  })

  it('says what to fix', () => {
    const fix = (input: Record<string, unknown>) => {
      const result = normalizeWaiverDraft({ ...DRAFT, ...input })
      return result.ok === false ? result.error : null
    }
    expect(fix({ title: '' })).toMatch(/title/)
    expect(fix({ body: '   ' })).toMatch(/text/)
    expect(fix({ checkboxes: [{ id: 'x', label: '' }] })).toMatch(/Checkbox 1/)
    expect(fix({ validity: { kind: 'season', endDayKey: '2026-02-30' } })).toMatch(/season/)
    expect(fix({ validity: { kind: 'days', days: 0 } })).toMatch(/1 to 400/)
  })

  it('gives duplicate or missing checkbox ids their own', () => {
    const result = normalizeWaiverDraft({
      ...DRAFT,
      checkboxes: [{ id: 'a', label: 'One' }, { id: 'a', label: 'Two' }, { label: 'Three' }],
    })
    expect(result.ok && result.draft.checkboxes.map((box) => box.id)).toEqual(['a', 'box-2', 'box-3'])
  })

  it('bumps the version only when what a signer agrees to changes', () => {
    expect(draftChangesText(DRAFT, { ...DRAFT })).toBe(false)
    expect(draftChangesText(DRAFT, { ...DRAFT, body: `${DRAFT.body}\n\nMore.` })).toBe(true)
    expect(draftChangesText(DRAFT, { ...DRAFT, allowMinors: false })).toBe(true)
    expect(draftChangesText(DRAFT, { ...DRAFT, validity: { kind: 'days', days: 365 } })).toBe(true)
  })

  it('reads its words as plain text: headings, paragraphs, bullets and numbers, no syntax', () => {
    expect(waiverBodyText(DRAFT.body)).toBe(
      'Risks\n\nMotocross is dangerous.\n\n• Wear a helmet\n\n• Ride in control\n\n1. Sign\n\n2. Ride',
    )
  })
})

describe('how long a signature lasts', () => {
  it('a visit is the signing day, a season runs to its last day, days count the signing day', () => {
    expect(validThroughDayKey({ kind: 'visit' }, '2026-10-24')).toBe('2026-10-24')
    expect(validThroughDayKey({ kind: 'season', endDayKey: '2026-11-30' }, '2026-10-24')).toBe('2026-11-30')
    expect(validThroughDayKey({ kind: 'season', endDayKey: '2026-01-01' }, '2026-10-24')).toBe('2026-10-24')
    expect(validThroughDayKey({ kind: 'days', days: 365 }, '2026-10-24')).toBe('2027-10-23')
    expect(validThroughDayKey({ kind: 'days', days: 1 }, '2026-10-24')).toBe('2026-10-24')
  })

  it('names the window in plain words', () => {
    expect(validityLabel({ kind: 'visit' })).toMatch(/one visit/)
    expect(validityLabel({ kind: 'days', days: 365 })).toBe('Good for a year')
    expect(validityLabel({ kind: 'season', endDayKey: '2026-11-30' })).toBe('Good through Nov 30, 2026')
  })

  it('reads the day in the site’s zone, not the server’s', () => {
    const lateEvening = Date.UTC(2026, 9, 25, 3, 30) // 22:30 on Oct 24 in Chicago
    expect(dayKeyIn(lateEvening, 'America/Chicago')).toBe('2026-10-24')
    expect(dayKeyIn(lateEvening, 'UTC')).toBe('2026-10-25')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(isDayKey('2026-02-29')).toBe(false)
    expect(isDayKey('2028-02-29')).toBe(true)
  })
})

describe('a signing', () => {
  const check = (input: Record<string, unknown>, method: 'online' | 'at_window' = 'online') =>
    normalizeSignInput({ ...SIGNING, ...input }, DRAFT, '2026-10-24', { method })

  it('accepts a parent signing for a minor, every box ticked', () => {
    const result = check({})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.input.signer.email).toBe('jordan@example.com')
      expect(result.input.minors).toEqual([{ name: 'Pat Lee', dateOfBirth: '2014-09-30' }])
      expect(result.input.signature).toEqual({ kind: 'drawn', strokes: SIGNING.signature.strokes })
    }
  })

  it('refuses each thing a signer missed, in words they can act on', () => {
    const error = (input: Record<string, unknown>, method?: 'online' | 'at_window') => {
      const result = check(input, method)
      return result.ok === false ? result.error : null
    }
    expect(error({ version: 2 })).toMatch(/updated while you were reading/)
    expect(error({ signer: { ...SIGNING.signer, email: '' } })).toMatch(/email/)
    expect(error({ signer: { ...SIGNING.signer, email: '' } }, 'at_window')).toBeNull()
    expect(error({ signer: { ...SIGNING.signer, dateOfBirth: '2010-01-01' } })).toMatch(/under 18/)
    expect(error({ minors: [{ name: 'Sam Lee', dateOfBirth: '2000-01-01' }] })).toMatch(/sign their own/)
    expect(error({ guardianRelationship: '' })).toMatch(/related/)
    expect(error({ checked: ['read'] })).toMatch(/I will wear my gear/)
    expect(error({ consent: false })).toMatch(/electronically/)
    expect(error({ signature: { kind: 'drawn', strokes: [] } })).toMatch(/Sign in the box/)
    expect(error({ signature: { kind: 'drawn', strokes: [[[2000, 5]]] } })).toMatch(/Sign in the box/)
    expect(error({ signature: { kind: 'typed', text: ' ' } })).toMatch(/Type your name/)
  })

  it('refuses minors on a waiver that takes none', () => {
    const result = normalizeSignInput(SIGNING, { ...DRAFT, allowMinors: false }, '2026-10-24', { method: 'online' })
    expect(result.ok === false && result.error).toMatch(/each rider signs their own/i)
  })

  it('counts whole years to the day', () => {
    expect(ageOn('2008-10-24', '2026-10-24')).toBe(18)
    expect(ageOn('2008-10-25', '2026-10-24')).toBe(17)
  })

  it('signs the waiver’s own text, the same for every signer, consent last', () => {
    const text = waiverSignedText(DRAFT, { consent: true })
    expect(text.startsWith('Rider release\n\nVersion 3\n\nRisks')).toBe(true)
    expect(text).toContain('[x] I will wear my gear.')
    expect(text.endsWith('I can ask the business for a paper copy instead.')).toBe(true)
    expect(waiverSignedText(DRAFT, { consent: false })).not.toContain('Electronic signature consent')
  })
})

describe('a person’s waiver status for a day', () => {
  const signature = (overrides: Partial<StoredWaiverSignature>) =>
    ({
      id: 's1',
      voidedAt: null,
      dayKey: '2026-10-24',
      validThroughDayKey: '2026-10-24',
      signer: { name: 'Jordan Lee' },
      minors: [{ name: 'Pat Lee', dateOfBirth: '2014-09-30' }],
      signedAtMs: 1,
      ...overrides,
    }) as StoredWaiverSignature

  it('is signed on a covered day, for everybody on it', () => {
    const status = waiverDayStatus([signature({})], '2026-10-24')
    expect(status).toEqual({ signed: true, coveredNames: ['Jordan Lee', 'Pat Lee'], signatureId: 's1' })
    expect(waiverStatusLabel(status)).toBe('Waiver signed')
    expect(waiverStatusLabel(status, 3)).toBe('Signed for 2 of 3 riders')
  })

  it('is needed the next day, and when the only signature was voided', () => {
    expect(waiverDayStatus([signature({})], '2026-10-25').signed).toBe(false)
    const voided = waiverDayStatus([signature({ voidedAt: 5 })], '2026-10-24')
    expect(voided.signed).toBe(false)
    expect(waiverStatusLabel(voided)).toBe('Waiver needed')
  })
})

describe('search and export', () => {
  it('reads the search box as an email, a day or a name word', () => {
    expect(parseSignatureSearch('')).toEqual({ kind: 'all' })
    expect(parseSignatureSearch(' Jordan@Example.com ')).toEqual({ kind: 'email', value: 'jordan@example.com' })
    expect(parseSignatureSearch('2026-10-24')).toEqual({ kind: 'day', value: '2026-10-24' })
    expect(parseSignatureSearch('Lee')).toEqual({ kind: 'name', value: 'lee' })
  })

  it('keys every name and every word of it', () => {
    expect(nameSearchTokens(['Jordan Lee', 'Pat Lee-Ortiz'])).toEqual(
      expect.arrayContaining(['jordan lee', 'jordan', 'lee', 'pat lee-ortiz', 'pat', 'ortiz']),
    )
  })

  it('writes one row per signature in the header’s order', () => {
    const row = signatureCsvRow(
      {
        id: 's1',
        signedAtMs: Date.UTC(2026, 9, 24, 15, 0),
        dayKey: '2026-10-24',
        validThroughDayKey: '2026-10-24',
        waiverTitle: 'Rider release',
        version: 3,
        signer: { name: 'Jordan Lee', email: 'jordan@example.com', phone: '', dateOfBirth: '1990-04-02' },
        minors: [{ name: 'Pat Lee', dateOfBirth: '2014-09-30' }],
        guardianRelationship: 'Parent',
        method: 'online',
        voidedAt: null,
      } as unknown as StoredWaiverSignature,
      'America/Chicago',
    )
    expect(row).toHaveLength(WAIVER_SIGNATURE_CSV_HEADER.length)
    expect(row.slice(1)).toEqual([
      '2026-10-24',
      '2026-10-24',
      'Rider release',
      '3',
      'Jordan Lee',
      'jordan@example.com',
      '',
      '1990-04-02',
      'Pat Lee (2014-09-30)',
      'Parent',
      'Online',
      '',
      's1',
    ])
  })
})
