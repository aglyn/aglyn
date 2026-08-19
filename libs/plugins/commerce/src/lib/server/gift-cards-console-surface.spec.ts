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
 * AGL-2226: `giftCards` has a console surface, and the two operations that
 * move money are server-side.
 *
 * The gap this closes was invisible to every existing test because the
 * feature WORKED — cards minted, cards redeemed, specs green. What was
 * missing was a reader. So the assertions here are about reachability and
 * about where the write happens, not about gift-card arithmetic (`refund`,
 * `checkout` and `cart-checkout` specs already own that).
 *
 * The server half is asserted by source text rather than by importing the
 * handler: `gift-cards.ts` pulls in firebase-admin at module scope, and a
 * wholesale `jest.mock` of that is a closed world — the shape that produced
 * a TypeError, two bogus statuses and an infinite render loop on 2026-08-18.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAN_ENTITLEMENTS, planGrantingFeature } from '@aglyn/aglyn'

const LIB = join(__dirname, '..')

function source(relative: string): string {
  return readFileSync(join(LIB, relative), 'utf8')
}

/** Body only — an import names a symbol without using it. */
function body(relative: string): string {
  return source(relative)
    .split('\n')
    .filter((line) => !/^\s*import\b/.test(line) && !/^\s*}\s*from\s/.test(line))
    .join('\n')
}

const CARD = 'components/console/gift-cards-card.component.tsx'
const HANDLER = 'server/gift-cards.ts'

describe('AGL-2226 · gift cards are reachable from the console', () => {
  it('is a real, paid entitlement — so the surface is owed', () => {
    // If `giftCards` were ever retired from every plan this guard should stop
    // demanding a UI for it, rather than pinning a surface to a dead flag.
    expect(Object.keys(PLAN_ENTITLEMENTS.free.features)).toContain('giftCards')
    expect(PLAN_ENTITLEMENTS.business.features.giftCards).toBe(true)
    expect(PLAN_ENTITLEMENTS.free.features.giftCards).toBe(false)
    expect(planGrantingFeature('giftCards')).toBeDefined()
  })

  it('the card reads the collection the money actually lives in', () => {
    // Not a paraphrase: `billing-webhook.ts` and `cart-checkout.ts` both
    // address `giftCards`, and a card reading some other path would show a
    // liability figure that agrees with nothing.
    expect(body(CARD)).toContain(`'giftCards'`)
    for (const writer of ['server/billing-webhook.ts', 'server/cart-checkout.ts']) {
      expect(source(writer)).toContain(`collection('giftCards')`)
    }
  })

  it('is MOUNTED on the commerce console page, not merely written', () => {
    const page = 'components/commerce-console-page.tsx'
    expect(body(page)).toContain('<GiftCardsCard')
    expect(source(page)).toContain(
      "import GiftCardsCard from './console/gift-cards-card.component'",
    )
  })

  it('gates the whole card, so an unentitled org cannot configure it', () => {
    // Unlike the recovery card beside it, EVERY operation here needs the
    // entitlement, so the whole-card gate is the correct one.
    expect(body(CARD)).toContain('<EntitlementGatedCard')
    expect(body(CARD)).toContain('feature="giftCards"')
  })

  it('shows the outstanding total, floored per card', () => {
    // The number is the reason the card exists. Flooring matters because
    // AGL-1767 produced NEGATIVE balances, and summing those raw understates
    // the liability — the exact bug, re-created in the readout.
    expect(body(CARD)).toContain('outstandingCents')
    expect(body(CARD)).toMatch(/Math\.max\(0, Number\(card\.balanceCents/)
  })
})

describe('AGL-2226 · issuing and voiding are server-side and gated', () => {
  const handler = source(HANDLER)

  it('is registered as a plugin API route', () => {
    expect(source('server.ts')).toContain(
      `registerPluginApiRoute('commerce/gift-cards', giftCardsHandler)`,
    )
  })

  it('the card posts to that route rather than writing Firestore', () => {
    // The whole point. The host catch-all in the Firestore rules does NOT
    // exclude `giftCards`, so a client `setDoc` here would compile, pass
    // rules, and let a site admin mint their own balance.
    expect(body(CARD)).toContain(`'/api/commerce/gift-cards'`)
    expect(body(CARD)).not.toMatch(/\bsetDoc\(|\bupdateDoc\(|\baddDoc\(/)
  })

  it('requires a bearer token AND a non-viewer role on the host', () => {
    expect(handler).toContain('verifyIdToken')
    expect(handler).toContain(`memberRole === 'viewer'`)
  })

  it('re-checks the entitlement server-side', () => {
    // `billing-webhook.ts:2285` re-checks for the same reason: a doc edited
    // between checkout and webhook must not mint codes. A console that
    // gates itself is not a control.
    expect(handler).toMatch(/checkEntitlement\([^)]*'giftCards'\)/s)
  })

  it('bounds the amount a single issue can mint', () => {
    expect(handler).toContain('MAX_ISSUE_CENTS')
    expect(handler).toMatch(/amountCents\s*<=\s*0|amountCents\s*>\s*MAX_ISSUE_CENTS/)
  })

  it('voids by zeroing, never by deleting', () => {
    // AGL-1767: a DELETED card that a checkout still held was resurrected by
    // the webhook's `increment(-cents)` at a negative balance. Zeroing keeps
    // the row, so the same decrement lands somewhere harmless and auditable.
    expect(handler).toContain('balanceCents: 0')
    expect(handler).not.toMatch(/cardRef\.delete\(/)
  })
})
