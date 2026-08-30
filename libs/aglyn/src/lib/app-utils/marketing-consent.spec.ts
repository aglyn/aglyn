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
 * The consent rule, at the level where the rule actually lives.
 *
 * `campaign-send-consent.spec.ts` proves the send path applies it. This file
 * proves what it decides, and in particular that the three states stay three:
 * an absent field is neither a grant nor a refusal, and every collapse of it
 * to one of those is a defect with a large blast radius in one direction or
 * the other.
 */

import {
  DEFAULT_MARKETING_CONSENT_POLICY,
  MARKETING_CONSENT_ENFORCED_FROM_MS,
  marketingConsentVerdict,
  readMarketingBasis,
  resolveMarketingConsentPolicy,
  splitByMarketingConsent,
  type MarketingConsentRecord,
} from './marketing-consent'

const BEFORE = MARKETING_CONSENT_ENFORCED_FROM_MS - 86_400_000
const AFTER = MARKETING_CONSENT_ENFORCED_FROM_MS + 86_400_000

const record = (
  over: Partial<MarketingConsentRecord> = {},
): MarketingConsentRecord => ({
  basis: 'unrecorded',
  basisAtMs: null,
    capturedAtMs: null,
  ...over,
})

describe('reading a basis off a person record', () => {
  it('reads a stored opt-in as granted, and its timestamp', () => {
    expect(
      readMarketingBasis({ marketingConsent: true, marketingConsentAtMs: 42 }),
    ).toMatchObject({ basis: 'granted', basisAtMs: 42 })
  })

  it('reads a stored refusal as declined — the one writer that sets false', () => {
    expect(readMarketingBasis({ marketingConsent: false })).toMatchObject({
      basis: 'declined',
    })
  })

  /**
   * The load-bearing one. Six writers set the field true and exactly one can
   * set it false, so ABSENCE is overwhelmingly "captured before the checkbox
   * existed" and not "said no". Reading it as either grant or refusal is a
   * different disaster: as a grant, the product mails people who never opted
   * in; as a refusal, every audience captured before the checkbox empties.
   */
  it('reads an absent field as unrecorded — neither granted nor declined', () => {
    expect(readMarketingBasis({ email: 'dana@example.com' })).toMatchObject({
      basis: 'unrecorded',
    })
    expect(readMarketingBasis(null)).toMatchObject({ basis: 'unrecorded' })
  })

  it('takes the capture time from createdAt or addedAt, and from a Timestamp', () => {
    expect(readMarketingBasis({ createdAt: 1_000 }).capturedAtMs).toBe(1_000)
    // A list membership stamps `addedAt`, not `createdAt`.
    expect(readMarketingBasis({ addedAt: 2_000 }).capturedAtMs).toBe(2_000)
    // What firebase-admin actually hands back.
    expect(
      readMarketingBasis({ createdAt: { toMillis: () => 3_000 } }).capturedAtMs,
    ).toBe(3_000)
  })
})

describe('the default policy is NOT retroactive', () => {
  it('defaults to forward enforcement for an org that has configured nothing', () => {
    expect(resolveMarketingConsentPolicy(undefined)).toEqual({
      mode: 'forward',
      enforceFromMs: MARKETING_CONSENT_ENFORCED_FROM_MS,
    })
  })

  /**
   * The reachability guarantee. Everybody in the product on the day this
   * ships was captured before the cutoff, so turning the join on removes
   * nobody from an existing audience — it only reports them differently.
   */
  it('keeps a pre-cutoff record with no basis reachable, as grandfathered', () => {
    expect(
      marketingConsentVerdict(
        record({ capturedAtMs: BEFORE }),
        DEFAULT_MARKETING_CONSENT_POLICY,
      ),
    ).toBe('grandfathered')
  })

  /** And the enforcement half: a NEW capture must carry a basis. */
  it('withholds a post-cutoff record with no basis', () => {
    expect(
      marketingConsentVerdict(
        record({ capturedAtMs: AFTER }),
        DEFAULT_MARKETING_CONSENT_POLICY,
      ),
    ).toBe('withheld')
  })

  /**
   * A hand-typed address has no record at all. It leans toward reachable for
   * the same reason the missing-field case does — the unknown must not
   * silently withhold somebody's mail — and it is what keeps a test send to
   * the admin's own address working.
   */
  it('grandfathers a record with no capture time at all', () => {
    expect(
      marketingConsentVerdict(record(), DEFAULT_MARKETING_CONSENT_POLICY),
    ).toBe('grandfathered')
  })

  /**
   * The one enforcement that is unconditional. A stored refusal is a decision
   * the person made, and no policy mode, cutoff or grandfathering may mail
   * over it.
   */
  it('withholds a stored refusal under every mode, whenever it was captured', () => {
    for (const mode of ['forward', 'strict'] as const) {
      expect(
        marketingConsentVerdict(
          record({ basis: 'declined', capturedAtMs: BEFORE }),
          { mode, enforceFromMs: MARKETING_CONSENT_ENFORCED_FROM_MS },
        ),
      ).toBe('withheld')
    }
  })

  it('mails a granted basis under every mode', () => {
    for (const mode of ['forward', 'strict'] as const) {
      expect(
        marketingConsentVerdict(record({ basis: 'granted' }), {
          mode,
          enforceFromMs: MARKETING_CONSENT_ENFORCED_FROM_MS,
        }),
      ).toBe('consented')
    }
  })

  /** The owner's decision, and what it costs — retroactive drops the lot. */
  it('withholds every unrecorded basis once strict is turned on', () => {
    expect(
      marketingConsentVerdict(record({ capturedAtMs: BEFORE }), {
        mode: 'strict',
        enforceFromMs: MARKETING_CONSENT_ENFORCED_FROM_MS,
      }),
    ).toBe('withheld')
  })

  /**
   * A malformed setting must not be a back door out of the join: the failure
   * mode of "off" is mail to people who declined.
   */
  it('falls back to the default rather than to no enforcement', () => {
    expect(resolveMarketingConsentPolicy({ mode: 'off' }).mode).toBe('forward')
    expect(
      resolveMarketingConsentPolicy({ enforceFromMs: 'soon' }).enforceFromMs,
    ).toBe(MARKETING_CONSENT_ENFORCED_FROM_MS)
  })
})

describe('splitting an audience', () => {
  it('names the three populations rather than netting them', () => {
    const split = splitByMarketingConsent(
      ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'],
      new Map([
        ['a@x.com', record({ basis: 'granted' })],
        ['b@x.com', record({ capturedAtMs: BEFORE })],
        ['c@x.com', record({ capturedAtMs: AFTER })],
        ['d@x.com', record({ basis: 'declined' })],
      ]),
      DEFAULT_MARKETING_CONSENT_POLICY,
    )
    expect(split.mailable).toEqual(['a@x.com', 'b@x.com'])
    expect(split.consented).toBe(1)
    expect(split.grandfathered).toBe(1)
    expect(split.withheld).toBe(2)
  })

  /**
   * The withheld ADDRESSES never leave this function. The console surface
   * that reads the split is telling a merchant how their audience divides;
   * handing back the people who declined would turn a consent readout into an
   * export of exactly the population that must not be mailed.
   */
  it('returns counts for the withheld, never their addresses', () => {
    const split = splitByMarketingConsent(
      ['d@x.com'],
      new Map([['d@x.com', record({ basis: 'declined' })]]),
      DEFAULT_MARKETING_CONSENT_POLICY,
    )
    expect(split.mailable).toEqual([])
    expect(JSON.stringify(split)).not.toContain('d@x.com')
  })
})
