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
 * The one decision every org-agnostic entry point makes (AGL-2430, AGL-3265).
 *
 * Console routing is org-scoped: `buildRoute` needs an `orgSlug`. A handful of
 * callers cannot supply one, because they store a single static URL for every
 * customer in the account — Stripe's "Payment method updates" setting, a
 * receipt, a system email footer, a self-host runbook. An entry point closes
 * that gap by resolving the workspace from the SESSION rather than from the
 * URL, and this module is that resolution, kept out of the pages so every
 * branch is drivable without a DOM.
 *
 * It was `resolveBillingEntry` alone until support needed the identical three
 * cases. Generalized rather than copied, because the interesting part is not
 * the branching — it is the two paragraphs below, which a second copy would
 * have had to restate and would eventually have restated differently.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: filter suspended, past-due or otherwise
 * delinquent workspaces out of the answer. A lock caused by non-payment that
 * also hides the page where payment happens is a deadlock, and a billing or
 * support entry point is precisely the surface a locked customer arrives on.
 * Those surfaces stay reachable through a lock by design —
 * `apps/console/app/api/billing/subscription/route.ts` carries the
 * `lockdown-423: exempt` marker for the same reason — so a filter here would
 * be the one line that re-closes the door.
 */

/** One workspace the signed-in account can reach, as a picker needs it. */
export interface OrgEntryOrg {
  $id?: string
  slug?: string
  orgName?: string
}

/** An {@link OrgEntryOrg} that survived the linkability filter. */
export type LinkableOrg = OrgEntryOrg & { slug: string }

export type OrgEntryDestination =
  /** Exactly one reachable workspace — go there, no picker. */
  | { kind: 'one'; href: string; org: LinkableOrg }
  /** Several — the reader picks, because the URL carried no way to know. */
  | { kind: 'choose'; orgs: LinkableOrg[] }
  /**
   * Signed in, but no workspace with a usable slug. Says so rather than
   * dropping the visitor on a dashboard: someone who followed a billing email
   * or a support link needs to be told this account has no workspace, not
   * handed a console and left to guess.
   */
  | { kind: 'no-workspace' }

/**
 * A membership row with no `slug` cannot be linked to — `buildRoute` would
 * emit `/undefined/billing`. Such a row is a broken projection rather than a
 * workspace the reader can act on, so it is dropped before the count is taken.
 * Dropping it BEFORE counting is the point: one good org beside one broken row
 * must still be a straight-through redirect, not a picker with a dead card in
 * it.
 *
 * `hrefFor` is what makes this shared rather than duplicated — the caller says
 * where a chosen workspace goes, and nothing else about the three cases
 * differs between one entry point and the next.
 */
export function resolveOrgEntry(
  orgs: readonly OrgEntryOrg[] | null | undefined,
  hrefFor: (orgSlug: string) => string,
): OrgEntryDestination {
  const linkable = (orgs ?? []).filter(
    (org): org is LinkableOrg =>
      typeof org?.slug === 'string' && org.slug.length > 0,
  )
  if (linkable.length === 0) return { kind: 'no-workspace' }
  if (linkable.length === 1) {
    const org = linkable[0]
    return { kind: 'one', href: hrefFor(org.slug), org }
  }
  return { kind: 'choose', orgs: linkable }
}

export default resolveOrgEntry
