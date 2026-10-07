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

import { type SiteReturnHost, siteOwnHosts } from '@aglyn/aglyn/app-utils/site-return-url'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/tenant-apex'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * Stripe payment method domains for storefronts (AGL-3629).
 *
 * The in-page checkout mounts Stripe's Payment Element on the merchant's own
 * domain, and Stripe shows Apple Pay there only on a REGISTERED domain (Google
 * Pay, Link, Amazon Pay and Klarna's express button use the same registration).
 * Nothing registered one, so a shopper on `shop.example.com` with a card in
 * Apple Wallet never saw the button.
 *
 * ## Which account the domain is registered on
 *
 * Stripe's rule: "The domain where the charge is being run needs to be
 * registered for the user running the charge." Storefront charges are
 * DESTINATION charges created by the platform with no `Stripe-Account` header
 * and no `on_behalf_of`, so the platform runs them and the platform's key
 * registers the domain, with no `Stripe-Account` header. A direct-charge flow
 * would register on the connected account instead; there is none today, and
 * `registerOnPlatform` is named for that reason.
 *
 * ## When
 *
 *  - On connect: core raises `host.domain.attached`, and commerce registers
 *    the custom domain and its `www.` twin.
 *  - On first checkout: the session handlers call `ensureCheckoutDomain` for
 *    the page the shopper is on, which covers every `{site}.aglyn.app`
 *    subdomain without registering thousands of sites that never sell.
 *  - Daily: `reconcileCustomDomains` registers any connected custom domain the
 *    first two missed (domains connected before AGL-3629 included) — the
 *    backfill is a job rather than a one-off script, so it also repairs a
 *    missed event later.
 *  - On release: `host.domain.released` DISABLES the domain. Stripe has no
 *    delete; a disabled domain stops showing the methods and can be enabled
 *    again if the name comes back.
 *
 * ## The cache
 *
 * `paymentMethodDomains/{mode}~{domain}` records what Stripe last said, so a
 * checkout costs one document read rather than a Stripe round trip. The mode is
 * in the id because a test key and a live key register in different worlds and
 * a domain registered in one is not registered in the other. Server-only: the
 * rules deny every client.
 */

export const PAYMENT_METHOD_DOMAINS_COLLECTION = 'paymentMethodDomains'

/** How long a recorded registration is trusted before Stripe is asked again. */
export const PAYMENT_METHOD_DOMAIN_RECHECK_MS = 7 * 24 * 60 * 60 * 1000

/** The most a checkout waits on Stripe before selling without the domain. */
export const CHECKOUT_DOMAIN_BUDGET_MS = 2500

export type StripeMode = 'live' | 'test'

/** Stripe's per-method verdict on a domain. */
export interface PaymentMethodDomainStatus {
  applePay: string | null
  googlePay: string | null
  link: string | null
  amazonPay: string | null
  klarna: string | null
}

export interface PaymentMethodDomainRecord {
  domain: string
  mode: StripeMode
  stripeId: string | null
  enabled: boolean
  status: PaymentMethodDomainStatus
  hostId: string | null
  checkedAtMs: number
  lastError: string | null
}

interface StripeDomainObject {
  id: string
  domain_name: string
  enabled: boolean
  apple_pay?: { status?: string }
  google_pay?: { status?: string }
  link?: { status?: string }
  amazon_pay?: { status?: string }
  klarna?: { status?: string }
}

/** Which Stripe world the platform key is in, from its prefix. */
export function stripeModeOfKey(key: string | undefined): StripeMode | null {
  const value = String(key ?? '')
  if (/^(sk|rk)_live_/.test(value)) return 'live'
  if (/^(sk|rk)_test_/.test(value)) return 'test'
  return null
}

/**
 * A hostname Stripe can register: lowercased, no trailing dot, at least two
 * labels, and never a local or IP host — a checkout opened on `localhost`
 * must not try to register it.
 */
export function registrableDomain(input: unknown): string | null {
  const value = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '')
  if (!value || value.length > 253) return null
  if (value === 'localhost' || value.endsWith('.localhost')) return null
  if (/^[0-9.]+$/.test(value) || value.includes(':')) return null
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) return null
  return value
}

/** The cache document id for a domain in a mode. */
export function paymentMethodDomainDocId(mode: StripeMode, domain: string): string {
  return `${mode}~${domain}`
}

/**
 * The domains a site's custom domain needs: the domain and its `www.` twin,
 * since the platform answers on both (`siteOwnHosts`).
 */
export function customDomainNames(cname: unknown): string[] {
  const domain = registrableDomain(cname)
  if (!domain) return []
  const twin = domain.startsWith('www.') ? domain.slice(4) : `www.${domain}`
  return [domain, ...(registrableDomain(twin) ? [twin] : [])]
}

function statusOf(object: StripeDomainObject): PaymentMethodDomainStatus {
  return {
    applePay: object.apple_pay?.status ?? null,
    googlePay: object.google_pay?.status ?? null,
    link: object.link?.status ?? null,
    amazonPay: object.amazon_pay?.status ?? null,
    klarna: object.klarna?.status ?? null,
  }
}

async function stripeRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  params?: Record<string, string>,
  options: { idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const query = method === 'GET' && params ? `?${new URLSearchParams(params)}` : ''
  const response = await fetch(`https://api.stripe.com/v1/${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      ...(method === 'POST' && {
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
      // The platform's own key and NO `Stripe-Account`: destination charges
      // are run by the platform, so the platform holds the registration.
      ...(options.idempotencyKey && { 'Idempotency-Key': options.idempotencyKey }),
    },
    ...(method === 'POST' && params && { body: new URLSearchParams(params).toString() }),
    ...(options.signal && { signal: options.signal }),
  })
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string }
  }
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Stripe ${path} failed (${response.status})`)
  }
  return payload
}

async function findOnStripe(
  domain: string,
  signal?: AbortSignal,
): Promise<StripeDomainObject | null> {
  const list = await stripeRequest<{ data?: StripeDomainObject[] }>(
    'GET',
    'payment_method_domains',
    { domain_name: domain, limit: '1' },
    { signal },
  )
  return list.data?.find((entry) => entry.domain_name === domain) ?? null
}

/**
 * Register (or re-enable) one domain on the platform account. Idempotent end
 * to end: an existing registration is found first and reused, a disabled one
 * is enabled rather than duplicated, and the create carries an idempotency key
 * so two checkouts racing on a fresh subdomain open one registration.
 */
export async function registerOnPlatform(
  domain: string,
  signal?: AbortSignal,
): Promise<StripeDomainObject> {
  const existing = await findOnStripe(domain, signal)
  if (existing) {
    if (existing.enabled) return existing
    return stripeRequest<StripeDomainObject>(
      'POST',
      `payment_method_domains/${encodeURIComponent(existing.id)}`,
      { enabled: 'true' },
      { signal },
    )
  }
  try {
    return await stripeRequest<StripeDomainObject>(
      'POST',
      'payment_method_domains',
      { domain_name: domain, enabled: 'true' },
      { idempotencyKey: `aglyn-pmd-register:${domain}`, signal },
    )
  } catch (error) {
    // Lost a race to a create that landed between the lookup and this call:
    // the registration exists, which is what was wanted.
    const raced = await findOnStripe(domain, signal).catch(() => null)
    if (raced) return raced
    throw error
  }
}

function docRef(mode: StripeMode, domain: string) {
  return firebaseAdmin
    .app()
    .firestore()
    .collection(PAYMENT_METHOD_DOMAINS_COLLECTION)
    .doc(paymentMethodDomainDocId(mode, domain))
}

async function record(
  mode: StripeMode,
  domain: string,
  patch: Partial<PaymentMethodDomainRecord>,
): Promise<void> {
  await docRef(mode, domain).set(
    { domain, mode, checkedAtMs: Date.now(), ...patch },
    { merge: true },
  )
}

export interface EnsureDomainResult {
  domain: string
  outcome: 'registered' | 'cached' | 'skipped' | 'failed'
  record?: PaymentMethodDomainRecord
  error?: string
}

/**
 * Make sure one domain is registered and enabled, reading the cache first.
 *
 * Never throws: every caller is on its way to something more important (a
 * sale, a domain connect), and a domain Stripe would not take today is
 * recorded with its error and retried by the daily reconcile.
 */
export async function ensurePaymentMethodDomain(
  rawDomain: string,
  options: { hostId?: string | null; signal?: AbortSignal; force?: boolean } = {},
): Promise<EnsureDomainResult> {
  const domain = registrableDomain(rawDomain)
  const mode = stripeModeOfKey(process.env.STRIPE_SECRET_KEY)
  if (!domain || !mode) {
    return { domain: String(rawDomain ?? ''), outcome: 'skipped' }
  }
  try {
    if (!options.force) {
      const cached = await docRef(mode, domain).get()
      const data = cached.data?.() as PaymentMethodDomainRecord | undefined
      if (
        cached.exists &&
        data?.enabled === true &&
        data.stripeId &&
        Date.now() - Number(data.checkedAtMs ?? 0) < PAYMENT_METHOD_DOMAIN_RECHECK_MS
      ) {
        return { domain, outcome: 'cached', record: data }
      }
    }
    const object = await registerOnPlatform(domain, options.signal)
    const next: PaymentMethodDomainRecord = {
      domain,
      mode,
      stripeId: object.id,
      enabled: object.enabled !== false,
      status: statusOf(object),
      hostId: options.hostId ?? null,
      checkedAtMs: Date.now(),
      lastError: null,
    }
    await record(mode, domain, next)
    return { domain, outcome: 'registered', record: next }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await record(mode, domain, {
      enabled: false,
      hostId: options.hostId ?? null,
      lastError: message.slice(0, 500),
    }).catch(() => undefined)
    return { domain, outcome: 'failed', error: message }
  }
}

/**
 * Disable a domain the platform no longer serves for a site. Stripe has no
 * delete for a payment method domain; disabling stops every method on it, and
 * `ensurePaymentMethodDomain` re-enables the same registration if the name is
 * connected again.
 */
export async function disablePaymentMethodDomain(
  rawDomain: string,
): Promise<{ domain: string; outcome: 'disabled' | 'absent' | 'skipped' | 'failed'; error?: string }> {
  const domain = registrableDomain(rawDomain)
  const mode = stripeModeOfKey(process.env.STRIPE_SECRET_KEY)
  if (!domain || !mode) return { domain: String(rawDomain ?? ''), outcome: 'skipped' }
  try {
    const existing = await findOnStripe(domain)
    if (!existing) {
      await record(mode, domain, { enabled: false, stripeId: null, lastError: null })
      return { domain, outcome: 'absent' }
    }
    const object = existing.enabled
      ? await stripeRequest<StripeDomainObject>(
          'POST',
          `payment_method_domains/${encodeURIComponent(existing.id)}`,
          { enabled: 'false' },
        )
      : existing
    await record(mode, domain, {
      stripeId: object.id,
      enabled: false,
      status: statusOf(object),
      lastError: null,
    })
    return { domain, outcome: 'disabled' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { domain, outcome: 'failed', error: message }
  }
}

/**
 * Is a name still served for some OTHER site? A custom domain's `www.` twin
 * can be another site's own `cname`, and an aglyn subdomain released by a
 * deleted site can already belong to a new one. Disabling either would take
 * Apple Pay away from a store that did nothing.
 */
export async function domainStillClaimed(domain: string, exceptHostId: string): Promise<boolean> {
  const firestore = firebaseAdmin.app().firestore()
  const hosts = firestore.collection('hosts')
  const names = customDomainNames(domain)
  const byCname = await hosts
    .where('cname', 'in', names.length ? names : [domain])
    .limit(3)
    .get()
  if (byCname.docs.some((doc) => doc.id !== exceptHostId)) return true
  const suffix = `.${TENANT_APEX}`
  if (domain.endsWith(suffix)) {
    const subdomain = domain.slice(0, -suffix.length)
    const bySubdomain = await hosts.where('subdomain', '==', subdomain).limit(3).get()
    if (bySubdomain.docs.some((doc) => doc.id !== exceptHostId)) return true
  }
  return false
}

/**
 * The checkout's hook: register the domain the shopper is paying on, within a
 * budget, before the client secret goes back to the browser. Only a name the
 * SITE answers on is ever registered — the return URL has already been judged
 * against `siteOwnHosts` by `siteReturnUrl`, and it is judged again here so a
 * forged `Host` can never make the platform register a stranger's domain.
 */
export async function ensureCheckoutDomain(input: {
  pageUrl: string
  site: SiteReturnHost | null | undefined
  hostId: string
  budgetMs?: number
}): Promise<EnsureDomainResult | null> {
  let hostname: string
  try {
    hostname = new URL(input.pageUrl).hostname.toLowerCase()
  } catch {
    return null
  }
  if (!siteOwnHosts(input.site).includes(hostname)) return null
  if (!registrableDomain(hostname)) return null
  const controller = new AbortController()
  const budget = input.budgetMs ?? CHECKOUT_DOMAIN_BUDGET_MS
  const timer = setTimeout(() => controller.abort(), budget)
  try {
    return await ensurePaymentMethodDomain(hostname, {
      hostId: input.hostId,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

/** One page of the daily reconcile. */
export const RECONCILE_PAGE_SIZE = 200

/**
 * The backfill and the safety net in one pass: every site with a connected
 * custom domain gets its domain and `www.` twin registered. A cached, enabled
 * registration costs one read and no Stripe call, so the steady state is cheap;
 * a domain connected before AGL-3629, or whose connect event was lost, is
 * registered on the first pass after it.
 *
 * Paged by `cname` with a cursor so it reads every site once and stops; the
 * `cname > ''` range uses Firestore's automatic single-field index.
 */
export async function reconcileCustomDomains(
  gate: { isLocked(hostId: string): Promise<boolean> },
  options: { maxPages?: number } = {},
): Promise<{ hosts: number; registered: number; failed: number; skippedLocked: number }> {
  const result = { hosts: 0, registered: 0, failed: 0, skippedLocked: 0 }
  if (!stripeModeOfKey(process.env.STRIPE_SECRET_KEY)) return result
  const firestore = firebaseAdmin.app().firestore()
  let cursor: string | null = null
  const maxPages = options.maxPages ?? 50
  for (let page = 0; page < maxPages; page += 1) {
    let query = firestore
      .collection('hosts')
      .where('cname', '>', '')
      .orderBy('cname')
      .limit(RECONCILE_PAGE_SIZE)
    if (cursor) query = query.startAfter(cursor)
    const snapshot = await query.get()
    if (snapshot.empty) break
    for (const hostDoc of snapshot.docs) {
      result.hosts += 1
      // Skipped, not dropped: a locked site is left as it is and picked up on
      // the first pass after the lift.
      if (await gate.isLocked(hostDoc.id)) {
        result.skippedLocked += 1
        continue
      }
      for (const domain of customDomainNames(hostDoc.get('cname'))) {
        const outcome = await ensurePaymentMethodDomain(domain, { hostId: hostDoc.id })
        if (outcome.outcome === 'registered') result.registered += 1
        if (outcome.outcome === 'failed') result.failed += 1
      }
    }
    cursor = String(snapshot.docs[snapshot.docs.length - 1]?.get('cname') ?? '')
    if (snapshot.size < RECONCILE_PAGE_SIZE || !cursor) break
  }
  return result
}

/** Core's `host.domain.attached`: register the custom domain and its twin. */
export async function onHostDomainAttached(payload: {
  hostId: string
  domain: string
}): Promise<void> {
  for (const domain of customDomainNames(payload.domain)) {
    const outcome = await ensurePaymentMethodDomain(domain, {
      hostId: payload.hostId,
      force: true,
    })
    if (outcome.outcome === 'failed') {
      console.warn(`[commerce] payment method domain ${domain} not registered: ${outcome.error}`)
    }
  }
}

/** Core's `host.domain.released`: disable what no other site still serves. */
export async function onHostDomainReleased(payload: {
  hostId: string
  domain: string
}): Promise<void> {
  const names = payload.domain.endsWith(`.${TENANT_APEX}`)
    ? [registrableDomain(payload.domain)].filter((name): name is string => Boolean(name))
    : customDomainNames(payload.domain)
  for (const domain of names) {
    if (await domainStillClaimed(domain, payload.hostId)) continue
    const outcome = await disablePaymentMethodDomain(domain)
    if (outcome.outcome === 'failed') {
      console.warn(`[commerce] payment method domain ${domain} not disabled: ${outcome.error}`)
    }
  }
}

/** The registrations a settings card shows for one site. */
export async function readSiteDomainRecords(
  site: SiteReturnHost | null | undefined,
): Promise<PaymentMethodDomainRecord[]> {
  const mode = stripeModeOfKey(process.env.STRIPE_SECRET_KEY)
  if (!mode) return []
  const names = siteOwnHosts(site).filter((name) => registrableDomain(name))
  const snapshots = await Promise.all(names.map((name) => docRef(mode, name).get()))
  return snapshots.map((snapshot, index) => {
    const data = (snapshot.exists ? snapshot.data?.() : null) as PaymentMethodDomainRecord | null
    return (
      data ?? {
        domain: names[index],
        mode,
        stripeId: null,
        enabled: false,
        status: { applePay: null, googlePay: null, link: null, amazonPay: null, klarna: null },
        hostId: null,
        checkedAtMs: 0,
        lastError: null,
      }
    )
  })
}
