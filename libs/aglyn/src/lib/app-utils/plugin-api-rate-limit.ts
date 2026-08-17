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
 * Policy for the tenant plugin-API dispatcher's visitor-write rate limit
 * (AGL-1770). Pure and dependency-free so it is unit-testable without a route
 * harness — the durable half lives in `@aglyn/tenant-data-admin` beside
 * `visitorWriteRefusal`, exactly like the lockdown split.
 *
 * ## What this bounds
 *
 * `apps/tenant/app/api/[...pluginApi]/route.ts` dispatches every plugin's
 * visitor-facing handler and, before this, applied no rate limit of any kind.
 * The gates it did have each refuse something narrower: per-site enablement is
 * skipped by an unresolvable `hostId`, the release gate only checks that the
 * plugin is on, and `visitorWriteRefusal` refuses only a paused or suspended
 * site. None of them bounds volume from a working, enabled site — which is
 * every live merchant.
 *
 * AGL-1769 closed the *shape* of the unauthenticated cart write (the caller
 * chose the document path) and was explicit that it did not bound the
 * *quantity*: "id control never multiplied volume; it bought shape". This is
 * the other half. The cost of the unbounded half lands in the merchant's own
 * Firestore — document count and storage on a tenant who did nothing wrong.
 */

/**
 * 120 writes per minute per (site, client IP).
 *
 * Deliberately generous, and the reasoning matters more than the number: a
 * limit that trips on genuine use is worse than no limit, because it gets
 * raised until it means nothing. Measured against what the storefront actually
 * emits:
 *
 * - `cart.tsx:214` puts the line-quantity `TextField`'s `onChange` straight
 *   onto a POST with no debounce, so *typing* `100` into a quantity box is
 *   three cart writes. Editing a few lines is a genuine ten-to-twenty-write
 *   burst in a couple of seconds.
 * - `experiments/track` is an A/B beacon: one exposure write per experiment
 *   per page view, so a visitor clicking through pages at ~1/s with two live
 *   experiments sustains ~2 writes/s legitimately.
 * - Every visitor write on a site shares ONE budget (see the key below), so
 *   these add rather than each getting their own headroom.
 *
 * What a tighter number would actually buy is small. At 120/min a single
 * source can still mint ~172k documents a day against one site; at 30/min it
 * is ~43k. Neither is "safe" in absolute terms — what the cap buys is turning
 * a one-line flood script from *millions* per day into something that needs a
 * distributed botnet to stay interesting, and turning an incident from
 * instantaneous into detectable. That property is bought at 120 as well as at
 * 30, and 30 would refuse real shoppers.
 *
 * 120/60s is also `DEFAULT_RATE_LIMIT` / `DEFAULT_RATE_WINDOW_MS` — the same
 * pair the public REST API enforces — so this adds no bespoke number.
 */
export const VISITOR_WRITE_RATE_LIMIT = 120

/**
 * Fixed 60s window, matching every other limiter in the codebase rather than
 * improving on it. A fixed window admits up to 2× the cap across a boundary;
 * consistency with the shared bucket ids, the degradation markers and
 * `/api/health/rate-limits` is worth more here than closing that.
 */
export const VISITOR_WRITE_RATE_WINDOW_MS = 60_000

/**
 * Machine-caller paths on the tenant plugin-API surface: the dispatcher does
 * NOT rate limit these.
 *
 * The membership rule, so this list is decidable rather than a taste call: the
 * caller proves a shared secret, a webhook signature or a console session that
 * a visitor has no way to obtain, and its request volume is set by campaign
 * size or cron schedule rather than by human behaviour. A 120/min cap does not
 * merely inconvenience these — Resend delivering open/click webhooks for one
 * 50k-recipient campaign arrives from a handful of IPs for a single host and
 * would be shredded by any shopper-sized ceiling.
 *
 * ### Why a path list is right here when the dispatcher argues against them
 *
 * The lockdown gate two lines below is keyed by METHOD precisely to avoid a
 * path list, "for the same reason `useSiteFetch` draws the Preview boundary
 * that way: a per-path list means thirteen handlers each remembering and the
 * fourteenth silently not."
 *
 * That argument turns on POLARITY, and this list has the opposite one. The
 * lockdown list would have enumerated what to *protect*, so a forgotten entry
 * is silently unprotected — the failure you never find. This enumerates what
 * to *exempt*, so the default is limited: a new visitor endpoint added
 * tomorrow is covered by doing nothing, and a forgotten machine endpoint
 * fails loudly and recoverably as 429s with `Retry-After` on a caller that
 * retries. Safe default, noisy mistake.
 *
 * Each entry, with the credential that makes it a machine caller:
 *
 * - `email/events` — Resend's webhook; `verifySvix` over `svix-id`/
 *   `svix-timestamp`/`svix-signature` against `RESEND_WEBHOOK_SECRET`.
 * - `campaigns/send` — a Firebase ID token with a host member role, or
 *   `CRON_SECRET` for the scheduled-send path.
 * - `bookings/reminders` — `x-cron-secret` against `CRON_SECRET`; refuses
 *   outright when it is unset.
 * - `hooks/…` — the merchant's per-hook secret in `x-aglyn-secret`, compared
 *   with `timingSafeEqual`. It already carries its own 30/min per-hook
 *   limiter, so exempting it here removes nothing.
 *
 * Note what is deliberately NOT exempt: presence of an `authorization` or
 * `svix-signature` HEADER. Header presence is not a credential — the
 * dispatcher cannot verify signatures it does not own, so exempting on the
 * header would let any caller skip the limiter by attaching a garbage one to
 * a cart POST.
 */
const MACHINE_API_PATHS: ReadonlySet<string> = new Set([
  'email/events',
  'campaigns/send',
  'bookings/reminders',
])

/** Prefixes whose whole subtree is a machine surface (`hooks/{host}/{hook}`). */
const MACHINE_API_PREFIXES: readonly string[] = ['hooks/']

/** Leading/trailing slashes stripped, matching `normalizeApiPath`. */
function normalize(path: string): string {
  return String(path ?? '').replace(/^\/+|\/+$/g, '')
}

/**
 * Is this dispatcher path a credentialed machine surface (exempt), rather
 * than a visitor one (limited)? Unknown paths are visitor by default.
 */
export function isMachinePluginApiPath(path: string): boolean {
  const normalized = normalize(path)
  if (MACHINE_API_PATHS.has(normalized)) return true
  return MACHINE_API_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

/**
 * The limiter key: one bucket per (site, client IP).
 *
 * ## Why compound, and why NOT a second limiter in either direction
 *
 * **Per-site alone is rejected.** A single attacker would consume the whole
 * merchant's allowance and every real shopper would then be refused — an
 * attacker-triggered denial of service against the victim, cheaper to mount
 * than the flood it replaces and costing the merchant *sales* rather than
 * storage. That is strictly worse than the growth it guards.
 *
 * **Per-IP alone is rejected.** Trivially distributed, and it would let one
 * merchant's traffic spend another's budget.
 *
 * **Compound is what "per-host and per-IP together" should mean here.** Each
 * source is bounded on each site, and no source can affect another's budget,
 * so the ceiling a site is exposed to is (distinct source IPs) × 120/min —
 * the same shape legitimate traffic has. What it does not stop is a genuine
 * botnet, and that is stated rather than papered over: bounding *that* needs
 * an edge WAF, not an application limiter, and every application-level scheme
 * that would catch it (a site-wide ceiling) reintroduces the self-DoS above.
 *
 * **A second, platform-wide per-IP limiter was considered and dropped.** It
 * would bound one source sweeping many merchants, but costs a second
 * Firestore transaction on every storefront write — tripling the ops on a
 * legitimate add-to-cart — to bound an attack that the compound key already
 * prices at one full budget per merchant. One transaction per visitor write
 * is the established cost here (`forms/submit`, `protection/unlock`); two
 * would be novel and is not paid for by what it buys.
 *
 * The path is **not** in the key, on purpose: one shared budget per (site,
 * IP) across cart, reviews, newsletter, bookings and beacons. Keying per path
 * would let a caller multiply its allowance by cycling endpoints, which is
 * free to do and defeats the point.
 *
 * `hostId` is frequently `''` — the dispatcher only resolves one from the
 * query or a JSON body, and a handler that self-gates may supply none. It is
 * kept in the key rather than skipped: AGL-1769 named "an unresolvable
 * `hostId` skips the gate" as an existing hole, and a limiter that a caller
 * turns off by declining to name a site is not a limiter. Host-less writes
 * simply share one bucket per IP.
 */
export function visitorWriteRateLimitKey(hostId: string, ip: string): string {
  return `pluginwrite:${hostId || '-'}:${ip || 'unknown'}`
}
