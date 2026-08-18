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
 * Who runs *this* deployment, and where its notices go (AGL-2016).
 *
 * Zach's rule for the self-host path: *"the self hosted owner should probably
 * not have to edit the source to update aglyn branded items urls or personal
 * identification items, should probably move these to env vars"*. This module
 * is that, for the one class of value where getting it wrong is not cosmetic —
 * the identity a legal notice is addressed to.
 *
 * ## The defect this exists to close
 *
 * `ABUSE_REPORT_CONTACT_EMAIL` was `'support@aglyn.com'`, a bare literal, and
 * it rendered on the **public, unauthenticated** abuse-report form that every
 * deployment ships. So a self-hoster running their own Firebase published a
 * DMCA/abuse intake instructing third-party reporters to send statutory
 * notices to **Aglyn** — about content Aglyn does not host, cannot see and
 * cannot remove.
 *
 * That is wrong in both directions at once. The reporter's notice goes to a
 * desk with no ability to act on it while their clock runs, and Aglyn is made
 * to look like it holds a takedown duty for a site it does not operate.
 * §512's obligations attach to the entity that actually hosts and controls the
 * material, which on a self-host install is the operator and nobody else.
 *
 * ## Why the default is EMPTY, and not our address
 *
 * AGL-2016 originally proposed our address as the default "so Aglyn's own
 * deployment is unchanged". That is the wrong default *for this value*, and
 * the distinction is worth stating because the sibling fixes went the other
 * way and were right to.
 *
 * `TENANT_PRODUCTION_ROOT` (AGL-2022) defaults to `aglyn.app`, and an operator
 * who does not set it gets links that are merely *wrong* — visibly, on the
 * first click, in their own console. A contact address that defaults to ours
 * fails **silently and off-site**: nothing in the operator's product looks
 * broken, and the only party who learns is a copyright holder whose notice
 * landed with a stranger. A wrong default that is invisible to the person who
 * could fix it is not a default, it is a trap.
 *
 * So: absent is a first-class state, exactly as AGL-2021 established for the
 * Texas registration identifiers, and for the same reason — an explicit
 * "not configured" beats a blank that reads as an address, and beats a
 * plausible-looking value that reads as fact. The cost is that Aglyn's own
 * deployment must now configure these like any other operator. That is the
 * point: it is what makes this configuration rather than a rename.
 *
 * ## Why `NEXT_PUBLIC_`, and why dot notation is load-bearing
 *
 * Every value here is printed to the public — that is what it is *for* — so
 * `NEXT_PUBLIC_` carries no disclosure risk, unlike AGL-2021's staff-gated
 * identifiers, which are deliberately server-only.
 *
 * Next inlines `NEXT_PUBLIC_*` into the browser bundle by textually
 * substituting `process.env.NAME`. The **bracket** form is never substituted
 * and reads `undefined` in the browser. AGL-2037 is that bug live in
 * `tenant-dns.ts`; AGL-2022's `tenant-links.ts` is the corrected reference.
 * Every read below is dot notation on purpose — do not "tidy" it to brackets,
 * and do not introduce a parallel server-only `OPERATOR_*` name: AGL-733 is
 * the record of what happens when one value acquires two env names.
 *
 * Note the build-time consequence for self-hosters: `NEXT_PUBLIC_*` is baked
 * in when the image is built, so these must be set *before* `docker compose
 * build`, not merely before `up`. `docs/SELF_HOSTING.md` says so.
 *
 * ## Empty vs whitespace
 *
 * `'   '` is the shape a half-finished `.env` actually takes and it satisfies
 * a truthiness check. Every read is trimmed and treated as absent, so a
 * half-finished file cannot produce a mailto with nothing behind it.
 */

/** The entity operating this deployment, as far as configuration knows. */
export interface OperatorIdentity {
  /** Legal/display name of the operator, e.g. `Aglyn LLC`. */
  name: string | null
  /** Where support and abuse correspondence goes. */
  supportEmail: string | null
  /**
   * Where legal notices go. Falls back to {@link OperatorIdentity.supportEmail}
   * when unset, because an operator with one mailbox is the common case and a
   * missing legal address must not silently become *no* address.
   */
  legalEmail: string | null
  /** Origin serving the operator's published legal pages, no trailing slash. */
  legalOrigin: string | null
  /**
   * True when this deployment has published enough to be addressed at all —
   * a name AND a way to reach it. Anything less renders the honest
   * unconfigured state rather than a half-identity.
   */
  configured: boolean
}

/**
 * The operator's §512 designated agent, when — and only when — the operator
 * has actually designated one.
 *
 * Separate from {@link OperatorIdentity} on purpose. Having a support address
 * is not having a designated agent: the designation is a filing with the U.S.
 * Copyright Office, it costs money, it must be renewed every three years, and
 * it is what a service provider's safe harbour under 17 U.S.C. §512(c) hangs
 * on. Aglyn has made that filing. A self-hoster who has merely set a support
 * address has not, and is not covered by ours.
 *
 * So the designation is never inferred from the presence of an address. It
 * renders only from its own configuration, and the *claim of registration* —
 * the sentence that is legally load-bearing and legally false if borrowed —
 * requires a further explicit opt-in. See {@link operatorDmcaAgent}.
 */
export interface OperatorDmcaAgent {
  /** Name of the designated agent (a person or a department). */
  name: string
  /** Physical address, as filed. Newlines permitted. */
  address: string
  /** Address notices are accepted at. */
  email: string | null
  /** Phone, as filed. */
  phone: string | null
  /**
   * Whether the operator asserts the designation is **registered with the
   * U.S. Copyright Office**. Only this makes the product state it.
   */
  registered: boolean
}

/**
 * What a surface prints where an operator address would go when the
 * deployment has not configured one.
 *
 * NOT an empty string, and NOT a plausible placeholder. A blank in a contact
 * slot reads as "nobody filled it in yet" — harmless on a settings screen,
 * actively misleading on a page whose entire job is to tell a copyright
 * holder where to send a statutory notice. Same argument, same shape, as
 * AGL-2021's `TX_REGISTRATION_UNSET`: say what is true and name the fix.
 */
export const OPERATOR_CONTACT_UNSET =
  'not configured — this deployment has published no contact address'

/**
 * The lede an unconfigured intake shows instead of naming an operator.
 *
 * Deliberately tells the reporter to stop and go elsewhere. A form that
 * silently routes a legal notice to the wrong entity is worse than a form
 * that admits it is unconfigured, because the first one consumes the
 * reporter's time and their statutory clock before failing.
 */
export const OPERATOR_UNCONFIGURED_NOTICE =
  'This deployment has not published who operates it or where notices should ' +
  'be sent. It is self-hosted software; the operator of this site — not the ' +
  'authors of the software — is responsible for its content. Contact the ' +
  'operator through whatever channel you already have for them. Reports sent ' +
  'through this form are stored for the operator of this site only.'

const clean = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length ? text : null
}

/** `true` only for an explicit, unambiguous opt-in. */
const flag = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().toLowerCase() === 'true'

/**
 * Resolve the operator from configuration.
 *
 * A function rather than module-scope constants, deliberately. Module-scope
 * capture is what forced AGL-2022's spec into `jest.resetModules()` gymnastics
 * to prove it read configuration at all — and a guard that cannot cheaply
 * re-read config tends to end up only testing the default, which is exactly
 * the failure this issue is about. Reading per call also means a test that
 * sets the env and one that does not can sit next to each other in one file
 * and prove the asymmetry.
 *
 * Next's build-time substitution is unaffected: `process.env.NEXT_PUBLIC_*` is
 * replaced textually wherever it appears, function bodies included.
 */
export function operatorIdentity(): OperatorIdentity {
  const name = clean(process.env.NEXT_PUBLIC_OPERATOR_NAME)
  const supportEmail = clean(process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL)
  const legalEmail =
    clean(process.env.NEXT_PUBLIC_OPERATOR_LEGAL_EMAIL) ?? supportEmail
  const legalOrigin = clean(
    process.env.NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN,
  )?.replace(/\/+$/, '')
  return {
    name,
    supportEmail,
    legalEmail,
    legalOrigin: legalOrigin ?? null,
    configured: Boolean(name) && Boolean(supportEmail),
  }
}

/**
 * The operator's designated agent, or `null` when they have not designated
 * one — which is the correct answer for every deployment except one that has
 * actually filed.
 *
 * `name` and `address` are both required because a designation without a
 * physical address is not a designation; the Copyright Office directory
 * record carries both, and a notice sender is entitled to either.
 *
 * `registered` is separately gated on an explicit `true`. An operator who
 * fills in an agent block so their form has a name on it has *not* thereby
 * claimed a Copyright Office registration, and the product must not upgrade
 * their configuration into a legal assertion on their behalf.
 */
export function operatorDmcaAgent(): OperatorDmcaAgent | null {
  const name = clean(process.env.NEXT_PUBLIC_OPERATOR_DMCA_AGENT_NAME)
  const address = clean(process.env.NEXT_PUBLIC_OPERATOR_DMCA_AGENT_ADDRESS)
  if (!name || !address) return null
  return {
    name,
    address,
    email: clean(process.env.NEXT_PUBLIC_OPERATOR_DMCA_AGENT_EMAIL),
    phone: clean(process.env.NEXT_PUBLIC_OPERATOR_DMCA_AGENT_PHONE),
    registered: flag(process.env.NEXT_PUBLIC_OPERATOR_DMCA_AGENT_REGISTERED),
  }
}

/**
 * The address a contact line should print, or {@link OPERATOR_CONTACT_UNSET}.
 *
 * `kind: 'legal'` prefers the legal mailbox; everything else takes support.
 * Returns the marker rather than `null` so a caller cannot accidentally
 * interpolate `null` into copy — `String(null)` is `'null'`, which reads as a
 * value.
 */
export function operatorContactLine(kind: 'support' | 'legal' = 'support'): {
  address: string | null
  text: string
} {
  const identity = operatorIdentity()
  const address =
    kind === 'legal' ? identity.legalEmail : identity.supportEmail
  return { address, text: address ?? OPERATOR_CONTACT_UNSET }
}

/**
 * How the intake should name whoever runs this deployment, in running prose.
 *
 * `'the operator of this site'` when unconfigured — true on every deployment,
 * including ours, and it never names the wrong company.
 */
export function operatorDisplayName(): string {
  return operatorIdentity().name ?? 'the operator of this site'
}
