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
  MARKETING_CONSENT_SOURCE_FIELD,
  OPERATOR_BACKFILL_CONSENT_KIND,
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
  assertedBy: null,
  source: null,
  basisAtMs: null,
  capturedAtMs: null,
  ...over,
})

/** The provenance an operator backfill stamps, as it is stored. */
const operatorSource = (over: Record<string, unknown> = {}) => ({
  kind: OPERATOR_BACKFILL_CONSENT_KIND,
  by: 'zach@aglyn.com',
  atMs: 1_000,
  reason: 'pre-release seed data',
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

describe('the default policy is RETROACTIVE while pre-release', () => {
  it('defaults to strict enforcement for an org that has configured nothing', () => {
    expect(resolveMarketingConsentPolicy(undefined)).toEqual({
      mode: 'strict',
      enforceFromMs: MARKETING_CONSENT_ENFORCED_FROM_MS,
    })
  })

  /**
   * The line above is the only place the default's VALUE is written down; this
   * one is why moving it there is enough.
   *
   * `resolveMarketingConsentPolicy` is the sole path from a stored setting to
   * a policy any send applies, so a mode spelled out inside it would be the
   * operative default and {@link DEFAULT_MARKETING_CONSENT_POLICY} would be a
   * constant nothing reads — the exported value could be changed, this file
   * would follow it, and not one campaign would be filtered differently.
   */
  it('takes its fallback FROM the exported default, not from a literal', () => {
    expect(resolveMarketingConsentPolicy(undefined)).toEqual(
      DEFAULT_MARKETING_CONSENT_POLICY,
    )
    expect(resolveMarketingConsentPolicy({ mode: 'off' }).mode).toBe(
      DEFAULT_MARKETING_CONSENT_POLICY.mode,
    )
  })

  /**
   * Nothing is grandfathered. A record predating the cutoff is withheld like
   * any other record without a basis, which is the whole content of the
   * retroactive decision.
   */
  it('withholds a pre-cutoff record with no basis', () => {
    expect(
      marketingConsentVerdict(
        record({ capturedAtMs: BEFORE }),
        DEFAULT_MARKETING_CONSENT_POLICY,
      ),
    ).toBe('withheld')
  })

  /**
   * ⚠️ THE ESCAPE HATCH, which is the thing that must not quietly rot.
   *
   * Strict is only safe here because the product is pre-release and the
   * records it withholds are seed data. A deployment holding a real audience
   * sets `forward` and keeps those people reachable. If grandfathering ever
   * stops working, the default stops being reversible and becomes the only
   * behavior — so this is asserted against an EXPLICIT forward policy rather
   * than against whatever the default happens to be.
   */
  it('still grandfathers under forward, which a live deployment sets', () => {
    expect(
      marketingConsentVerdict(record({ capturedAtMs: BEFORE }), {
        mode: 'forward',
        enforceFromMs: MARKETING_CONSENT_ENFORCED_FROM_MS,
      }),
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
   * Under strict the direction of the unknown reverses: a record carrying
   * neither a basis nor a capture time is withheld rather than reachable.
   *
   * A hand-typed address is exactly this shape, which is why the composer's
   * test send no longer rides on grandfathering — it is carved out explicitly
   * as a proof of your own draft. See the self-proof block in
   * `campaign-send-consent.spec.ts`.
   */
  it('withholds a record with no capture time at all', () => {
    expect(
      marketingConsentVerdict(record(), DEFAULT_MARKETING_CONSENT_POLICY),
    ).toBe('withheld')
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
    expect(resolveMarketingConsentPolicy({ mode: 'off' }).mode).toBe(
      DEFAULT_MARKETING_CONSENT_POLICY.mode,
    )
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
      // FORWARD, deliberately: all three populations only coexist under a
      // non-retroactive policy. What this pins is that the split reports them
      // APART rather than netting them into one number — the property that
      // lets a merchant see what a stricter policy would cost before setting
      // it. Under the strict default the grandfathered column is always 0,
      // which would make this assertion pass while testing nothing.
      { mode: 'forward', enforceFromMs: MARKETING_CONSENT_ENFORCED_FROM_MS },
    )
    expect(split.mailable).toEqual(['a@x.com', 'b@x.com'])
    expect(split.consented).toBe(1)
    expect(split.grandfathered).toBe(1)
    expect(split.withheld).toBe(2)
  })

  /**
   * The same audience under the shipped default. `b@x.com` is reachable above
   * and withheld here on identical data, which is the entire operational
   * consequence of the retroactive decision expressed as one diff.
   */
  it('has no grandfathered population under the strict default', () => {
    const split = splitByMarketingConsent(
      ['a@x.com', 'b@x.com'],
      new Map([
        ['a@x.com', record({ basis: 'granted' })],
        ['b@x.com', record({ capturedAtMs: BEFORE })],
      ]),
      DEFAULT_MARKETING_CONSENT_POLICY,
    )
    expect(split.mailable).toEqual(['a@x.com'])
    expect(split.grandfathered).toBe(0)
    expect(split.withheld).toBe(1)
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

  /**
   * The count that keeps a readout from presenting a backfill as opt-ins. A
   * surface showing only `consented` would report both of these as two people
   * who asked to hear from the merchant, and one of them never did.
   */
  it('separates an operator-asserted basis from a person s own', () => {
    const split = splitByMarketingConsent(
      ['a@x.com', 'b@x.com'],
      new Map([
        ['a@x.com', record({ basis: 'granted', assertedBy: 'person' })],
        ['b@x.com', record({ basis: 'granted', assertedBy: 'operator' })],
      ]),
      DEFAULT_MARKETING_CONSENT_POLICY,
    )
    expect(split.consented).toBe(2)
    expect(split.consentedByOperator).toBe(1)
    // A subset, not a fourth population: both are mailable.
    expect(split.mailable).toEqual(['a@x.com', 'b@x.com'])
  })
})

/**
 * The provenance half of a basis. `marketingConsent: true` says WHAT was
 * recorded; without these fields nothing downstream can say whose act it
 * was, and an assertion an operator made over seed data is then indexed
 * identically to a checkbox somebody ticked.
 */
describe('who asserted a basis', () => {
  it('attributes a bare stored opt-in to the person', () => {
    expect(
      readMarketingBasis({ marketingConsent: true, marketingConsentAtMs: 42 }),
    ).toMatchObject({ basis: 'granted', assertedBy: 'person', source: null })
  })

  it('attributes one carrying a backfill source to the operator', () => {
    const read = readMarketingBasis({
      marketingConsent: true,
      marketingConsentAtMs: 1_000,
      [MARKETING_CONSENT_SOURCE_FIELD]: operatorSource(),
    })
    expect(read.assertedBy).toBe('operator')
    expect(read.source).toEqual({
      kind: OPERATOR_BACKFILL_CONSENT_KIND,
      by: 'zach@aglyn.com',
      atMs: 1_000,
      reason: 'pre-release seed data',
    })
  })

  /**
   * The whole point of the field is that an auditor can tell the two apart.
   * If a backfilled record serialized to the same bytes as a real opt-in
   * there would be nothing to audit.
   */
  it('leaves a backfilled record distinguishable from a real opt-in', () => {
    const optIn = readMarketingBasis({
      marketingConsent: true,
      marketingConsentAtMs: 1_000,
    })
    const backfilled = readMarketingBasis({
      marketingConsent: true,
      marketingConsentAtMs: 1_000,
      [MARKETING_CONSENT_SOURCE_FIELD]: operatorSource(),
    })
    expect(backfilled.basis).toBe(optIn.basis)
    expect(backfilled).not.toEqual(optIn)
    expect(backfilled.assertedBy).not.toBe(optIn.assertedBy)
  })

  it('attributes nothing when there is no basis to attribute', () => {
    expect(readMarketingBasis({ email: 'x@y.com' })).toMatchObject({
      basis: 'unrecorded',
      assertedBy: null,
    })
    expect(readMarketingBasis(null).assertedBy).toBeNull()
  })

  /**
   * A source missing `by` names nobody, so it cannot be the audit trail it
   * exists to be. Reading it as a nameless operator would put a claim in the
   * record that no writer in the product ever makes.
   */
  it('ignores a source that names no one, rather than inventing an operator', () => {
    for (const broken of [
      operatorSource({ by: '' }),
      operatorSource({ kind: '' }),
      'operator-backfill',
      42,
      null,
    ]) {
      const read = readMarketingBasis({
        marketingConsent: true,
        [MARKETING_CONSENT_SOURCE_FIELD]: broken,
      })
      expect(read.source).toBeNull()
      expect(read.assertedBy).toBe('person')
    }
  })

  /**
   * Provenance is not a third mailability. An org that asserted a basis over
   * its own records meant them to be reachable, and making an operator basis
   * withhold would leave the backfill unable to do the one thing it is for.
   */
  it('does not change what the policy decides', () => {
    for (const mode of ['forward', 'strict'] as const) {
      expect(
        marketingConsentVerdict(
          record({ basis: 'granted', assertedBy: 'operator' }),
          { mode, enforceFromMs: MARKETING_CONSENT_ENFORCED_FROM_MS },
        ),
      ).toBe('consented')
    }
  })
})
