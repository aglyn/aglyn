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
 * The console's consent record, read by the rule that decides a send
 * (AGL-3185).
 *
 * Three things a plausible implementation gets wrong silently: a record that
 * carries provenance reads as an OPERATOR's assertion unless it says whose
 * act it is; an unticked box must record nothing and a nothing must be
 * unsendable under the strict policy; and the prompt must never return after
 * an answer, in either direction.
 */

import { soloConsentGroup } from './consent-groups'
import {
  DEFAULT_MARKETING_CONSENT_POLICY,
  declineMarketingConsentFields,
  MARKETING_CONSENT_SOURCE_FIELD,
  marketingConsentDecision,
  marketingConsentFieldsForHost,
  OPERATOR_BACKFILL_CONSENT_KIND,
  readMarketingBasis,
} from './marketing-consent'
import { EMAIL_TOPIC_PRODUCT_UPDATES } from './email-topics'
import {
  isPlatformMarketingConsentSourceKind,
  isPlatformMarketingConsoleSourceKind,
  isPlatformMarketingEmailSourceKind,
  PLATFORM_MARKETING_CONSENT_DECISIONS,
  PLATFORM_MARKETING_CONSOLE_SOURCE_KINDS,
  PLATFORM_MARKETING_EMAIL_SOURCE_KINDS,
  PLATFORM_MARKETING_TOPIC_ID,
  PLATFORM_MARKETING_CONSENT_TEXT,
  PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
  PLATFORM_MARKETING_PROMPT_SNOOZE_MS,
  type PlatformMarketingConsentState,
  platformMarketingConsentSource,
  platformMarketingConsentText,
  platformMarketingEmailSource,
  platformMarketingPromptDue,
  platformMarketingUserFields,
  readPlatformMarketingConsent,
  USER_MARKETING_PROMPT_DISMISSED_AT_FIELD,
} from './platform-marketing-consent'

const HOST = 'host-platform-marketing'
const GROUP = soloConsentGroup(HOST)
const UID = 'uid-console-person'
const NOW = Date.UTC(2026, 8, 20, 12)

const consentSource = (
  decision: 'granted' | 'declined',
  kind: 'console-signup' | 'console-preferences' | 'console-prompt' = 'console-signup',
) =>
  platformMarketingConsentSource({
    kind,
    decision,
    uid: UID,
    atMs: NOW,
    textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
  })

describe('a console decision, as the send rule reads it (AGL-3185)', () => {
  it('a grant with console provenance is consented AND the person’s own act', () => {
    const contact = marketingConsentFieldsForHost(HOST, NOW, {
      [MARKETING_CONSENT_SOURCE_FIELD]: consentSource('granted'),
    })
    const record = readMarketingBasis(contact, GROUP)
    expect(record.basis).toBe('granted')
    expect(record.basisAtMs).toBe(NOW)
    // Provenance survives — which door, which wording, who clicked.
    expect(record.source).toEqual(
      expect.objectContaining({
        kind: 'console-signup',
        by: UID,
        atMs: NOW,
        actor: 'person',
        textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      }),
    )
    expect(record.source?.reason).toMatch(/sign-up/)
    // …and is NOT reported as an operator's assertion, which is what any
    // record carrying provenance read as before the actor field existed.
    expect(record.assertedBy).toBe('person')
    expect(marketingConsentDecision(record, DEFAULT_MARKETING_CONSENT_POLICY)).toEqual({
      verdict: 'consented',
      reason: 'granted',
    })
  })

  it('a refusal with console provenance is withheld as declined, and still the person’s', () => {
    const contact = declineMarketingConsentFields(HOST, NOW, {
      [MARKETING_CONSENT_SOURCE_FIELD]: consentSource('declined', 'console-preferences'),
    })
    const record = readMarketingBasis(contact, GROUP)
    expect(record.basis).toBe('declined')
    expect(record.assertedBy).toBe('person')
    expect(record.source?.kind).toBe('console-preferences')
    expect(marketingConsentDecision(record, DEFAULT_MARKETING_CONSENT_POLICY)).toEqual({
      verdict: 'withheld',
      reason: 'declined',
    })
  })

  it('an unticked sign-up box records nothing, and nothing is unsendable under strict', () => {
    // The sign-up door writes no consent field at all for an unticked box;
    // this is the record such an account leaves, and the flow gate's answer.
    const record = readMarketingBasis({ email: 'nobody@example.com' }, GROUP)
    expect(record.basis).toBe('unrecorded')
    expect(record.assertedBy).toBeNull()
    expect(marketingConsentDecision(record, DEFAULT_MARKETING_CONSENT_POLICY)).toEqual({
      verdict: 'withheld',
      reason: 'no-basis',
    })
  })

  it('provenance that names no actor is still an operator assertion', () => {
    // The backfill's shape, unchanged: kind and by, no actor.
    const contact = marketingConsentFieldsForHost(HOST, NOW, {
      [MARKETING_CONSENT_SOURCE_FIELD]: {
        kind: OPERATOR_BACKFILL_CONSENT_KIND,
        by: 'uid-operator',
        atMs: NOW,
        reason: 'seeded demo audience',
      },
    })
    expect(readMarketingBasis(contact, GROUP).assertedBy).toBe('operator')
  })

  it('a malformed actor reads as an operator, never as the person', () => {
    const contact = marketingConsentFieldsForHost(HOST, NOW, {
      [MARKETING_CONSENT_SOURCE_FIELD]: {
        ...consentSource('granted'),
        actor: 'somebody',
      },
    })
    const record = readMarketingBasis(contact, GROUP)
    expect(record.assertedBy).toBe('operator')
    expect(record.source?.actor).toBeUndefined()
  })
})

describe('the person’s own document', () => {
  it('reads a grant, with its door and wording version', () => {
    const state = readPlatformMarketingConsent(
      platformMarketingUserFields({
        decision: 'granted',
        atMs: NOW,
        source: consentSource('granted', 'console-prompt'),
      }),
    )
    expect(state).toEqual({
      decision: 'granted',
      atMs: NOW,
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      sourceKind: 'console-prompt',
      promptDismissedAtMs: null,
    })
  })

  it('reads a refusal as a refusal, not as nothing', () => {
    const state = readPlatformMarketingConsent(
      platformMarketingUserFields({
        decision: 'declined',
        atMs: NOW,
        source: consentSource('declined', 'console-preferences'),
      }),
    )
    expect(state.decision).toBe('declined')
    expect(state.sourceKind).toBe('console-preferences')
  })

  it('reads an absent document, an empty one and a malformed one as nothing recorded', () => {
    const nothing: PlatformMarketingConsentState = {
      decision: null,
      atMs: null,
      textVersion: null,
      sourceKind: null,
      promptDismissedAtMs: null,
    }
    expect(readPlatformMarketingConsent(null)).toEqual(nothing)
    expect(readPlatformMarketingConsent({})).toEqual(nothing)
    expect(
      readPlatformMarketingConsent({
        marketingConsent: 'yes',
        marketingConsentAtMs: 'yesterday',
        marketingConsentSource: ['not', 'a', 'map'],
        [USER_MARKETING_PROMPT_DISMISSED_AT_FIELD]: Number.NaN,
      }),
    ).toEqual(nothing)
  })

  it('reports a source kind only for a door the console has', () => {
    const state = readPlatformMarketingConsent({
      marketingConsent: true,
      marketingConsentAtMs: NOW,
      marketingConsentSource: { kind: OPERATOR_BACKFILL_CONSENT_KIND, by: 'x' },
    })
    expect(state.decision).toBe('granted')
    expect(state.sourceKind).toBeNull()
  })
})

describe('the one-time prompt', () => {
  it('is due when nothing has ever been recorded', () => {
    expect(
      platformMarketingPromptDue({ decision: null, promptDismissedAtMs: null }, NOW),
    ).toBe(true)
  })

  it('never returns after an answer, in either direction', () => {
    expect(
      platformMarketingPromptDue({ decision: 'declined', promptDismissedAtMs: null }, NOW),
    ).toBe(false)
    expect(
      platformMarketingPromptDue({ decision: 'granted', promptDismissedAtMs: null }, NOW),
    ).toBe(false)
  })

  it('stays away for ninety days after a dismissal, then returns', () => {
    const dismissed: Pick<
      PlatformMarketingConsentState,
      'decision' | 'promptDismissedAtMs'
    > = { decision: null, promptDismissedAtMs: NOW }
    expect(platformMarketingPromptDue(dismissed, NOW)).toBe(false)
    expect(
      platformMarketingPromptDue(dismissed, NOW + PLATFORM_MARKETING_PROMPT_SNOOZE_MS - 1),
    ).toBe(false)
    expect(
      platformMarketingPromptDue(dismissed, NOW + PLATFORM_MARKETING_PROMPT_SNOOZE_MS),
    ).toBe(true)
  })
})

describe('the wording and its provenance', () => {
  it('names the brand and the way out', () => {
    expect(platformMarketingConsentText('Bramble')).toBe(
      'Send me product updates from Bramble. You can opt out any time.',
    )
    expect(PLATFORM_MARKETING_CONSENT_TEXT).toMatch(/opt out any time/)
    expect(PLATFORM_MARKETING_CONSENT_TEXT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('gives every console door a sentence for both decisions', () => {
    for (const kind of PLATFORM_MARKETING_CONSOLE_SOURCE_KINDS) {
      for (const decision of PLATFORM_MARKETING_CONSENT_DECISIONS) {
        const source = platformMarketingConsentSource({
          kind,
          decision,
          uid: UID,
          atMs: NOW,
          textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
        })
        expect(source.kind).toBe(kind)
        expect(source.by).toBe(UID)
        expect(source.actor).toBe('person')
        expect(source.reason.length).toBeGreaterThan(20)
      }
    }
  })
})

describe('the email doors (AGL-3305)', () => {
  it('stands for the built-in Product updates list', () => {
    expect(PLATFORM_MARKETING_TOPIC_ID).toBe(EMAIL_TOPIC_PRODUCT_UPDATES)
    expect(PLATFORM_MARKETING_TOPIC_ID).toBe('product-updates')
  })

  it('keeps the email doors out of what a console request may name', () => {
    for (const kind of PLATFORM_MARKETING_EMAIL_SOURCE_KINDS) {
      expect(isPlatformMarketingEmailSourceKind(kind)).toBe(true)
      expect(isPlatformMarketingConsoleSourceKind(kind)).toBe(false)
      // …while a stored record naming one still reads.
      expect(isPlatformMarketingConsentSourceKind(kind)).toBe(true)
    }
    for (const kind of PLATFORM_MARKETING_CONSOLE_SOURCE_KINDS) {
      expect(isPlatformMarketingConsoleSourceKind(kind)).toBe(true)
      expect(isPlatformMarketingEmailSourceKind(kind)).toBe(false)
    }
  })

  it.each([
    ['email-unsubscribe', 'declined'],
    ['email-preferences', 'declined'],
    ['email-preferences', 'granted'],
    ['email-resubscribe', 'granted'],
  ] as const)('%s / %s is the person’s own act, with no console wording', (kind, decision) => {
    const source = platformMarketingEmailSource({
      kind,
      decision,
      uid: UID,
      atMs: NOW,
    } as Parameters<typeof platformMarketingEmailSource>[0])
    expect(source).toEqual({
      kind,
      by: UID,
      atMs: NOW,
      reason: expect.any(String),
      actor: 'person',
    })
    // A page that versions nothing claims no version.
    expect('textVersion' in source).toBe(false)
    expect(source.reason.length).toBeGreaterThan(20)
  })

  it('reads a decision an email door recorded, door and all', () => {
    const fields = platformMarketingUserFields({
      decision: 'declined',
      atMs: NOW,
      source: platformMarketingEmailSource({
        kind: 'email-unsubscribe',
        decision: 'declined',
        uid: UID,
        atMs: NOW,
      }),
    })
    expect(readPlatformMarketingConsent(fields)).toEqual({
      decision: 'declined',
      atMs: NOW,
      textVersion: null,
      sourceKind: 'email-unsubscribe',
      promptDismissedAtMs: null,
    })
  })
})
