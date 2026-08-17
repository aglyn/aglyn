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
 * AGL-1652: the override reason vocabulary and its one gate.
 *
 * The point of every case here is that `normalizeOrgOverrideReason` REFUSES
 * rather than defaults. A helper that quietly returned `manual` for an
 * unrecognised code would put a reason on the record that nobody chose,
 * beside a fee change somebody did make — worse than the empty field this
 * issue exists to fill.
 */
import {
  ORG_OVERRIDE_NOTE_MAX,
  ORG_OVERRIDE_REASON_CODES,
  ORG_OVERRIDE_REASON_LABELS,
  isOrgOverrideReasonCode,
  normalizeOrgOverrideReason,
  orgOverrideReasonNeedsNote,
  orgOverrideReasonSummary,
} from './org-override-reason'

describe('org override reason codes', () => {
  it('recognises every published code', () => {
    expect(ORG_OVERRIDE_REASON_CODES.length).toBeGreaterThan(1)
    for (const code of ORG_OVERRIDE_REASON_CODES) {
      expect(isOrgOverrideReasonCode(code)).toBe(true)
    }
  })

  it('refuses codes borrowed from the lockdown vocabulary', () => {
    // The two families deliberately do NOT share a vocabulary — an override
    // is not an incident. If someone widens one set by copying the other,
    // this is the case that says so.
    expect(isOrgOverrideReasonCode('security')).toBe(false)
    expect(isOrgOverrideReasonCode('maintenance')).toBe(false)
    expect(isOrgOverrideReasonCode('manual')).toBe(false)
    expect(isOrgOverrideReasonCode('')).toBe(false)
    expect(isOrgOverrideReasonCode(undefined)).toBe(false)
    expect(isOrgOverrideReasonCode(null)).toBe(false)
  })

  it('labels every code, so no option renders as a bare key', () => {
    for (const code of ORG_OVERRIDE_REASON_CODES) {
      expect(ORG_OVERRIDE_REASON_LABELS[code]).toEqual(expect.any(String))
      expect(ORG_OVERRIDE_REASON_LABELS[code].length).toBeGreaterThan(0)
    }
  })

  it('needs a note for `other` and only for `other`', () => {
    for (const code of ORG_OVERRIDE_REASON_CODES) {
      expect(orgOverrideReasonNeedsNote(code)).toBe(code === 'other')
    }
  })
})

describe('normalizeOrgOverrideReason', () => {
  it('accepts a known code with no note, writing an explicit null', () => {
    const result = normalizeOrgOverrideReason('enterprise')
    expect(result).toEqual({ reason: 'enterprise', note: null })
    // Firestore rejects `undefined`; the field must be present and null.
    expect(Object.keys(result ?? {})).toContain('note')
    expect(result?.note).toBeNull()
  })

  it('trims the note and keeps it', () => {
    expect(normalizeOrgOverrideReason('support', '  refund SLA breach ')).toEqual(
      { reason: 'support', note: 'refund SLA breach' },
    )
  })

  it('refuses an unrecognised code instead of defaulting one', () => {
    expect(normalizeOrgOverrideReason('', 'anything')).toBeNull()
    expect(normalizeOrgOverrideReason(undefined)).toBeNull()
    expect(normalizeOrgOverrideReason('security', 'incident')).toBeNull()
  })

  it('refuses `other` with no note, or a whitespace-only one', () => {
    expect(normalizeOrgOverrideReason('other')).toBeNull()
    expect(normalizeOrgOverrideReason('other', '')).toBeNull()
    expect(normalizeOrgOverrideReason('other', '   \n\t ')).toBeNull()
    expect(normalizeOrgOverrideReason('other', 'legacy contract signed in 2024')).toEqual(
      { reason: 'other', note: 'legacy contract signed in 2024' },
    )
  })

  it('bounds the note rather than writing an unbounded string', () => {
    const long = 'a'.repeat(ORG_OVERRIDE_NOTE_MAX + 500)
    const result = normalizeOrgOverrideReason('correction', long)
    expect(result?.note).toHaveLength(ORG_OVERRIDE_NOTE_MAX)
  })

  it('ignores a non-string note rather than stringifying it', () => {
    // `String({})` is "[object Object]", which would read as a real note.
    expect(normalizeOrgOverrideReason('beta', {})).toEqual({
      reason: 'beta',
      note: null,
    })
    expect(normalizeOrgOverrideReason('other', {})).toBeNull()
  })
})

describe('orgOverrideReasonSummary', () => {
  it('reads as the label alone when there is no note', () => {
    expect(orgOverrideReasonSummary('beta')).toBe(
      ORG_OVERRIDE_REASON_LABELS.beta,
    )
  })

  it('appends the note when there is one', () => {
    expect(orgOverrideReasonSummary('enterprise', 'ACME MSA rate')).toBe(
      `${ORG_OVERRIDE_REASON_LABELS.enterprise} — ACME MSA rate`,
    )
  })

  it('returns null for a row written before AGL-1652', () => {
    // Not an empty string: a surface has to be able to say "this override
    // predates the reason field" rather than render a blank that reads as
    // an override nobody had to explain.
    expect(orgOverrideReasonSummary(undefined)).toBeNull()
    expect(orgOverrideReasonSummary(null, 'orphaned note')).toBeNull()
  })
})
