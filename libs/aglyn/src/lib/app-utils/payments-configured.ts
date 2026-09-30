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

import { PLATFORM_BRAND_NAME } from './platform-brand'

/**
 * "Not configured" is not "failed" (AGL-2019).
 *
 * Every money door in this codebase answers `501` when the deployment has no
 * Stripe key — server-side that is already correct and uniform. The defect was
 * entirely on the client: the storefront cart had a `423` lockdown branch and
 * no `501` branch, so an unconfigured-payments refusal fell through to the
 * generic error tail and rendered as `<Alert severity="error">`. A shopper on a
 * self-hosted store clicked **Checkout** and was shown a RED alert — which says
 * *your payment failed* — for a store that had simply never been set up to take
 * payments. Nothing failed. Nothing was even attempted.
 *
 * This is the same argument `lockdown.ts` makes for its `423`: a refusal that is
 * not a failure needs its own state, not an error with gentler words, because
 * the severity is read before the sentence is. The three states are distinct and
 * must stay distinct:
 *
 *   423  paused      the operator switched writes off       — info
 *   501  unconfigured this deployment never had payments    — info
 *   4xx/5xx error     something was tried and went wrong    — error
 *
 * The copy is split by AUDIENCE, and only one audience's sentence is here:
 *
 *  - A CONSOLE OPERATOR is the person who can fix it, so they are told what to
 *    set. They also get `PLATFORM_BRAND_NAME`, because on a self-host install
 *    the product is not called Aglyn. This is a sentence about the
 *    deployment, so it is the platform's.
 *  - A SITE VISITOR is a stranger on someone else's site, and gets a neutral
 *    sentence about what they were trying to do and NOTHING about the cause.
 *    That sentence belongs to the plugin whose page they are on — only a
 *    storefront knows its visitor was buying something — and it names no
 *    variable, because a visitor could do nothing with one.
 */

/**
 * The status a server uses to say "this deployment has no payments configured".
 * Named so a call site reads as a concept rather than as a magic number.
 */
export const PAYMENTS_NOT_CONFIGURED_STATUS = 501

/**
 * Is this response the not-configured refusal rather than a failure?
 *
 * Deliberately a status-only test. The 501 bodies across commerce and
 * marketplace do not share a machine-readable discriminator — some say
 * "Purchases are not configured on this site.", others "Payments are not
 * configured." — and matching on prose would break the moment one is reworded.
 * The status is the contract.
 */
export function isPaymentsNotConfigured(status: number | null | undefined) {
  return status === PAYMENTS_NOT_CONFIGURED_STATUS
}

/**
 * What a CONSOLE OPERATOR is shown. They can act, so they are told how.
 *
 * `PLATFORM_BRAND_NAME` rather than a literal: a self-hoster who renamed the
 * product should not read our name in an explanation of their own deployment.
 */
export function operatorPaymentsNotConfiguredText() {
  return (
    `${PLATFORM_BRAND_NAME} is not configured to take payments on this ` +
    'deployment. Set STRIPE_SECRET_KEY and restart to enable purchases, ' +
    'payouts and subscriptions.'
  )
}
