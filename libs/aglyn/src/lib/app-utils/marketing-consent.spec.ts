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
  MARKETING_CONSENT_BASIS_FIELD,
  MARKETING_CONSENT_BY_HOST_FIELD,
  MARKETING_CONSENT_ENFORCED_FROM_MS,
  MARKETING_CONSENT_SOURCE_FIELD,
  OPERATOR_ATTESTED_CONSENT_BASIS,
  OPERATOR_ATTESTED_CONSENT_KIND,
  OPERATOR_BACKFILL_CONSENT_KIND,
  declineMarketingConsentFields,
  marketingConsentDecision,
  marketingConsentFieldsForGroup,
  marketingConsentHostIds,
  marketingConsentVerdict,
  readMarketingBasis,
  resolveMarketingConsentPolicy,
  splitByMarketingConsent,
  type MarketingConsentRecord,
} from './marketing-consent'
import { soloConsentGroup } from './consent-groups'

const BEFORE = MARKETING_CONSENT_ENFORCED_FROM_MS - 86_400_000
const AFTER = MARKETING_CONSENT_ENFORCED_FROM_MS + 86_400_000

/** The brand asking. */
const HOST = 'host-lantern'
/** A sister brand in the same agency account. */
const OTHER = 'host-quarry'

/**
 * Each site as its own controller — the undeclared default, and the agency
 * case. Pooling is exercised in `consent-groups.spec.ts` and, where it
 * changes what a basis covers, in the block at the end of this file.
 */
const GROUP = soloConsentGroup(HOST)
const OTHER_GROUP = soloConsentGroup(OTHER)

const record = (
  over: Partial<MarketingConsentRecord> = {},
): MarketingConsentRecord => ({
  hostId: HOST,
  groupId: HOST,
  otherGrant: 'none',
  capturedByHostIds: [],
  capturedByGroup: false,
  basis: 'unrecorded',
  assertedBy: null,
  source: null,
  basisAtMs: null,
  capturedAtMs: null,
  ...over,
})

/**
 * A person document carrying `fields` as ONE host's consent entry.
 *
 * The wrapper is the shape under test. A spec that kept writing the fields at
 * the top of the document would be asserting the pre-host model and would
 * pass against a reader that had lost the host dimension entirely.
 */
const storedFor = (
  hostId: string,
  fields: Record<string, unknown>,
  outer: Record<string, unknown> = {},
) => ({ ...outer, [MARKETING_CONSENT_BY_HOST_FIELD]: { [hostId]: fields } })

/** The provenance an operator backfill stamps, as it is stored. */
const operatorSource = (over: Record<string, unknown> = {}) => ({
  kind: OPERATOR_BACKFILL_CONSENT_KIND,
  by: 'operations@aglyn.com',
  atMs: 1_000,
  reason: 'pre-release seed data',
  ...over,
})

describe('reading a basis off a person record', () => {
  it('reads a stored opt-in as granted, and its timestamp', () => {
    expect(
      readMarketingBasis(
        storedFor(HOST, { marketingConsent: true, marketingConsentAtMs: 42 }), GROUP,
      ),
    ).toMatchObject({ basis: 'granted', basisAtMs: 42 })
  })

  it('reads a stored refusal as declined — the one writer that sets false', () => {
    expect(
      readMarketingBasis(
        storedFor(HOST, { marketingConsent: false }), GROUP,
      ),
    ).toMatchObject({ basis: 'declined' })
  })

  /**
   * The load-bearing one. Six writers set the field true and exactly one can
   * set it false, so ABSENCE is overwhelmingly "captured before the checkbox
   * existed" and not "said no". Reading it as either grant or refusal is a
   * different disaster: as a grant, the product mails people who never opted
   * in; as a refusal, every audience captured before the checkbox empties.
   */
  it('reads an absent field as unrecorded — neither granted nor declined', () => {
    expect(
      readMarketingBasis({ email: 'dana@example.com' }, GROUP),
    ).toMatchObject({ basis: 'unrecorded' })
    expect(readMarketingBasis(null, GROUP)).toMatchObject({
      basis: 'unrecorded',
    })
  })

  it('takes the capture time from createdAt or addedAt, and from a Timestamp', () => {
    expect(readMarketingBasis({ createdAt: 1_000 }, GROUP).capturedAtMs).toBe(
      1_000,
    )
    // A list membership stamps `addedAt`, not `createdAt`.
    expect(readMarketingBasis({ addedAt: 2_000 }, GROUP).capturedAtMs).toBe(
      2_000,
    )
    // What firebase-admin actually hands back.
    expect(
      readMarketingBasis({ createdAt: { toMillis: () => 3_000 } }, GROUP)
        .capturedAtMs,
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
      GROUP,
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
      GROUP,
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
      GROUP,
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
      GROUP,
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
      readMarketingBasis(
        storedFor(HOST, { marketingConsent: true, marketingConsentAtMs: 42 }), GROUP,
      ),
    ).toMatchObject({ basis: 'granted', assertedBy: 'person', source: null })
  })

  it('attributes one carrying a backfill source to the operator', () => {
    const read = readMarketingBasis(
      storedFor(HOST, {
        marketingConsent: true,
        marketingConsentAtMs: 1_000,
        [MARKETING_CONSENT_SOURCE_FIELD]: operatorSource(),
      }), GROUP,
    )
    expect(read.assertedBy).toBe('operator')
    expect(read.source).toEqual({
      kind: OPERATOR_BACKFILL_CONSENT_KIND,
      by: 'operations@aglyn.com',
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
    const optIn = readMarketingBasis(
      storedFor(HOST, { marketingConsent: true, marketingConsentAtMs: 1_000 }), GROUP,
    )
    const backfilled = readMarketingBasis(
      storedFor(HOST, {
        marketingConsent: true,
        marketingConsentAtMs: 1_000,
        [MARKETING_CONSENT_SOURCE_FIELD]: operatorSource(),
      }), GROUP,
    )
    expect(backfilled.basis).toBe(optIn.basis)
    expect(backfilled).not.toEqual(optIn)
    expect(backfilled.assertedBy).not.toBe(optIn.assertedBy)
  })

  /**
   * A LIST MEMBERSHIP says who asserted its basis in a different field.
   *
   * `list-members.ts` writes `marketingConsentBasis` and the attesting
   * account; nothing writes a backfill's provenance object onto a membership.
   * Reading only the provenance field therefore reported every address a
   * merchant added by hand — and every address an import brings in — as a
   * checkbox the person ticked, on the exact records where that claim is
   * least true. The send-time join reads a membership through this function.
   */
  it('attributes an attested MEMBERSHIP to the operator', () => {
    const read = readMarketingBasis(
      storedFor(HOST, {
        marketingConsent: true,
        marketingConsentAtMs: 1_000,
        [MARKETING_CONSENT_BASIS_FIELD]: OPERATOR_ATTESTED_CONSENT_BASIS,
        marketingConsentByUid: 'editor-uid',
        marketingConsentReason: 'Imported from a file.',
      }), GROUP,
    )
    expect(read.assertedBy).toBe('operator')
    expect(read.source).toEqual({
      kind: OPERATOR_ATTESTED_CONSENT_KIND,
      by: 'editor-uid',
      atMs: 1_000,
      reason: 'Imported from a file.',
    })
  })

  it('attributes a membership carrying the PERSON’s opt-in to the person', () => {
    expect(
      readMarketingBasis(
        storedFor(HOST, {
          marketingConsent: true,
          marketingConsentAtMs: 1_000,
          [MARKETING_CONSENT_BASIS_FIELD]: 'contact-opt-in',
          marketingConsentByUid: null,
        }), GROUP,
      ),
    ).toMatchObject({ assertedBy: 'person', source: null })
  })

  /**
   * Losing the uid must not lose the attestation. The basis field is
   * unambiguous on its own, and falling back to "the person's own act"
   * because an attribution went missing is the one direction this may never
   * fail in.
   */
  it('still reads an attested membership as the operator’s with no account on it', () => {
    const read = readMarketingBasis(
      storedFor(HOST, {
        marketingConsent: true,
        [MARKETING_CONSENT_BASIS_FIELD]: OPERATOR_ATTESTED_CONSENT_BASIS,
      }), GROUP,
    )
    expect(read.assertedBy).toBe('operator')
    expect(read.source?.by).toBe('')
  })

  it('lets a backfill provenance outrank the membership basis field', () => {
    const read = readMarketingBasis(
      storedFor(HOST, {
        marketingConsent: true,
        marketingConsentAtMs: 1_000,
        [MARKETING_CONSENT_SOURCE_FIELD]: operatorSource(),
        [MARKETING_CONSENT_BASIS_FIELD]: OPERATOR_ATTESTED_CONSENT_BASIS,
      }), GROUP,
    )
    expect(read.source?.kind).toBe(OPERATOR_BACKFILL_CONSENT_KIND)
  })

  it('attributes nothing when there is no basis to attribute', () => {
    expect(readMarketingBasis({ email: 'x@y.com' }, GROUP)).toMatchObject({
      basis: 'unrecorded',
      assertedBy: null,
    })
    expect(readMarketingBasis(null, GROUP).assertedBy).toBeNull()
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
      const read = readMarketingBasis(
        storedFor(HOST, {
          marketingConsent: true,
          [MARKETING_CONSENT_SOURCE_FIELD]: broken,
        }), GROUP,
      )
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

/**
 * The defect this module was rebuilt for: consent given to one brand reaching
 * every brand in the same account.
 *
 * Every assertion here names WHICH host's grant was read. A spec that only
 * checked `basis` would pass against a reader that returned the first grant
 * it found, which is the bug.
 */
describe('a basis belongs to the brand it was given to', () => {
  const grantedTo = (hostId: string) =>
    storedFor(hostId, { marketingConsent: true, marketingConsentAtMs: 1_000 })

  it('mails the host that holds the grant', () => {
    expect(readMarketingBasis(grantedTo(HOST), GROUP)).toMatchObject({
      hostId: HOST,
      basis: 'granted',
      otherGrant: 'none',
    })
  })

  /** The leak, stated as an assertion. */
  it('refuses a sister brand the grant it was never given', () => {
    const read = readMarketingBasis(grantedTo(HOST), OTHER_GROUP)
    expect(read.hostId).toBe(OTHER)
    expect(read.basis).toBe('unrecorded')
    expect(read.otherGrant).toBe('other-host')
    expect(
      marketingConsentDecision(read, DEFAULT_MARKETING_CONSENT_POLICY),
    ).toEqual({ verdict: 'withheld', reason: 'other-host' })
  })

  /**
   * ANTI-VACUITY. The two assertions above would both pass against a reader
   * that refused everybody — the leak closed by mailing nobody. This is the
   * control that says the door still opens: identical data, and the host that
   * owns the grant is mailable while the one that does not is not.
   */
  it('opens for the granting host on the very data it closes for the other', () => {
    const document = grantedTo(HOST)
    const policy = DEFAULT_MARKETING_CONSENT_POLICY
    expect(
      marketingConsentVerdict(readMarketingBasis(document, GROUP), policy),
    ).toBe('consented')
    expect(
      marketingConsentVerdict(readMarketingBasis(document, OTHER_GROUP), policy),
    ).toBe('withheld')
  })

  it('accumulates grants rather than replacing them', () => {
    const both = {
      [MARKETING_CONSENT_BY_HOST_FIELD]: {
        [HOST]: { marketingConsent: true, marketingConsentAtMs: 1 },
        [OTHER]: { marketingConsent: true, marketingConsentAtMs: 2 },
      },
    }
    expect(readMarketingBasis(both, GROUP).basis).toBe('granted')
    expect(readMarketingBasis(both, OTHER_GROUP).basis).toBe('granted')
    expect(marketingConsentHostIds(both)).toEqual([HOST, OTHER].sort())
  })

  /**
   * A REFUSAL is one brand's business too. Somebody who unsubscribed from one
   * client's newsletter has not left the other eleven, and reading a sister
   * brand's `false` as a signal here would be the same over-application
   * pointed the other way.
   */
  it('does not let one brand’s refusal decide another brand’s send', () => {
    const document = {
      [MARKETING_CONSENT_BY_HOST_FIELD]: {
        [HOST]: { marketingConsent: true, marketingConsentAtMs: 1 },
        [OTHER]: { marketingConsent: false, marketingConsentAtMs: 2 },
      },
    }
    expect(readMarketingBasis(document, GROUP)).toMatchObject({
      basis: 'granted',
      otherGrant: 'none',
    })
    expect(readMarketingBasis(document, OTHER_GROUP).basis).toBe('declined')
  })
})

/**
 * The five states, kept apart.
 *
 * Three of them are `withheld`, and merging any two is a defect: merged into
 * `granted`, an agency mails another client's list; merged into each other,
 * nobody can tell an un-opted-in audience from one that opted in elsewhere,
 * and the fix becomes unverifiable.
 */
describe('the states that must not collapse', () => {
  const policy = DEFAULT_MARKETING_CONSENT_POLICY

  it('tells no basis apart from a basis held elsewhere apart from a refusal', () => {
    const decide = (document: Record<string, unknown>) =>
      marketingConsentDecision(readMarketingBasis(document, GROUP), policy)

    expect(decide({ email: 'nobody@x.test' })).toEqual({
      verdict: 'withheld',
      reason: 'no-basis',
    })
    expect(
      decide(storedFor(OTHER, { marketingConsent: true })),
    ).toEqual({ verdict: 'withheld', reason: 'other-host' })
    expect(decide(storedFor(HOST, { marketingConsent: false }))).toEqual({
      verdict: 'withheld',
      reason: 'declined',
    })
    expect(decide(storedFor(HOST, { marketingConsent: true }))).toEqual({
      verdict: 'consented',
      reason: 'granted',
    })
  })

  /**
   * The pre-host field, read asymmetrically. A `true` there names no
   * controller and grants to nobody; a `false` there names no controller
   * either, and is honored against everybody — hiding is recoverable, sending
   * is not.
   */
  it('reads an unscoped grant as nobody’s and an unscoped refusal as everybody’s', () => {
    const grant = readMarketingBasis({ marketingConsent: true }, GROUP)
    expect(grant.basis).toBe('unrecorded')
    expect(grant.otherGrant).toBe('unscoped')

    for (const group of [GROUP, OTHER_GROUP]) {
      expect(readMarketingBasis({ marketingConsent: false }, group).basis).toBe(
        'declined',
      )
    }
  })

  /**
   * An unscoped refusal outranks this host's own grant. The refusal may have
   * been recorded after the capture that wrote the entry, and the two cannot
   * be ordered from what is stored.
   */
  it('lets an unscoped refusal outrank a host’s own grant', () => {
    expect(
      readMarketingBasis(
        storedFor(HOST, { marketingConsent: true }, { marketingConsent: false }), GROUP,
      ).basis,
    ).toBe('declined')
  })

  it('counts the three withheld populations apart', () => {
    const split = splitByMarketingConsent(
      ['none@x.test', 'elsewhere@x.test', 'no@x.test', 'yes@x.test'],
      new Map([
        ['none@x.test', record()],
        ['elsewhere@x.test', record({ otherGrant: 'other-host' })],
        ['no@x.test', record({ basis: 'declined' })],
        ['yes@x.test', record({ basis: 'granted' })],
      ]),
      DEFAULT_MARKETING_CONSENT_POLICY,
      GROUP,
    )
    expect(split.withheld).toBe(3)
    expect(split.withheldNoBasis).toBe(1)
    expect(split.withheldOtherHost).toBe(1)
    expect(split.withheldDeclined).toBe(1)
    expect(split.mailable).toEqual(['yes@x.test'])
  })
})

/**
 * Grandfathering is a claim about a capture, so it belongs to the capturer.
 *
 * Under `forward` a record with no basis stays reachable because it predates
 * enforcement — an argument made on behalf of the brand that collected the
 * address. A sister brand inherits none of that by sharing an address book,
 * and letting it would put the leak back through the one door the policy
 * leaves open.
 */
describe('grandfathering does not cross brands', () => {
  const forward = {
    mode: 'forward' as const,
    enforceFromMs: MARKETING_CONSENT_ENFORCED_FROM_MS,
  }

  it('grandfathers for the capturing host', () => {
    expect(
      marketingConsentDecision(
        record({ capturedAtMs: BEFORE, capturedByHostIds: [HOST], capturedByGroup: true }),
        forward,
      ),
    ).toEqual({ verdict: 'grandfathered', reason: 'grandfathered' })
  })

  it('refuses to grandfather another brand’s capture', () => {
    expect(
      marketingConsentDecision(
        record({ capturedAtMs: BEFORE, capturedByHostIds: [OTHER] }),
        forward,
      ),
    ).toEqual({ verdict: 'withheld', reason: 'other-host' })
  })

  /**
   * An unattributed capture still grandfathers. The argument has nobody to
   * belong to and nobody to exclude, so the unknown leans toward reachable —
   * the same direction a missing capture DATE already leans.
   */
  it('grandfathers a capture nobody is attributed with', () => {
    expect(
      marketingConsentDecision(
        record({ capturedAtMs: BEFORE, capturedByHostIds: [] }),
        forward,
      ).verdict,
    ).toBe('grandfathered')
  })

  /** A grant elsewhere ends it: consent WAS collected, and not by this host. */
  it('refuses to grandfather over a grant held by another brand', () => {
    expect(
      marketingConsentDecision(
        record({ capturedAtMs: BEFORE, otherGrant: 'other-host' }),
        forward,
      ),
    ).toEqual({ verdict: 'withheld', reason: 'other-host' })
  })

  it('reads the capture host from the contacts field and its older name', () => {
    expect(readMarketingBasis({ capturedByHostIds: [HOST] }, OTHER_GROUP)).toMatchObject(
      { capturedByHostIds: [HOST] },
    )
    // `contacts` has stamped the capturing host under `hostId` since the
    // collection existed; ignoring it would report every contact in the
    // product as unattributed.
    expect(readMarketingBasis({ hostId: HOST }, OTHER_GROUP)).toMatchObject({
      capturedByHostIds: [HOST],
    })
  })
})

/**
 * The wiring guard. A consent map is built where the documents are read and
 * consumed somewhere else, and between those points the host can be lost — a
 * helper handed one id and passing another, a map cached and reused for a
 * second site. The result would be one brand's grants deciding another
 * brand's send, with every count still adding up.
 */
describe('a map read for one host cannot decide another host’s send', () => {
  it('refuses rather than mailing on a grant read for someone else', () => {
    expect(() =>
      splitByMarketingConsent(
        ['a@x.test'],
        new Map([['a@x.test', record({ hostId: OTHER, groupId: OTHER, basis: 'granted' })]]),
        DEFAULT_MARKETING_CONSENT_POLICY, GROUP,
      ),
    ).toThrow(/cannot decide a send from/)
  })

  /** ANTI-VACUITY: the same call with the hosts agreeing does send. */
  it('does not refuse a map read for the host that is sending', () => {
    expect(
      splitByMarketingConsent(
        ['a@x.test'],
        new Map([['a@x.test', record({ hostId: HOST, groupId: HOST, basis: 'granted' })]]),
        DEFAULT_MARKETING_CONSENT_POLICY,
        GROUP,
      ).mailable,
    ).toEqual(['a@x.test'])
  })

  it('fills a missing entry for the host that is asking, not for none', () => {
    const split = splitByMarketingConsent(
      ['stranger@x.test'],
      new Map(),
      DEFAULT_MARKETING_CONSENT_POLICY,
      GROUP,
    )
    expect(split.withheld).toBe(1)
    expect(split.withheldNoBasis).toBe(1)
  })
})

/** The map that a corrupt value must not turn into a grant. */
describe('a malformed consent map grants nothing', () => {
  it.each([
    ['a string', 'granted'],
    ['an array', [{ marketingConsent: true }]],
    ['a number', 42],
    ['null', null],
  ])('reads %s as no basis at all', (_name, value) => {
    expect(
      readMarketingBasis({ [MARKETING_CONSENT_BY_HOST_FIELD]: value }, GROUP),
    ).toMatchObject({ basis: 'unrecorded', otherGrant: 'none' })
  })

  it('ignores a non-object entry beside a real one', () => {
    const document = {
      [MARKETING_CONSENT_BY_HOST_FIELD]: {
        [HOST]: { marketingConsent: true },
        [OTHER]: 'yes',
      },
    }
    expect(readMarketingBasis(document, GROUP).basis).toBe('granted')
    expect(readMarketingBasis(document, OTHER_GROUP).basis).toBe('unrecorded')
  })
})

/** The write helpers, which are what make the omission impossible. */
describe('recording a basis names the brand', () => {
  it('nests the grant under the host, leaving room for the others', () => {
    expect(marketingConsentFieldsForGroup(GROUP, 7)).toEqual({
      [MARKETING_CONSENT_BY_HOST_FIELD]: {
        [HOST]: { marketingConsent: true, marketingConsentAtMs: 7 },
      },
    })
  })

  it('carries provenance into the entry so an assertion stays one', () => {
    const fields = marketingConsentFieldsForGroup(GROUP, 7, {
      [MARKETING_CONSENT_SOURCE_FIELD]: operatorSource(),
    })
    expect(readMarketingBasis(fields, GROUP).assertedBy).toBe('operator')
  })

  it('refuses to record a basis for no host', () => {
    expect(() => marketingConsentFieldsForGroup({ ...GROUP, hostIds: [] }, 7)).toThrow(/no host/)
    expect(() => declineMarketingConsentFields('', 7)).toThrow(/no host/)
  })

  it('records a refusal against one host and nobody else', () => {
    const fields = declineMarketingConsentFields(HOST, 7)
    expect(readMarketingBasis(fields, GROUP).basis).toBe('declined')
    expect(readMarketingBasis(fields, OTHER_GROUP).basis).toBe('unrecorded')
  })

  it('reports the hosts holding a grant, and none for a refusal', () => {
    expect(marketingConsentHostIds(marketingConsentFieldsForGroup(GROUP, 7))).toEqual([
      HOST,
    ])
    expect(marketingConsentHostIds(declineMarketingConsentFields(HOST, 7))).toEqual(
      [],
    )
    expect(
      marketingConsentHostIds({
        ...marketingConsentFieldsForGroup(GROUP, 7),
        marketingConsent: false,
      }),
    ).toEqual([])
  })
})

/**
 * POOLING — the other organization this has to serve.
 *
 * A business running three sites under one name is one controller, and a
 * grant collected on one of them legitimately covers all three. The
 * declaration is what separates that from an agency's twelve clients; these
 * are the consent-side consequences of it.
 */
describe('a declared group is ONE sender', () => {
  const POOLED = {
    hostId: HOST,
    groupId: 'northwind',
    name: 'Northwind Group',
    hostIds: [HOST, OTHER],
    declared: true,
  }
  const POOLED_FROM_OTHER = { ...POOLED, hostId: OTHER }
  const now = 1_000

  it('records one grant against every site the disclosure named', () => {
    const fields = marketingConsentFieldsForGroup(POOLED, now)
    expect(readMarketingBasis(fields, POOLED).basis).toBe('granted')
    expect(readMarketingBasis(fields, POOLED_FROM_OTHER).basis).toBe('granted')
  })

  /**
   * ANTI-VACUITY, and the agency's guarantee. The same grant read by a site
   * the declaration did NOT name is still nobody's.
   */
  it('reaches no site the disclosure did not name', () => {
    const fields = marketingConsentFieldsForGroup(POOLED, now)
    const stranger = soloConsentGroup('host-unrelated')
    expect(readMarketingBasis(fields, stranger)).toMatchObject({
      basis: 'unrecorded',
      otherGrant: 'other-host',
    })
  })

  /** What was DISCLOSED travels with the grant, for the audit trail. */
  it('stores the group that was shown to the person', () => {
    const entry = (marketingConsentFieldsForGroup(POOLED, now) as any)[
      MARKETING_CONSENT_BY_HOST_FIELD
    ][HOST]
    expect(entry.consentGroupId).toBe('northwind')
    expect(entry.consentGroupName).toBe('Northwind Group')
  })

  /**
   * ⛔ POOLING IS FORWARD-ONLY.
   *
   * A grant made while a site was alone must not widen when that site later
   * joins a group: the people already on the list were told a different
   * thing. The grant is read under the ASKING site's own key, so a group
   * declared afterwards finds nothing there.
   */
  it('does not widen a grant made before the group was declared', () => {
    const beforeDeclaration = marketingConsentFieldsForGroup(
      soloConsentGroup(HOST),
      now,
    )
    expect(readMarketingBasis(beforeDeclaration, POOLED).basis).toBe('granted')
    expect(readMarketingBasis(beforeDeclaration, POOLED_FROM_OTHER).basis).toBe(
      'unrecorded',
    )
  })

  /**
   * ⛔ AND OPT-OUT RUNS THE OTHER WAY.
   *
   * Three sites presenting as one sender are one sender to the person
   * leaving them, and making them unsubscribe three times is both hostile
   * and wrong. A refusal recorded against one member is honored across the
   * CURRENT group — so a site that JOINS inherits it, which is the direction
   * that can only ever withhold.
   */
  it('honors a refusal given to one member across the whole group', () => {
    const refused = declineMarketingConsentFields(HOST, now)
    expect(readMarketingBasis(refused, POOLED).basis).toBe('declined')
    expect(readMarketingBasis(refused, POOLED_FROM_OTHER).basis).toBe('declined')
    // And not beyond it: an unrelated brand is unaffected by somebody else's
    // unsubscribe, which is the same over-application pointed the other way.
    expect(
      readMarketingBasis(refused, soloConsentGroup('host-unrelated')).basis,
    ).toBe('unrecorded')
  })

  /** A refusal outranks a pooled grant, whichever member holds either. */
  it('lets one member’s refusal outrank another member’s grant', () => {
    const document = {
      ...marketingConsentFieldsForGroup(POOLED, now),
      [MARKETING_CONSENT_BY_HOST_FIELD]: {
        ...(marketingConsentFieldsForGroup(POOLED, now) as any)[
          MARKETING_CONSENT_BY_HOST_FIELD
        ],
        [OTHER]: { marketingConsent: false, marketingConsentAtMs: now + 1 },
      },
    }
    expect(readMarketingBasis(document, POOLED).basis).toBe('declined')
  })

  /**
   * Grandfathering follows the group: a capture by any member was made by
   * the sender the person was dealing with.
   */
  it('grandfathers on a capture made by any member of the group', () => {
    const forward = {
      mode: 'forward' as const,
      enforceFromMs: MARKETING_CONSENT_ENFORCED_FROM_MS,
    }
    const captured = { createdAt: BEFORE, capturedByHostIds: [OTHER] }
    expect(
      marketingConsentDecision(readMarketingBasis(captured, POOLED), forward)
        .verdict,
    ).toBe('grandfathered')
    // ANTI-VACUITY: the same record read by a site OUTSIDE the group is
    // still refused, so this is the declaration doing the work.
    expect(
      marketingConsentDecision(
        readMarketingBasis(captured, soloConsentGroup(HOST)),
        forward,
      ),
    ).toEqual({ verdict: 'withheld', reason: 'other-host' })
  })

  /** A send may not use a map resolved for a different CONTROLLER either. */
  it('refuses a map resolved for another group', () => {
    expect(() =>
      splitByMarketingConsent(
        ['a@x.test'],
        new Map([
          ['a@x.test', { ...record({ basis: 'granted' }), groupId: 'other' }],
        ]),
        DEFAULT_MARKETING_CONSENT_POLICY,
        GROUP,
      ),
    ).toThrow(/cannot decide a send from/)
  })
})
