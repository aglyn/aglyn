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

// Same placement rationale as page-header-record-context.ts: lives in
// @aglyn/aglyn without a 'use client' banner so both the console app and the
// feature plugins share one context module.
import { createContext, useContext } from 'react'

/**
 * What THIS DEPLOYMENT can do — facts about the install, not about the
 * organization reading it (AGL-3080).
 *
 * The third kind of answer a plugin surface needs and cannot reach for
 * itself. `entitled` says what the workspace bought and `permissions` says
 * who is reading; neither says whether the software in front of them is
 * wired up to a provider at all. A self-host install is the case: the
 * marketplace's release flag defaults ON, so a fresh install draws the whole
 * thing — browse, listing pages, a Buy button, a payout panel — all of it
 * backed by Aglyn's Stripe Connect platform, which the operator does not have
 * and cannot get.
 *
 * WHY A CONTEXT, and why the value comes from a SERVER layout. The facts are
 * server-only secrets: `STRIPE_SECRET_KEY` carries no `NEXT_PUBLIC_` prefix,
 * so a client component reading `process.env` for it gets `undefined` and
 * concludes "not configured" on every deployment, our own included. The
 * console's server layout knows the answer before any JavaScript ships and
 * hands it down, which is also why this is not a fetch: a notice that says
 * what a deployment cannot do must not arrive after the click it exists to
 * precede.
 *
 * WHAT IT IS NOT. Not a release flag and not an entitlement — the three
 * answer different questions and a surface usually needs all three. The flag
 * asks whether this deployment should show the feature; the entitlement asks
 * whether this organization bought it; this asks whether the deployment can
 * carry it out. Nothing here is a gate: browsing and free installs genuinely
 * work without Stripe, so a surface reads this to EXPLAIN itself, and hiding
 * on it would remove working functionality to avoid describing one that is
 * off.
 */
export interface DeploymentCapabilities {
  /**
   * True when this deployment has a Stripe platform at all (AGL-2019) —
   * Aglyn as the biller, which is infrastructure, not a tenant's own
   * checkout.
   *
   * ⚠️ Read it the safe way round. The default below is `true`, because the
   * absence of a provider is not evidence of an absent platform: every
   * surface rendered outside one — a test harness, a widget mounted in a
   * zone — would otherwise draw a permanent "not configured" banner on
   * Aglyn's own console.
   */
  payments: boolean
}

export const DEPLOYMENT_CAPABILITIES_DEFAULT: DeploymentCapabilities = {
  payments: true,
}

export const DeploymentCapabilitiesContext =
  createContext<DeploymentCapabilities>(DEPLOYMENT_CAPABILITIES_DEFAULT)
DeploymentCapabilitiesContext.displayName = 'DeploymentCapabilitiesContext'

/** Hook form of {@link DeploymentCapabilitiesContext}. */
export function useDeploymentCapabilities(): DeploymentCapabilities {
  return useContext(DeploymentCapabilitiesContext)
}
