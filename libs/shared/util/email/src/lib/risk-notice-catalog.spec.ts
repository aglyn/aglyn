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
 * The risk notice catalog (AGL-3368): complete for every kind, owners never
 * handed a release, and nothing in the owner half that teaches a fraud actor
 * how the screen works. Where each action's path lands is pinned in the
 * console's `risk-notice-routes.spec.ts`, which can see the page tree.
 */

import { PHISHING_SCREEN_BRANDS } from './outbound-phishing-screen'
import {
  isRiskEventKind,
  renderOwnerRiskNotice,
  renderRiskNoticeText,
  resolveOwnerRiskActions,
  resolveRiskActionHref,
  RISK_EVENT_KINDS,
  RISK_NOTICE_CATALOG,
  RISK_NOTICE_CLOSING_KINDS,
  RISK_NOTICE_TOKENS,
  RISK_NOTICE_WORKSPACE_BRANDED,
  RISK_OWNER_ACTION_IDS,
  RISK_OWNER_ACTIONS,
  RISK_STAFF_ACTION_IDS,
  RISK_STAFF_ACTIONS,
  riskKindForAbuseRow,
  riskNoticeEmailKey,
} from './risk-notice-catalog'
import { RISK_NOTICE_SYSTEM_EMAIL_TEMPLATES, RISK_REVIEW_REQUESTED_EMAIL_KEY } from './risk-notice-emails'
import { getSystemEmailTemplate } from './system-email-catalog'

const ownerText = (kind: (typeof RISK_EVENT_KINDS)[number]) => {
  const definition = RISK_NOTICE_CATALOG[kind]
  return [
    definition.owner.title,
    definition.owner.summary,
    definition.owner.meaning,
    ...definition.owner.steps,
    ...definition.owner.actions.flatMap((id) => [RISK_OWNER_ACTIONS[id].label, RISK_OWNER_ACTIONS[id].hint]),
  ]
}

describe('every kind is complete', () => {
  it.each(RISK_EVENT_KINDS)('%s has every field, for both audiences', (kind) => {
    const definition = RISK_NOTICE_CATALOG[kind]
    expect(definition.kind).toBe(kind)
    expect(['info', 'warning', 'urgent']).toContain(definition.severity)
    expect(typeof definition.emailOwners).toBe('boolean')
    expect(typeof definition.alertStaff).toBe('boolean')
    expect(definition.helpAnchor).toMatch(/^[a-z-]+$/)
    for (const text of [definition.owner.title, definition.owner.summary, definition.owner.meaning]) {
      expect(text.trim().length).toBeGreaterThan(10)
    }
    expect(definition.owner.steps.length).toBeGreaterThan(0)
    expect(definition.staff.title.trim()).not.toBe('')
    expect(definition.staff.summary.trim()).not.toBe('')
    // An action for each audience, from the known set.
    expect(definition.owner.actions.length).toBeGreaterThan(0)
    expect(definition.staff.actions.length).toBeGreaterThan(0)
    for (const id of definition.owner.actions) expect(RISK_OWNER_ACTION_IDS).toContain(id)
    for (const id of definition.staff.actions) expect(RISK_STAFF_ACTION_IDS).toContain(id)
  })

  it('writes every template against tokens the seam fills', () => {
    const known = new Set([...Object.keys(RISK_NOTICE_TOKENS), 'brand.productName'])
    for (const kind of RISK_EVENT_KINDS) {
      const definition = RISK_NOTICE_CATALOG[kind]
      const texts = [...ownerText(kind), definition.staff.title, definition.staff.summary]
      for (const text of texts) {
        for (const match of text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
          expect({ kind, token: match[1], known: known.has(match[1]) }).toEqual({
            kind,
            token: match[1],
            known: true,
          })
        }
      }
    }
  })

  it('never renders a hole where a token had no value', () => {
    for (const kind of RISK_EVENT_KINDS) {
      const rendered = renderOwnerRiskNotice(kind, {})
      expect(JSON.stringify(rendered)).not.toMatch(/\{\{|\}\}/)
    }
    expect(renderRiskNoticeText('Held on {{occurredAt}}.', {})).toBe('Held on a recent date.')
  })

  it('closes every held kind with kinds that exist, and only reviewable kinds offer a review', () => {
    for (const kind of RISK_EVENT_KINDS) {
      const definition = RISK_NOTICE_CATALOG[kind]
      if (definition.closesWith) {
        expect(isRiskEventKind(definition.closesWith.released)).toBe(true)
        expect(isRiskEventKind(definition.closesWith.rejected)).toBe(true)
        expect(definition.reviewable).toBe(true)
      }
      if (definition.owner.actions.includes('request-review')) expect(definition.reviewable).toBe(true)
      if (definition.reviewable && !RISK_NOTICE_CLOSING_KINDS.has(kind)) {
        expect(definition.owner.actions).toContain('request-review')
      }
    }
  })

  it('always sends a lock, a lift and a cancellation on its own, by email', () => {
    for (const kind of RISK_EVENT_KINDS) {
      if (!/-locked$|-unlocked$|^subscription-canceled$/.test(kind)) continue
      expect(RISK_NOTICE_CATALOG[kind]).toMatchObject({ neverDigest: true, emailOwners: true })
    }
  })

  it('brands only the workspace’s own customers’ payments as the workspace', () => {
    for (const kind of RISK_NOTICE_WORKSPACE_BRANDED) {
      expect(kind).toMatch(/^(sale-|gift-card-hold$|marketplace-sale-warning$)/)
    }
  })
})

describe('owners can never self-release', () => {
  it('offers no owner action that is a staff decision or a staff page', () => {
    const staffIds = new Set<string>(RISK_STAFF_ACTION_IDS)
    // The one release an owner makes is of their OWN merchant hold — the gift
    // cards their store froze on a questioned payment — never a platform one.
    const merchantOwnDecisions = new Set<string>(['release-gift-cards'])
    for (const id of RISK_OWNER_ACTION_IDS) {
      expect(staffIds.has(id)).toBe(false)
      const action = RISK_OWNER_ACTIONS[id]
      expect(action.href.startsWith('/admin')).toBe(false)
      if (merchantOwnDecisions.has(id)) continue
      // The label is the button: it never offers to release, waive or lift.
      expect(action.label).not.toMatch(/\b(release|waive|lift|unlock|approve)\b/i)
    }
  })

  it('makes "request a review" a note to the team, never a release', () => {
    expect(RISK_OWNER_ACTIONS['request-review'].hint).toMatch(/does not release anything/)
  })

  it('gives staff the real controls: dismiss, action, lockdown, the subscription card, Stripe', () => {
    const params = { reviewId: 'r1', orgId: 'org-1', hostId: 'host-1', stripeUrl: 'https://dashboard.stripe.com/test/payments/pi_1' }
    const href = (id: (typeof RISK_STAFF_ACTION_IDS)[number]) =>
      resolveRiskActionHref(RISK_STAFF_ACTIONS[id], { ...params, lockScope: 'org', lockTargetId: 'org-1' })
    expect(href('staff-release')).toBe('/admin/abuse-reports?report=r1&decide=dismissed')
    expect(href('staff-reject')).toBe('/admin/abuse-reports?report=r1&decide=actioned')
    expect(href('staff-lock-workspace')).toBe('/admin/lockdown?scope=org&targetId=org-1')
    expect(href('staff-cancel-subscription')).toBe('/admin/orgs/org-1#subscription')
    expect(href('staff-open-stripe')).toBe(params.stripeUrl)
  })

  it('drops an action whose target is unknown rather than render it dead', () => {
    expect(resolveOwnerRiskActions('email-held', {}).map((action) => action.id)).toEqual(['contact-support'])
  })
})

describe('the owner half never reveals the screen', () => {
  const LEAKS =
    /\b(lookalike|look-alike|signal|threshold|velocity|radar|fingerprint|phishing|young|days? old|brand name|keyword|rule (that|which)|matched|flagged the word)\b/i
  const NUMBERS = /\b\d+\s*(in|within|per|days?|hours?|minutes?|charges?|attempts?|payments?|times?)\b/i

  it.each(RISK_EVENT_KINDS)('%s says what happened and what to do, not how it was found', (kind) => {
    for (const text of ownerText(kind)) {
      expect({ kind, text, leak: LEAKS.test(text) }).toEqual({ kind, text, leak: false })
      expect({ kind, text, number: NUMBERS.test(text) }).toEqual({ kind, text, number: false })
      for (const brand of PHISHING_SCREEN_BRANDS) {
        expect({ kind, text, brand: brand.id, named: brand.mention.test(text) }).toEqual({
          kind,
          text,
          brand: brand.id,
          named: false,
        })
      }
    }
  })
})

describe('the System emails entries', () => {
  it('registers one editable email per kind, plus the digest and the review acknowledgment', () => {
    expect(RISK_NOTICE_SYSTEM_EMAIL_TEMPLATES).toHaveLength(RISK_EVENT_KINDS.length + 2)
    for (const kind of RISK_EVENT_KINDS) {
      expect(getSystemEmailTemplate(riskNoticeEmailKey(kind))?.deliveredBy).toBe('resend')
    }
    expect(getSystemEmailTemplate(RISK_REVIEW_REQUESTED_EMAIL_KEY)).toBeDefined()
  })

  it('uses only the tokens each key declares, and gives a reason for the email', () => {
    for (const entry of RISK_NOTICE_SYSTEM_EMAIL_TEMPLATES) {
      const declared = new Set([...entry.mergeTokens.map((token) => token.name), 'brand.productName', 'brand.fromName', 'brand.supportUrl'])
      const texts = [
        entry.defaultSubject,
        entry.footerReason ?? '',
        ...(entry.defaultBody ?? []).flatMap((block) =>
          block.block === 'button' ? [block.label, block.href] : [block.text],
        ),
      ]
      for (const text of texts) {
        for (const match of text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
          expect({ key: entry.key, token: match[1], declared: declared.has(match[1]) }).toEqual({
            key: entry.key,
            token: match[1],
            declared: true,
          })
        }
      }
      expect(entry.footerReason?.startsWith('You’re receiving this')).toBe(true)
    }
  })
})

describe('riskKindForAbuseRow', () => {
  it('names the kind of every row a risk source files, and none for the public form', () => {
    expect(riskKindForAbuseRow({ source: 'outbound-screen', heldSend: { kind: 'campaign' } })).toBe('email-held')
    expect(riskKindForAbuseRow({ source: 'outbound-screen', heldSend: { kind: 'page' } })).toBe('page-held')
    expect(riskKindForAbuseRow({ source: 'outbound-screen', heldSend: { kind: 'listing' } })).toBe('listing-held')
    expect(riskKindForAbuseRow({ source: 'outbound-screen' })).toBe('domain-flagged')
    expect(riskKindForAbuseRow({ source: 'stripe-fraud-signal' })).toBe('billing-payment-flagged')
    expect(riskKindForAbuseRow({ source: 'stripe-seller-fraud-pattern' })).toBe('seller-review')
    expect(riskKindForAbuseRow({ source: 'marketplace-sale-risk' })).toBe('marketplace-sale-review')
    expect(riskKindForAbuseRow({ source: 'payment-velocity' })).toBe('card-testing')
    expect(riskKindForAbuseRow({ source: undefined })).toBeNull()
    // The stamp the seam writes wins.
    expect(riskKindForAbuseRow({ source: 'outbound-screen', riskNotice: { kind: 'link-blocked' } })).toBe('link-blocked')
  })
})

describe('a locked account is told how to appeal (AGL-3420)', () => {
  it('names the appeal, the reply, the support address and the reference', () => {
    const steps = RISK_NOTICE_CATALOG['account-locked'].owner.steps.join(' ')
    expect(steps).toMatch(/appeal/)
    expect(steps).toMatch(/reply to this email/)
    expect(steps).toContain('{{support.email}}')
    expect(steps).toContain('{{reference}}')
  })
})


/*
 * Every notice states only what the code does (AGL-3432). Each case below
 * was a sentence that promised a consequence, a remedy or a cost that does
 * not exist.
 */
describe('what a notice claims is what happens', () => {
  const owner = (kind: (typeof RISK_EVENT_KINDS)[number]) => ownerText(kind).join(' ')

  it('never tells a canceled workspace to export its data: nothing is deleted', () => {
    expect(owner('subscription-canceled')).not.toMatch(/export/i)
    expect(RISK_NOTICE_CATALOG['subscription-canceled'].owner.steps.join(' ')).toMatch(/Nothing is deleted/)
  })

  it('says an upheld review changes nothing by itself, rather than that action was taken', () => {
    const upheld = renderOwnerRiskNotice('review-upheld', { 'item.label': 'the "About" page (/about)' })
    expect(upheld.summary).not.toMatch(/took action/)
    expect(upheld.meaning).toMatch(/does not lock anything, take anything down or change your billing/)
  })

  it('never names a dispute fee the platform absorbs', () => {
    expect(owner('sale-fraud-warning')).not.toMatch(/fee/i)
    expect(RISK_NOTICE_CATALOG['sale-fraud-warning'].owner.steps.join(' ')).toMatch(
      /the payment is taken back from you/,
    )
  })

  it('never promises that a cleared domain sends the email it stopped', () => {
    expect(owner('domain-cleared')).not.toMatch(/sends on its next attempt|waiting on it/)
    expect(owner('domain-flagged')).not.toMatch(/may wait/)
    expect(owner('domain-rejected')).not.toMatch(/may be restricted/)
  })

  it('never promises that a released email is sent, when a stopped one-off is not', () => {
    expect(RISK_NOTICE_CATALOG['email-released'].owner.meaning).toMatch(/is not sent again/)
    expect(RISK_NOTICE_CATALOG['email-held'].owner.meaning).not.toMatch(/Nobody on your list/)
  })

  it('never offers a review as the way to unblock a link, which stays blocked whatever it decides', () => {
    expect(owner('link-blocked')).toMatch(/stays blocked whatever a review decides/)
  })

  it('never claims a lock message says what is needed, when the default ones ask nothing', () => {
    for (const kind of ['workspace-locked', 'site-locked', 'domain-locked', 'account-locked', 'feature-locked'] as const) {
      expect({ kind, text: owner(kind) }).toEqual({ kind, text: expect.not.stringMatching(/it says what we need/) })
    }
    // The appeal and the reference are untouched.
    expect(RISK_NOTICE_CATALOG['account-locked'].owner.steps.join(' ')).toContain('{{reference}}')
    expect(RISK_NOTICE_CATALOG['workspace-locked'].owner.steps.join(' ')).toContain('{{reference}}')
  })

  it('names a paused feature without bending it into a sentence ("Media uploads is paused")', () => {
    const paused = renderOwnerRiskNotice('feature-locked', {
      'item.label': 'Media uploads',
      'workspace.name': 'Harbor View',
    })
    expect(paused.title).toBe('Paused on Harbor View: Media uploads')
    expect(paused.summary).toMatch(/paused one feature on Harbor View: Media uploads\./)
  })

  it('names the site a site notice is about, and says "your site" only when it has no name', () => {
    for (const kind of ['page-held', 'page-released', 'page-flagged', 'page-rejected', 'link-blocked', 'card-testing', 'gift-card-hold', 'sale-fraud-warning', 'sale-payment-review', 'sale-dispute'] as const) {
      expect({ kind, named: renderOwnerRiskNotice(kind, { 'site.label': 'the site "Harbor View"' }).summary }).toEqual({
        kind,
        named: expect.stringContaining('the site "Harbor View"'),
      })
      expect({ kind, fallback: renderOwnerRiskNotice(kind, {}).summary }).toEqual({
        kind,
        fallback: expect.stringContaining('your site'),
      })
    }
  })

  it('keeps a dispute out of the burst digest, which would drop its deadline', () => {
    expect(RISK_NOTICE_CATALOG['sale-dispute'].neverDigest).toBe(true)
  })
})
