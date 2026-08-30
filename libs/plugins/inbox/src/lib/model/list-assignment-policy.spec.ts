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
 * The enrollment rule, with no Firestore under it.
 *
 * WHAT THESE ASSERTIONS ARE FOR, so a false green is visible: the module has
 * no I/O, so nothing here is doubled and every input is a literal. What they
 * certify is the three-way split — a stored refusal, a stored opt-in, and the
 * far commoner absence of either — and, above all, that an attestation cannot
 * reach the first of them.
 */

import {
  assignmentBasis,
  assignmentReadout,
} from './list-assignment-policy'
import type { MarketingConsentRecord } from '@aglyn/aglyn/server'

const NOW = Date.UTC(2026, 7, 29)
const OPTED_IN_AT = Date.UTC(2025, 2, 14)

const record = (
  basis: MarketingConsentRecord['basis'],
  basisAtMs: number | null = null,
): MarketingConsentRecord => ({ basis, basisAtMs, capturedAtMs: null })

const decide = (
  stored: MarketingConsentRecord,
  attested: boolean,
) =>
  assignmentBasis({ stored, attested, actingUid: 'editor-uid', nowMs: NOW })

describe('a stored refusal', () => {
  it('refuses, with nothing asserted', () => {
    expect(decide(record('declined'), false)).toEqual({ refusal: 'declined' })
  })

  /*
   * THE ONE THAT MATTERS. Every standalone ESP lets a merchant add an address
   * by hand, and this product does too — but an attestation is a claim about
   * permission the merchant believes they have, and a stored `declined` is
   * this person having already said otherwise ON THE RECORD. If asserting
   * could reach past it there would be no difference between recording a
   * refusal and discarding one.
   */
  it('refuses an ATTESTATION too, which is the whole point of storing it', () => {
    expect(decide(record('declined'), true)).toEqual({ refusal: 'declined' })
  })

  it('is refused even when the refusal is the newest thing on the record', () => {
    expect(decide(record('declined', NOW - 1), true)).toEqual({
      refusal: 'declined',
    })
  })

  it('offers no attestation control and says there is no override', () => {
    const readout = assignmentReadout({
      stored: record('declined'),
      suppression: null,
    })
    expect(readout.enrollable).toBe(false)
    expect(readout.requiresAttestation).toBe(false)
    expect(readout.summary).toContain('no way to override')
  })
})

describe('a stored opt-in', () => {
  it('passes through as `contact-opt-in`, attributable to nobody', () => {
    expect(decide(record('granted', OPTED_IN_AT), false)).toEqual({
      basis: 'contact-opt-in',
      atMs: OPTED_IN_AT,
      byUid: null,
    })
  })

  /*
   * The PERSON'S date, not the merchant's click. Restamping it would report
   * every historical opt-in as having happened now, which walks records
   * across the forward cutoff `MARKETING_CONSENT_ENFORCED_FROM_MS`
   * grandfathers on — so the same enrollment would be reachable before the
   * button was pressed and withheld after it.
   */
  it('keeps the date the person said yes, not the date they were added', () => {
    const decision = decide(record('granted', OPTED_IN_AT), false)
    expect('basis' in decision && decision.atMs).toBe(OPTED_IN_AT)
    expect('basis' in decision && decision.atMs).not.toBe(NOW)
  })

  it('does not become an attestation just because one was offered', () => {
    expect(decide(record('granted', OPTED_IN_AT), true)).toEqual({
      basis: 'contact-opt-in',
      atMs: OPTED_IN_AT,
      byUid: null,
    })
  })

  it('needs no assertion from the merchant', () => {
    const readout = assignmentReadout({
      stored: record('granted', OPTED_IN_AT),
      suppression: null,
    })
    expect(readout.enrollable).toBe(true)
    expect(readout.requiresAttestation).toBe(false)
  })
})

describe('no record either way', () => {
  it('refuses when the merchant asserts nothing', () => {
    expect(decide(record('unrecorded'), false)).toEqual({ refusal: 'no-basis' })
  })

  it('becomes an attestation carrying the account that made it', () => {
    expect(decide(record('unrecorded'), true)).toEqual({
      basis: 'operator-attested',
      atMs: NOW,
      byUid: 'editor-uid',
    })
  })

  /*
   * Absence is not refusal (`marketing-consent.ts`), so this state is
   * enrollable — and it is the state that must SAY SO on screen, because a
   * merchant who is not told there is no opt-in on file will assume the form
   * submission was one.
   */
  it('tells the merchant the submission was not an opt-in', () => {
    const readout = assignmentReadout({
      stored: record('unrecorded'),
      suppression: null,
    })
    expect(readout.enrollable).toBe(true)
    expect(readout.requiresAttestation).toBe(true)
    expect(readout.summary).toContain('no marketing opt-in on record')
    expect(readout.summary).toContain('does not create one')
  })
})

describe('a suppressed address', () => {
  /*
   * Suppression outranks consent in the readout: a person may have opted in
   * and then hard-bounced or reported spam, and the answer is the same either
   * way. Reporting the opt-in there would offer a control that the enrollment
   * route refuses at its own suppression check.
   */
  it('is not enrollable however good its consent record is', () => {
    const readout = assignmentReadout({
      stored: record('granted', OPTED_IN_AT),
      suppression: 'suppressed-platform',
    })
    expect(readout.enrollable).toBe(false)
    expect(readout.requiresAttestation).toBe(false)
    expect(readout.summary).toContain('bounced')
  })

  it('names the site list when that is what holds it', () => {
    expect(
      assignmentReadout({
        stored: record('unrecorded'),
        suppression: 'suppressed-host',
      }).summary,
    ).toContain('unsubscribed')
  })
})
