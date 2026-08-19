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
  PUBLISHER_AGREEMENT_VERSION,
  publisherAgreementRefusal,
  publisherAgreementState,
} from '@aglyn/aglyn/app-utils/publisher-agreement'
import type { ResolvedPublisher } from './publisher-profile'

/** A ready-to-send refusal: the status and the body, decided together. */
export interface PublishRefusal {
  status: number
  body: Record<string, unknown>
}

/**
 * EVERY precondition a marketplace publish shares, in one place (AGL-2282).
 *
 * THE DEFECT THIS CLOSES. The publisher agreement (AGL-1077) is the document
 * that says what Aglyn may do with a listing, what the publisher warrants,
 * who indemnifies whom, and — §8 — how paid sales, the platform fee, sales
 * tax and refund clawbacks work. Its gate was written into
 * `publish-plugin.ts` and **nowhere else**. The other six publish doors —
 * components (`publish.ts`), themes, layouts, site templates, email templates
 * and dataset schemas — enforced the profile and the payout binding and then
 * created a listing, `priceUsd` included, with no acceptance on file.
 *
 * So six of the seven ways to put a PAID artifact on the marketplace let an
 * org sell through Aglyn as merchant of record while under no publisher terms
 * at all: no warranty that they own what they are selling, no indemnity, and
 * no consent to the §8.4 clawback the refund path relies on to take a
 * publisher's share back out of their Connect account. Every one of those
 * routes reads `priceUsd` from the request body and stamps it on the listing.
 *
 * WHY THE THREE CHECKS MOVED TOGETHER rather than a bare `requireAgreement`
 * being sprinkled beside the existing two. A gate that must be REMEMBERED at
 * six call sites is exactly what just failed; a gate that arrives bundled
 * with the profile and payout refusals cannot be dropped without also
 * dropping those, which no reviewer would miss. The next publish door gets
 * all three by construction, which is the only version of this fix that
 * stays fixed.
 *
 * WHY IT IS PURE, and lives here rather than beside `resolvePublisherProfile`.
 * Every publish spec in this directory mocks `./publisher-profile` wholesale,
 * and a wholesale mock is a CLOSED WORLD: a gate exported from that module
 * would be `undefined` under those mocks, and — worse — a gate that CALLED
 * the mocked resolver would never run the real agreement check in any of
 * them. Taking the already-resolved profile as an argument keeps the decision
 * live in every existing spec, and makes it directly unit-testable without a
 * Firestore double.
 *
 * ORDER IS DELIBERATE and matches what `publish-plugin.ts` already did:
 * profile, then payouts, then the agreement. The first two are things a
 * publisher sets up once; the third can go stale under a publisher who did
 * everything right, so it reads last and says so specifically.
 *
 * THE AGREEMENT IS ASKED FOR FREE LISTINGS TOO, exactly as
 * `publish-plugin.ts` asked. Sections 2 (the distribution licence), 3 (the
 * warranties) and 9 (indemnity) are what make a free listing distributable at
 * all; only §8 is about money. Gating on `priceUsd > 0` would put every free
 * listing outside the terms that let us serve it.
 *
 * @param publisher the org's resolved marketplace profile, or null/undefined
 *   when it has none.
 * @param options.sells the plural artifact noun for the payout refusal —
 *   "components", "themes", "layouts" — so the message keeps naming what the
 *   publisher was actually trying to sell.
 * @returns the refusal to send, or `null` when the publish may proceed.
 */
export function publishPreconditionRefusal(
  publisher: ResolvedPublisher | null | undefined,
  options: { priceUsd: number; sells: string },
): PublishRefusal | null {
  if (!publisher) {
    return {
      status: 412,
      body: {
        error: 'Set up your publisher profile first — Marketplace → Profile.',
      },
    }
  }
  // Paid listings require completed Stripe Connect onboarding (AGL-46) —
  // there is nowhere to send the seller's share otherwise.
  if (options.priceUsd > 0 && !publisher.stripeChargesEnabled) {
    return {
      status: 412,
      body: {
        error: `Set up payouts first — Marketplace → Payouts — to sell ${options.sells}.`,
      },
    }
  }
  // The publisher agreement (AGL-1077). A precondition on the ORG, checked
  // here beside the profile and payout preconditions it belongs with —
  // deliberately NOT the 428 the attestation uses. "You did not confirm the
  // checklist for this bundle" and "your organization has never agreed to our
  // terms" are different problems, fixed in different places, and a shared
  // status code would send a publisher back to the checklist to tick
  // something that is already ticked.
  //
  // An acceptance of an older version does not count: whoever publishes next
  // reads the changed agreement and accepts it, or does not publish.
  const agreementState = publisherAgreementState(publisher.agreement)
  if (agreementState !== 'current') {
    return {
      status: 412,
      body: {
        error: publisherAgreementRefusal(agreementState),
        agreement: {
          required: PUBLISHER_AGREEMENT_VERSION,
          accepted: publisher.agreement?.version ?? null,
          state: agreementState,
        },
      },
    }
  }
  return null
}
