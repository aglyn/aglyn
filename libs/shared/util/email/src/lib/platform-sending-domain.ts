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
 *   `aglyn.com`               Aglyn talking to its own customers — billing,
 *                             account notices, console password resets.
 *   `{label}.mail.aglyn.app`  One site talking to its visitors, on a domain
 *                             of its own. Marketing AND transactional: a
 *                             receipt is still the tenant speaking.
 *   `shared{n}.mail.aglyn.app`  A FIXED, SMALL POOL. Every site that has no
 *                             domain of its own is assigned one member and
 *                             stays there. Marketing AND transactional, under
 *                             a stricter reputation grade.
 *
 * The FIRST line is WHO IS SPEAKING, and it is absolute. A booking reminder
 * that bounces is the tenant's list problem, and charging it against the
 * domain the platform's own invoices leave on means one merchant's bad import
 * degrades every other merchant's password reset. No tenant message reaches
 * `aglyn.com` under any configuration.
 *
 * Neither tenant line is split by whether a message is promotional. What
 * differs is how tightly the sender is graded: on a site's own domain the
 * merchant is the only person whose reputation is at stake, so they may spend
 * it how they like, and on a pool member a campaign is held to the stricter
 * complaint and bounce thresholds because the cost of a bad list is felt by
 * the other sites on that member.
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
 * ## A whole domain per site, for the sites that have one
 *
 * DMARC alignment is evaluated against the `From:` domain and DKIM is what
 * carries it. `aglyn.app` publishes `adkim=s` — strict — so a signature with
 * `d=aglyn.app` cannot authenticate mail `From:` a tenant name, and one
 * tenant's key can never sign as another. That is the isolation, and it is
 * what a dedicated per-site domain buys.
 *
 * ## …and a FIXED POOL for the sites that do not, which is what makes this
 * design survive
 *
 * A per-host domain is `O(hosts)` in three separate resources, and none of them
 * is the one people reach for first:
 *
 *   - a provider domain object per site, which is a bundled quota with a hard
 *     per-account ceiling;
 *   - **three records in OUR OWN ZONE per site** — SPF, MX and DKIM under
 *     `send.{label}.…` — which a customer's own domain costs us NOTHING of,
 *     because the customer publishes those in their zone;
 *   - a place in the verification and re-check sweeps, forever, at the
 *     provider's account-wide rate limit that the SENDS also share.
 *
 * The zone wall arrives first and it arrives hard. That asymmetry is the whole
 * argument: a customer-owned `acme.com` scales, a platform subdomain does not,
 * and treating the two as one feature hides it.
 *
 * So the default for a site with no domain of its own is a member of a fixed,
 * small pool — {@link sharedSendingPool} — and the pool does not grow with
 * hosts. Its entire cost is {@link DEFAULT_SHARED_POOL_SIZE} domain objects and
 * three records each, at twelve sites or at a hundred thousand. Sites are
 * assigned by {@link sharedSendingDomainFor}, deterministically and with
 * nothing stored, so the assignment costs no write and no read either.
 *
 * Not ONE pool member, because then one compromised site sending "receipts"
 * would take every other site's password resets with it. Several, so the blast
 * radius is a fraction.
 *
 * ## The address is ON a pool member, never under one
 *
 * This is a DMARC constraint rather than a naming preference. The tempting
 * shape is to keep a per-site `From:` (`hello@acme.mail.aglyn.app`) over one
 * shared key at `d=mail.aglyn.app` — one domain object for the whole platform,
 * and the site's name still in the header. Under `adkim=s` those are not the
 * same name, so the signature does not align.
 *
 * What makes that shape actively dangerous rather than merely wrong is
 * `aspf=r`, which the published record also carries: such a message still
 * scrapes a DMARC pass off SPF alone. It works when you test it to one mailbox
 * and fails the moment a recipient forwards it, because forwarding breaks SPF
 * and the DKIM signature that would have survived is the one that does not
 * align. A shape that passes when you check it and fails in the field is worse
 * than one that refuses.
 *
 * Each pool member is therefore its own domain object with its own key signing
 * for itself, and the `From:` sits on the member exactly. Alignment holds on
 * DKIM without depending on SPF.
 *
 * ## What the pool costs the product, and what bounds it
 *
 * Reputation on a member is pooled across the sites assigned to it, which is
 * the trade the console discloses in as many words. It is bounded by GRADING
 * rather than by exclusion. Marketing mail sends here, and the site that earns
 * complaints is the one that stops: a pooled campaign is held to the WATCH
 * thresholds in `sender-reputation.ts` rather than the trip levels, the
 * new-sender ramp keeps a first import off the member, and `sendEmail` refuses
 * outright the one thing a seven-day window cannot catch in time — bulk mail
 * carrying no unsubscribe link.
 *
 * ## The web apex sends nothing, and says so
 *
 * `aglyn.app` publishes `v=spf1 -all`. SPF is not inherited by subdomains, so
 * it constrains only the apex — correct, because no message ever leaves
 * `From: something@aglyn.app`. Every sending name here is strictly deeper, the
 * pool members included.
 */

import {
  normalizeLocalPart,
  normalizeSendingDomain,
  SENDING_SUBDOMAIN,
} from './sending-domain'

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
  The shared identity every site can reach
==========================================*/

/**
 * The mailbox the shared tenant identity sends as.
 *
 * `notifications` rather than `hello`, which is what a site's own domain
 * defaults to. The two are different promises: `hello@northwind.mail.aglyn.app`
 * is a site inviting a reply, and this one is a platform address carrying mail
 * for whichever site the display name in front of it names. Calling it `hello`
 * would invite replies to a mailbox belonging to no site.
 */
export const SHARED_TENANT_LOCAL_PART = 'notifications'

/** The label prefix every pool member carries. Reserved by rule, not by list. */
const SHARED_POOL_PREFIX = 'shared'

/**
 * How many shared sending domains exist, absent configuration.
 *
 * FOUR, and the number is a blast-radius decision rather than a capacity one.
 * The pool is FIXED-SIZE — it does not grow with hosts — so its whole cost is
 * four provider domain objects and twelve records in our own zone, whether the
 * deployment has twelve sites or a hundred thousand. That is the property that
 * makes this design survive a scale a per-host domain does not.
 *
 * One would be simpler and is wrong: every site without a domain of its own
 * would share a single reputation, so one compromised site blasting "receipts"
 * takes every other site's password resets down with it. Four caps that at a
 * quarter, for three more domain objects.
 *
 * Not larger, because each member is a reputation that has to be EARNED — one
 * warm domain sending steadily is worth more than eight cold ones — and
 * because each is a provider slot on an account whose allowance is ten on the
 * plan this deployment pays for. Raising it is a real decision with a real
 * cost, so it is a configuration value rather than a constant somebody bumps.
 */
export const DEFAULT_SHARED_POOL_SIZE = 4

/** Hard ceiling on the configured pool, so a typo cannot ask for thousands. */
const MAX_SHARED_POOL_SIZE = 64

/** How many members this deployment's pool has. */
export function sharedPoolSize(): number {
  const raw = Number(
    String(process.env.AGLYN_TENANT_SHARED_POOL_SIZE || '').trim(),
  )
  if (!Number.isFinite(raw)) return DEFAULT_SHARED_POOL_SIZE
  const size = Math.floor(raw)
  if (size < 1) return DEFAULT_SHARED_POOL_SIZE
  return Math.min(size, MAX_SHARED_POOL_SIZE)
}

/**
 * Whether a label names a pool member.
 *
 * By PATTERN rather than by list, so raising the pool size can never hand a
 * tenant a label the pool is about to want. `PLATFORM_MAIL_RESERVED_LABELS`
 * covers the fixed names; this covers a family whose size is configurable, and
 * a blocklist that had to be edited in step with an environment variable is a
 * blocklist that will be forgotten.
 */
export function isSharedPoolLabel(label: string): boolean {
  return new RegExp(`^${SHARED_POOL_PREFIX}[1-9][0-9]*$`).test(
    String(label ?? '')
      .trim()
      .toLowerCase(),
  )
}

/**
 * The pool, in order: `shared1.mail.aglyn.app`, `shared2.…`, and so on.
 *
 * The names say what they are on purpose. A recipient who looks sees an address
 * that is plainly platform infrastructure rather than one pretending to be the
 * merchant's own — which is what the console tells the merchant is happening,
 * and a `From:` that oversold the arrangement would be the one surface
 * contradicting the disclosure.
 */
export function sharedSendingPool(
  apex: string = platformSendingApex(),
  size: number = sharedPoolSize(),
): string[] {
  const pool: string[] = []
  for (let index = 1; index <= size; index += 1) {
    // The grammar, not `platformSendingDomainFor`: these labels are RESERVED
    // against tenants, so the tenant gate would refuse every one of them and
    // hand back an empty pool.
    const domain = mailDomainWithinApex(`${SHARED_POOL_PREFIX}${index}`, apex)
    if (domain) pool.push(domain)
  }
  return pool
}

/**
 * FNV-1a, 32-bit. A stable, dependency-free string hash.
 *
 * Stability across processes and deployments is the entire requirement — the
 * assignment below has to be the same answer in the tenant runtime, in a cron
 * and in the console, today and in a year — so it cannot be anything that
 * varies by runtime. `>>> 0` after the multiply keeps the value in unsigned
 * 32-bit range, which is what makes it reproducible rather than dependent on
 * float rounding.
 *
 * Deliberately not a cryptographic hash. Nothing here is a secret, and nobody
 * gains anything by predicting which pool member a site lands on.
 */
function hash32(input: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * Which pool member one host sends on. Deterministic, and stored nowhere.
 *
 * ## Rendezvous hashing, and why not `hash % size`
 *
 * The requirement is that a host's sending identity does not move underneath
 * it. Reputation is built by sending steadily from one name, so a reassignment
 * is not a rebalance — it is a reset, and it throws away every day of standing
 * the old name had earned.
 *
 * `hash(hostId) % size` satisfies that only while `size` never changes. Growing
 * a pool from four to eight remaps roughly HALF of all hosts, silently moving
 * half the platform's transactional mail onto cold domains. The operator's
 * reason for growing the pool is usually that one member is in trouble, which
 * makes the moment they act the worst possible moment to shuffle everybody.
 *
 * Rendezvous (highest-random-weight) hashing scores the host against EVERY
 * member and takes the winner. Adding a member moves only the hosts that now
 * score highest on the new one — about 1/size of them — and removing a member
 * moves only that member's own hosts. Nothing else observes the change.
 *
 * That property is why this is worth ten lines instead of a modulo, and it is
 * also why the assignment needs no stored field: there is nothing to pin,
 * because the function does not change its mind. A pinned column would be one
 * more write per host on a path whose whole point is costing nothing per host.
 *
 * Ties break on the domain name so the answer is total rather than dependent on
 * iteration order. A 32-bit collision across a four-member pool is vanishingly
 * unlikely and would still have to resolve to something.
 */
export function sharedSendingDomainFor(
  hostId: string | null | undefined,
  apex: string = platformSendingApex(),
  size: number = sharedPoolSize(),
): string {
  const id = String(hostId ?? '').trim()
  const pool = sharedSendingPool(apex, size)
  if (!id || !pool.length) return ''

  let best = ''
  let bestScore = -1
  for (const domain of pool) {
    const score = hash32(`${id}:${domain}`)
    if (score > bestScore || (score === bestScore && domain > best)) {
      best = domain
      bestScore = score
    }
  }
  return best
}

/**
 * The address one host sends TRANSACTIONAL mail on when it has no domain of
 * its own.
 *
 * `''` when the deployment has no usable pool, or when the caller has no host.
 * The caller must treat that as a REFUSAL rather than substituting anything: a
 * caller with no `hostId` does not know which site it is sending for, and the
 * honest answer to that is not "some pool member".
 *
 * ## The address always sits ON a pool member, never under one
 *
 * Under `adkim=s` the `From:` domain and the DKIM `d=` must be the same name,
 * exactly. Each pool member is its own provider domain object with its own key
 * signing for itself, so an address on the member aligns. An address BENEATH a
 * member — a per-host `From:` over a shared key — does not, and the published
 * record's `aspf=r` would let it scrape a DMARC pass off SPF alone until the
 * first recipient forwarded it. There is deliberately no configuration that can
 * produce that shape: the local part is the only part an operator may set.
 */
export function sharedTenantSendingFrom(
  hostId: string | null | undefined,
  apex: string = platformSendingApex(),
  size: number = sharedPoolSize(),
): string {
  const domain = sharedSendingDomainFor(hostId, apex, size)
  if (!domain) return ''
  const localPart =
    normalizeLocalPart(process.env.AGLYN_TENANT_SHARED_LOCAL_PART || '') ||
    SHARED_TENANT_LOCAL_PART
  return `${localPart}@${domain}`
}

/**
 * Whether a domain is one of this deployment's pool members.
 *
 * Used where a surface has a domain and needs to know whether its reputation is
 * pooled — so the disclosure is driven by the same function the send path
 * resolves through, rather than by a second opinion assembled at the surface.
 */
export function isSharedSendingDomain(
  domain: string | null | undefined,
  apex: string = platformSendingApex(),
  size: number = sharedPoolSize(),
): boolean {
  const name = normalizeSendingDomain(String(domain ?? ''))
  return Boolean(name) && sharedSendingPool(apex, size).includes(name)
}

/**
 * ⛔ WHY A DOMAIN MAY NOT BE TORN DOWN, or `null` when it may.
 *
 * Every path that destroys a sending domain — the site delete, the erasure,
 * the orphan reaper — asks this ONE function first, and it lives here because
 * this module is the only place that knows what the pool is. A guard held
 * anywhere else is a guard the next teardown path forgets to consult.
 *
 * `shared-pool` is the answer that matters, and the reason it has to be
 * explicit rather than emergent. A pool member is owned by NO HOST: it is
 * platform infrastructure that every site without a domain of its own sends
 * on, and {@link sharedSendingDomainFor} assigns hosts to it by hash rather
 * than by a stored pointer. So any reaper keyed on "nothing points at this"
 * describes a pool member perfectly, and releasing one takes a quarter of the
 * platform's transactional mail — receipts, password resets, booking
 * confirmations — down with it. Silently: nothing raises an error when a
 * domain merely stops being verified, the sends just start refusing.
 *
 * It is asked of the LABEL as well as of the domain, in three ways, because
 * pool membership answered from the CURRENT pool alone is not enough:
 *
 *   - the domain is in the pool this deployment builds today;
 *   - the caller's own label is a pool label. {@link platformSendingLabel}
 *     refuses to derive a label for a reserved name, so a pool member's domain
 *     hands back an empty label, and a caller that then fell back to a label
 *     it was handed separately would walk straight past the derivation that
 *     was protecting it;
 *   - the label UNDER the apex is a pool label, whatever the pool size says.
 *     A deployment shrunk from eight members to four still holds `shared5`
 *     through `shared8` at the provider, and they are still infrastructure —
 *     a membership test against the current pool would hand all four to the
 *     reaper on the day somebody lowered the number.
 *
 * `not-our-zone` is the other refusal and a different kind: a customer's own
 * verified domain, which this deployment never provisioned, holds no provider
 * slot for, and must never write DNS into.
 */
export function sendingDomainTeardownRefusal(
  domain: string | null | undefined,
  label: string | null | undefined = null,
  apex: string = platformSendingApex(),
  size: number = sharedPoolSize(),
): 'shared-pool' | 'not-our-zone' | null {
  if (isSharedSendingDomain(domain, apex, size)) return 'shared-pool'
  if (isSharedPoolLabel(String(label ?? ''))) return 'shared-pool'

  /*
   * The bare suffix strip, not `platformSendingLabel`. That one re-applies the
   * tenant policy and answers `''` for every reserved name — which is every
   * pool label — so asking it here would return nothing for exactly the names
   * this check exists to catch.
   */
  const name = normalizeSendingDomain(String(domain ?? ''))
  const root = normalizeSendingDomain(apex)
  const beneath =
    name && root && name !== root && name.endsWith(`.${root}`)
      ? name.slice(0, -(root.length + 1))
      : ''
  if (isSharedPoolLabel(beneath)) return 'shared-pool'

  if (!isPlatformSendingDomain(domain, apex)) return 'not-our-zone'
  return null
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

/**
 * Whether a label is one a TENANT may not take inside the mail apex.
 *
 * Two sources, and the second is why this is a function rather than a `Set`
 * lookup: the fixed infrastructure names above, plus the pool family, whose
 * size is a configuration value. A pool grown from four to eight must not be
 * able to want a label a site was handed last week, and a blocklist that had to
 * be edited in step with an environment variable is one that gets forgotten.
 *
 * This is the TENANT policy, not the name grammar. The pool's own builder
 * deliberately does not consult it — `shared3` is reserved precisely so that
 * the pool can have it — which is why {@link mailDomainWithinApex} exists as
 * the shape check underneath both.
 */
export function isReservedMailLabel(label: string): boolean {
  const name = String(label ?? '')
    .trim()
    .toLowerCase()
  return RESERVED.has(name) || isSharedPoolLabel(name)
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
  return isReservedMailLabel(name) ? '' : mailDomainWithinApex(name, apex)
}

/**
 * The NAME GRAMMAR, with no policy about who may hold the name.
 *
 * Split out from {@link platformSendingDomainFor} because the pool needs the
 * grammar and must not be subject to the tenant policy: `shared3` is a reserved
 * label exactly so that no site can take it, and a pool builder routed through
 * the tenant gate would find every one of its own names refused and produce an
 * empty pool — a deadlock in which the guard protecting the pool is what stops
 * the pool existing.
 *
 * Still ONE generator for the shape, which is the invariant that matters: every
 * name this module emits, tenant or pool, is a single well-formed label
 * strictly one level below the apex. Two generators for that is how a verifier
 * comes to look at a name nothing writes.
 *
 * Not exported. A caller outside this module that wants a name for a site wants
 * the policy applied.
 */
function mailDomainWithinApex(label: string, apex: string): string {
  const name = String(label ?? '')
    .trim()
    .toLowerCase()
  const root = normalizeSendingDomain(apex)

  if (!name || !root) return ''
  if (!LABEL_PATTERN.test(name)) return ''

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
