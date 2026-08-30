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
 * THE PER-SITE SENDING DOMAIN — naming, and the reasons the name is shaped
 * the way it is.
 *
 * A site sends on a name inside `mail.aglyn.app`, never on `aglyn.com`. The
 * two apexes carry different reputations on purpose:
 *
 *   `aglyn.com`             Aglyn talking to its own customers — billing,
 *                           account notices, console password resets.
 *   `{label}.mail.aglyn.app`  A site talking to its visitors — marketing AND
 *                           transactional. A receipt is still the tenant
 *                           speaking.
 *
 * The line is WHO IS SPEAKING, not whether the message is promotional. A
 * booking reminder that bounces is the tenant's list problem, and charging it
 * against the domain the platform's own invoices leave on means one merchant's
 * bad import degrades every other merchant's password reset.
 *
 * ## Why the mail name is its own namespace and not the site's own subdomain
 *
 * The obvious design is to send from `{subdomain}.aglyn.app` — the address the
 * site already has. It is rejected for one reason, and the reason is renaming.
 *
 * A site's subdomain is MUTABLE. `hostId` is the immutable identifier; the
 * slug is a field the rename route rewrites. So a sending domain derived from
 * the live slug moves when the slug moves, and moving a sending domain throws
 * away every day of sending reputation attached to it — which is the entire
 * asset this feature exists to build. Worse, mail already in flight bounces to
 * a return path that no longer resolves.
 *
 * So the label is PINNED once, at provisioning, from the then-current
 * subdomain, and a rename does not touch it. That immediately creates the
 * problem this namespace exists to solve: the old slug becomes free, another
 * site claims it, and now that site's WEB address is a name the first site's
 * MAIL is signed for.
 *
 * Two ways out, and the choice between them is not about the happy path:
 *
 * 1. Keep one flat namespace and RESERVE the pinned slug so nobody may take
 *    it. Prettier — `hello@northwind-coffee.aglyn.app`.
 * 2. Put mail in its own namespace, so a web slug is never a mail name.
 *
 * **(2), because of what each does when its guard fails.** Both need a
 * uniqueness claim: under (2) two sites can still want the same mail label.
 * The difference is the failure mode when that claim is buggy, lost, or raced.
 *
 *   Under (1) the failure is a site SERVING at a name another site's mail is
 *   signed for. Nothing catches it — Vercel sees a project domain, Resend sees
 *   a mail domain, and neither knows about the other. It is live, silent, and
 *   it is a spoofing surface.
 *
 *   Under (2) the failure is two sites wanting one mail label. Resend holds at
 *   most one domain object per name per account and `recordIssuedSendingDomain`
 *   refuses to overwrite an issued key, so the second claimant is REFUSED. A
 *   refusal is visible and recoverable; a confusion is neither.
 *
 * A guard whose breakage fails closed beats a guard whose breakage fails open,
 * and that is the whole argument. Option (2) also costs one DNS level and buys
 * a namespace that contains only mail names — so `*.mail.aglyn.app` is a
 * coherent thing to reason about, block, or move to another provider as a
 * unit, which a flat namespace of mixed websites and mail domains is not.
 *
 * `mail` is already in `RESERVED_SUBDOMAINS`, so no site can hold the label
 * this namespace hangs off. The namespace is free by construction rather than
 * by a rule added to protect it.
 *
 * ## Why a whole domain per site rather than one shared domain
 *
 * DMARC alignment is evaluated against the `From:` domain and DKIM is what
 * carries it. `aglyn.app` publishes `adkim=s` — strict — so a signature with
 * `d=aglyn.app` cannot authenticate mail `From:` a tenant name, and one
 * tenant's key can never sign as another. That is the isolation. Relaxed DKIM
 * alignment would collapse it all back into one reputation, which is the state
 * this exists to leave.
 *
 * ## The apex sends nothing, and says so
 *
 * `aglyn.app` publishes `v=spf1 -all`. SPF is not inherited by subdomains, so
 * it constrains only the apex — correct, because no message ever leaves
 * `From: something@aglyn.app`. Every sending name here is strictly deeper.
 */

import { normalizeSendingDomain, SENDING_SUBDOMAIN } from './sending-domain'

/*==========================================
  The apexes
==========================================*/

/**
 * The apex assigned site subdomains hang off — the WEB namespace.
 *
 * The same variable and the same default as `TENANT_APEX` in `@aglyn/aglyn`'s
 * `host-naming.ts`, read again here rather than imported because
 * `@aglyn/shared-util-email` is `scope:shared` and may not depend on the
 * application library. Reading the environment in this module is the idiom
 * `sendingSpfInclude` and `sendingReturnPathHost` already establish one file
 * over: the mail policy layer owns its own configuration reads.
 *
 * `||` not `??`, matching every other env read in this repo — an empty string
 * is a variable somebody set to nothing, not a configured value.
 */
export function tenantWebApex(): string {
  return (
    normalizeSendingDomain(process.env.NEXT_PUBLIC_TENANT_DOMAIN || '') ||
    'aglyn.app'
  )
}

/**
 * The apex tenant sending domains hang off — the MAIL namespace.
 *
 * `mail.{web apex}` by default, so an operator who sets only
 * `NEXT_PUBLIC_TENANT_DOMAIN` gets a mail namespace inside their own zone
 * rather than inside ours. Overridable on its own for the operator who wants
 * mail in a different zone entirely — a separate registrable domain is the
 * strongest form of the reputation split this feature is about, and there is
 * no reason for the software to be the thing preventing it.
 *
 * Never equal to the web apex. If an operator sets them to the same value the
 * override is ignored: a mail namespace that IS the web namespace re-creates
 * exactly the collision this module chose its shape to avoid, and honoring
 * that setting would be honoring a request to be unsafe.
 */
export function platformSendingApex(): string {
  const web = tenantWebApex()
  const configured = normalizeSendingDomain(
    process.env.AGLYN_TENANT_MAIL_APEX || '',
  )
  if (configured && configured !== web) return configured
  return `mail.${web}`
}

/*==========================================
  Labels a site's mail may not take
==========================================*/

/**
 * Labels that would name mail infrastructure inside the mail apex.
 *
 * The question this set answers is narrow: which labels, taken by a tenant,
 * would position that tenant to publish records under a name some other part
 * of the system relies on?
 *
 * `send` is the one that matters and the one a pattern check misses.
 * {@link SENDING_SUBDOMAIN} is `send`, so a tenant holding that label holds
 * `send.mail.aglyn.app` — the return-path name of the mail apex itself, and a
 * bounce-routing surface rather than anything a site needs.
 *
 * Names containing a dot or an underscore are NOT in here and do not need to
 * be: {@link LABEL_PATTERN} admits neither character, so `_dmarc` and
 * `resend._domainkey` are unreachable by construction rather than by
 * blocklist. A blocklist entry for a string the grammar cannot produce reads
 * as though the grammar allows it.
 */
export const PLATFORM_MAIL_RESERVED_LABELS: readonly string[] = [
  // The return-path label. `SENDING_SUBDOMAIN`, spelled out so a reader sees
  // the collision, and asserted equal to it in the spec so renaming one cannot
  // silently leave the other behind.
  'send',
  'sends',
  'bounce',
  'bounces',
  'feedback',
  'mx',
  'mta',
  'spf',
  'dkim',
  'dmarc',
  'domainkey',
  'postmaster',
  'abuse',
  'noreply',
  'no-reply',
  'unsubscribe',
  'links',
  'links1',
  'track',
  'tracking',
  'resend',
  // The apex's own label, so no site's mail name can read as the namespace.
  'mail',
  'www',
]

const RESERVED = new Set(PLATFORM_MAIL_RESERVED_LABELS)

/**
 * A single DNS label: lowercase alphanumeric and dashes, no leading or
 * trailing dash, at most 63 octets.
 *
 * Its own pattern rather than a reuse of `SUBDOMAIN_PATTERN`, which lives in
 * `@aglyn/aglyn` and this library may not import. It is also STRICTER in the
 * direction that matters — it refuses a trailing dash, which the host pattern
 * permits — so a slug satisfying both is safe here, and a slug that somehow
 * satisfied only the other one is refused rather than provisioned.
 */
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** Whether a label may become a sending name inside the mail apex. */
export function isReservedMailLabel(label: string): boolean {
  return RESERVED.has(String(label ?? '').trim().toLowerCase())
}

/**
 * Whether a label is shaped like one, ignoring whether it is reserved or
 * taken. Exported so the claim path can tell "not a label" (never fixable by
 * suffixing) from "taken" (fixable).
 */
export function isWellFormedMailLabel(label: string): boolean {
  return LABEL_PATTERN.test(String(label ?? '').trim().toLowerCase())
}

/*==========================================
  Label → sending domain
==========================================*/

/**
 * The sending domain for one PINNED label, or `''` when the label must not
 * become one.
 *
 * The ONLY place a label is turned into a mail domain. Everything downstream —
 * the Resend domain object, the DNS records written into the zone, the `From:`
 * header — is built from what this returns, so a name this refuses cannot
 * reach any of them.
 *
 * It takes the PINNED label, never a host's live subdomain, and that is the
 * rename guarantee expressed as a type: there is no argument here that changes
 * when a site is renamed. {@link mailLabelCandidate} is the separate, one-time
 * step that proposes a label from a slug.
 *
 * `''` rather than a throw: every caller's correct response to an unusable
 * label is the same one — provision nothing — and a falsy return is what this
 * library's other normalizers already give back for input they will not
 * accept.
 */
export function platformSendingDomainFor(
  label: string | null | undefined,
  apex: string = platformSendingApex(),
): string {
  const name = String(label ?? '')
    .trim()
    .toLowerCase()
  const root = normalizeSendingDomain(apex)

  if (!name || !root) return ''
  if (!LABEL_PATTERN.test(name)) return ''
  if (isReservedMailLabel(name)) return ''

  const domain = `${name}.${root}`
  // Strictly one label deeper than the apex. A label reproducing the apex, or
  // carrying it as a suffix, would resolve to the apex itself.
  if (domain === root || name === root || name.endsWith(`.${root}`)) return ''

  return domain
}

/**
 * Propose a mail label from a site's subdomain. Called ONCE, at provisioning.
 *
 * Its output is pinned and then never recomputed, so this function's result
 * changing later — because the site was renamed, or because a label joined the
 * reserved set — cannot move an existing site's mail. That is deliberate: the
 * value of a sending domain is its age, and a name that can be recomputed is a
 * name that can be lost.
 *
 * `attempt` de-collides. A label already claimed by another site yields
 * `{label}-2`, `-3`, and so on, which is the same shape `suggestSubdomains`
 * uses for a taken web slug — a merchant meeting `northwind-coffee-2` has met
 * that pattern before. Truncated so the suffix never pushes the label past a
 * legal length, because a name that is silently cut at 63 octets is a name
 * whose DNS records do not match its domain.
 *
 * Returns `''` when nothing usable can be built, and the caller must treat
 * that as "this site cannot be provisioned" rather than substituting anything.
 */
export function mailLabelCandidate(
  subdomain: string | null | undefined,
  attempt = 1,
): string {
  const base = String(subdomain ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!base) return ''

  const suffix = attempt > 1 ? `-${attempt}` : ''
  const stem = base.slice(0, 63 - suffix.length).replace(/-+$/, '')
  const label = `${stem}${suffix}`

  // A reserved base is de-collided by the suffix rather than refused —
  // `send-2` names no infrastructure. The first attempt at a reserved name
  // still fails, so the caller advances and lands somewhere legal.
  return LABEL_PATTERN.test(label) && !isReservedMailLabel(label) ? label : ''
}

/**
 * Whether a domain is one this deployment provisions and owns, as against a
 * customer's own name.
 *
 * The distinction decides who does the DNS work — a domain inside our apex is
 * written by API and needs nothing from the tenant — and what a delete may
 * remove. A record set inside our zone is ours to clean up; a customer's zone
 * is one we must never write to.
 *
 * The bare apex is deliberately NOT one of these.
 */
export function isPlatformSendingDomain(
  domain: string | null | undefined,
  apex: string = platformSendingApex(),
): boolean {
  const name = normalizeSendingDomain(String(domain ?? ''))
  const root = normalizeSendingDomain(apex)
  return Boolean(name && root && name !== root && name.endsWith(`.${root}`))
}

/**
 * The pinned label a platform sending domain belongs to, or `''`.
 *
 * The inverse of {@link platformSendingDomainFor}, and it re-runs the same
 * refusals rather than merely stripping the suffix. A stored domain is data
 * like any other — it can predate a reserved-label entry or have been written
 * by hand — and a cleanup path that trusted it would derive a label from a
 * name the current rules would never have issued.
 */
export function platformSendingLabel(
  domain: string | null | undefined,
  apex: string = platformSendingApex(),
): string {
  if (!isPlatformSendingDomain(domain, apex)) return ''
  const name = normalizeSendingDomain(String(domain ?? ''))
  const root = normalizeSendingDomain(apex)
  const label = name.slice(0, -(root.length + 1))
  return platformSendingDomainFor(label, root) === name ? label : ''
}

/*==========================================
  The records that go into our own zone
==========================================*/

/** One record to write into the zone, as a DNS API addresses it. */
export interface PlatformZoneRecord {
  type: 'TXT' | 'MX'
  /**
   * Name RELATIVE to the ZONE — `send.acme.mail`, not
   * `send.acme.mail.aglyn.app`.
   *
   * Zone APIs address records by their name within the zone, and a name
   * carrying the zone would be created at `…aglyn.app.aglyn.app`. The
   * fully-qualified form is what `sendingDnsRecords` produces for a customer
   * to paste at their own registrar; this is the same record addressed the way
   * an API to our own zone addresses it.
   *
   * The zone is the REGISTRABLE domain (`aglyn.app`), not the mail apex —
   * `mail.aglyn.app` is a name inside that zone, not a zone of its own, so its
   * label is part of every record name here.
   */
  name: string
  value: string
  /** `MX` only. */
  priority?: number
}

/**
 * Turn the records a sending domain requires into records addressed within the
 * zone.
 *
 * Derived from {@link sendingDnsRecords}' output rather than rebuilt, for the
 * reason that function exists at all: the records we WRITE must be the records
 * the verifier LOOKS FOR. Two generators is how a wizard comes to print one
 * target while the check reads another — a check that cannot fail, then a
 * check that cannot pass.
 *
 * Records with no value are dropped. A domain with no issued DKIM key yields
 * no DKIM record, and writing an empty TXT would publish a record that says
 * nothing while looking published.
 */
export function platformZoneRecords(
  records: readonly {
    type: 'TXT' | 'MX'
    name: string
    value: string
    priority?: number
  }[],
  zone: string = tenantWebApex(),
): PlatformZoneRecord[] {
  const root = normalizeSendingDomain(zone)
  const suffix = `.${root}`
  const zoned: PlatformZoneRecord[] = []

  for (const entry of records ?? []) {
    const value = String(entry?.value ?? '').trim()
    const name = String(entry?.name ?? '')
      .trim()
      .toLowerCase()
      .replace(/\.$/, '')
    if (!value || !name || !name.endsWith(suffix)) continue
    zoned.push({
      type: entry.type,
      name: name.slice(0, -suffix.length),
      value,
      ...(entry.priority ? { priority: entry.priority } : {}),
    })
  }

  return zoned
}

/**
 * A fully-qualified name under a sending domain, addressed within the zone.
 *
 * `''` when the label does not build a domain, or when that domain does not
 * sit inside the zone — which is the guard that keeps a cleanup path from
 * emitting a bare name and asking a zone API to delete it.
 */
function zoneName(
  prefix: string,
  label: string,
  apex: string,
  zone: string,
): string {
  const domain = platformSendingDomainFor(label, apex)
  const root = normalizeSendingDomain(zone)
  if (!domain || !root || !domain.endsWith(`.${root}`)) return ''
  const within = domain.slice(0, -(root.length + 1))
  return prefix ? `${prefix}.${within}` : within
}

/**
 * Every name one sending domain owns inside the zone, for the cleanup path.
 *
 * Derived rather than written out at the call site, because the mail apex is a
 * configuration value: a teardown that assembled `send.{label}.mail` by hand
 * would delete nothing on a deployment whose mail apex is not `mail.…`, and
 * would leave a live signing key in the zone for every site it "cleaned".
 *
 * The DKIM name needs the SELECTOR, which is the provider's choice and not
 * ours — `sendingDkimSelector` proposes one and the provider overwrites it. A
 * caller with no selector gets the other names and must treat the DKIM record
 * as unhandled rather than guessing, since a guessed selector deletes nothing
 * and reports success.
 */
export function platformZoneNamesFor(
  label: string,
  selector?: string | null,
  apex: string = platformSendingApex(),
  zone: string = tenantWebApex(),
): string[] {
  const names = [
    // The sending domain itself, and its return-path subdomain.
    zoneName('', label, apex, zone),
    zoneName(SENDING_SUBDOMAIN, label, apex, zone),
  ]
  const key = String(selector ?? '').trim()
  if (key) names.push(zoneName(`${key}._domainkey`, label, apex, zone))
  return names.filter(Boolean)
}

/**
 * The return-path name for one pinned label, relative to the zone.
 *
 * Used where a caller needs only the bounce name — the record that has to keep
 * resolving after a rename, because bounces arrive after the send.
 */
export function platformReturnPathName(
  label: string,
  apex: string = platformSendingApex(),
  zone: string = tenantWebApex(),
): string {
  return zoneName(SENDING_SUBDOMAIN, label, apex, zone)
}
