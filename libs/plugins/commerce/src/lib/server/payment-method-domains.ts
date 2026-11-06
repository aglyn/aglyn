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
import { directSellerAccountForHost } from './seller-stripe-account'

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
 * registers the domain, with no `Stripe-Account` header.
 *
 * A DIRECT-charge seller runs its own charges: the session is created on the
 * seller's connected account, so Apple Pay and Google Pay show only on a
 * domain registered ON THAT ACCOUNT (`Stripe-Account` header). Every entry
 * point below takes the seller's account for that case, and the platform's
 * registration is left as it is, because the seller's hardware purchases and
 * any sale from before the switch still run on the platform.
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
 * a domain registered in one is not registered in the other. A seller's
 * registration is cached under its own id, `{mode}~{account}~{domain}`,
 * because it is a different Stripe object from the platform's for the same
 * name. Server-only: the rules deny every client.
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
  /**
   * The connected account the domain is registered on, for a direct-charge
   * seller; absent or null for the platform's own registration.
   */
  stripeAccount?: string | null
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

/**
 * The cache document id for a domain in a mode, on the platform or on one
 * seller's connected account.
 */
export function paymentMethodDomainDocId(
  mode: StripeMode,
  domain: string,
  stripeAccount?: string | null,
): string {
  const account = accountOrNull(stripeAccount)
  return account ? `${mode}~${account}~${domain}` : `${mode}~${domain}`
}

/** A usable connected-account id, or null for "the platform". */
function accountOrNull(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : ''
  return /^acct_[A-Za-z0-9]+$/.test(id) ? id : null
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
  options: {
    idempotencyKey?: string
    signal?: AbortSignal
    stripeAccount?: string | null
  } = {},
): Promise<T> {
  const query = method === 'GET' && params ? `?${new URLSearchParams(params)}` : ''
  const response = await fetch(`https://api.stripe.com/v1/${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      ...(method === 'POST' && {
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
      // The platform's own key and NO `Stripe-Account` for the platform's
      // registration (destination charges are run by the platform); the
      // seller's account for a direct-charge seller, who runs its own.
      ...(options.stripeAccount && { 'Stripe-Account': options.stripeAccount }),
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
  stripeAccount?: string | null,
): Promise<StripeDomainObject | null> {
  const list = await stripeRequest<{ data?: StripeDomainObject[] }>(
    'GET',
    'payment_method_domains',
    { domain_name: domain, limit: '1' },
    { signal, stripeAccount },
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
  return registerDomain(domain, { signal })
}

/**
 * Register (or re-enable) one domain on a direct-charge seller's connected
 * account: the same steps as {@link registerOnPlatform}, each sent with the
 * seller's `Stripe-Account`.
 */
export async function registerOnAccount(
  domain: string,
  stripeAccount: string,
  signal?: AbortSignal,
): Promise<StripeDomainObject> {
  return registerDomain(domain, { signal, stripeAccount })
}

async function registerDomain(
  domain: string,
  options: { signal?: AbortSignal; stripeAccount?: string | null },
): Promise<StripeDomainObject> {
  const { signal } = options
  const stripeAccount = accountOrNull(options.stripeAccount)
  const existing = await findOnStripe(domain, signal, stripeAccount)
  if (existing) {
    if (existing.enabled) return existing
    return stripeRequest<StripeDomainObject>(
      'POST',
      `payment_method_domains/${encodeURIComponent(existing.id)}`,
      { enabled: 'true' },
      { signal, stripeAccount },
    )
  }
  try {
    return await stripeRequest<StripeDomainObject>(
      'POST',
      'payment_method_domains',
      { domain_name: domain, enabled: 'true' },
      {
        // Stripe scopes the key per account; the account is in it anyway so
        // a log line names which registration it was.
        idempotencyKey: stripeAccount
          ? `aglyn-pmd-register:${stripeAccount}:${domain}`
          : `aglyn-pmd-register:${domain}`,
        signal,
        stripeAccount,
      },
    )
  } catch (error) {
    // Lost a race to a create that landed between the lookup and this call:
    // the registration exists, which is what was wanted.
    const raced = await findOnStripe(domain, signal, stripeAccount).catch(() => null)
    if (raced) return raced
    throw error
  }
}

function docRef(mode: StripeMode, domain: string, stripeAccount?: string | null) {
  return firebaseAdmin
    .app()
    .firestore()
    .collection(PAYMENT_METHOD_DOMAINS_COLLECTION)
    .doc(paymentMethodDomainDocId(mode, domain, stripeAccount))
}

async function record(
  mode: StripeMode,
  domain: string,
  patch: Partial<PaymentMethodDomainRecord>,
  stripeAccount?: string | null,
): Promise<void> {
  const account = accountOrNull(stripeAccount)
  await docRef(mode, domain, account).set(
    {
      domain,
      mode,
      // Only a seller's registration names an account, so the platform's
      // documents are written exactly as before.
      ...(account ? { stripeAccount: account } : {}),
      checkedAtMs: Date.now(),
      ...patch,
    },
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
  options: {
    hostId?: string | null
    signal?: AbortSignal
    force?: boolean
    /** Register on this direct-charge seller's account, not the platform. */
    stripeAccount?: string | null
  } = {},
): Promise<EnsureDomainResult> {
  const domain = registrableDomain(rawDomain)
  const mode = stripeModeOfKey(process.env.STRIPE_SECRET_KEY)
  if (!domain || !mode) {
    return { domain: String(rawDomain ?? ''), outcome: 'skipped' }
  }
  const account = accountOrNull(options.stripeAccount)
  try {
    if (!options.force) {
      const cached = await docRef(mode, domain, account).get()
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
    const object = account
      ? await registerOnAccount(domain, account, options.signal)
      : await registerOnPlatform(domain, options.signal)
    const next: PaymentMethodDomainRecord = {
      domain,
      mode,
      ...(account ? { stripeAccount: account } : {}),
      stripeId: object.id,
      enabled: object.enabled !== false,
      status: statusOf(object),
      hostId: options.hostId ?? null,
      checkedAtMs: Date.now(),
      lastError: null,
    }
    await record(mode, domain, next, account)
    return { domain, outcome: 'registered', record: next }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await record(
      mode,
      domain,
      {
        enabled: false,
        hostId: options.hostId ?? null,
        lastError: message.slice(0, 500),
      },
      account,
    ).catch(() => undefined)
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
  options: { stripeAccount?: string | null } = {},
): Promise<{ domain: string; outcome: 'disabled' | 'absent' | 'skipped' | 'failed'; error?: string }> {
  const domain = registrableDomain(rawDomain)
  const mode = stripeModeOfKey(process.env.STRIPE_SECRET_KEY)
  if (!domain || !mode) return { domain: String(rawDomain ?? ''), outcome: 'skipped' }
  const account = accountOrNull(options.stripeAccount)
  try {
    const existing = await findOnStripe(domain, undefined, account)
    if (!existing) {
      await record(mode, domain, { enabled: false, stripeId: null, lastError: null }, account)
      return { domain, outcome: 'absent' }
    }
    const object = existing.enabled
      ? await stripeRequest<StripeDomainObject>(
          'POST',
          `payment_method_domains/${encodeURIComponent(existing.id)}`,
          { enabled: 'false' },
          { stripeAccount: account },
        )
      : existing
    await record(
      mode,
      domain,
      {
        stripeId: object.id,
        enabled: false,
        status: statusOf(object),
        lastError: null,
      },
      account,
    )
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
  /**
   * The seller's connected account when this checkout is a DIRECT charge:
   * the session runs there, so the domain must be registered there.
   */
  stripeAccount?: string
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
      ...(input.stripeAccount ? { stripeAccount: input.stripeAccount } : {}),
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
  options: {
    maxPages?: number
    /** The site's direct-charge seller account, or null (tests inject it). */
    sellerAccount?: (hostId: string) => Promise<string | null>
  } = {},
): Promise<{ hosts: number; registered: number; failed: number; skippedLocked: number }> {
  const sellerAccount = options.sellerAccount ?? directSellerAccountForHost
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
      // A direct-charge seller runs its own charges, so its domains are
      // registered on its account as well as the platform's.
      const account = await sellerAccount(hostDoc.id).catch(() => null)
      for (const domain of customDomainNames(hostDoc.get('cname'))) {
        for (const stripeAccount of account ? [null, account] : [null]) {
          const outcome = await ensurePaymentMethodDomain(domain, {
            hostId: hostDoc.id,
            ...(stripeAccount ? { stripeAccount } : {}),
          })
          if (outcome.outcome === 'registered') result.registered += 1
          if (outcome.outcome === 'failed') result.failed += 1
        }
      }
    }
    cursor = String(snapshot.docs[snapshot.docs.length - 1]?.get('cname') ?? '')
    if (snapshot.size < RECONCILE_PAGE_SIZE || !cursor) break
  }
  return result
}

/** Core's `host.domain.attached`: register the custom domain and its twin. */
export async function onHostDomainAttached(
  payload: {
    hostId: string
    domain: string
  },
  options: { sellerAccount?: (hostId: string) => Promise<string | null> } = {},
): Promise<void> {
  // The platform's registration as before, and the seller's own as well when
  // the site sells by direct charges, since those sessions run on its account.
  const account = await (options.sellerAccount ?? directSellerAccountForHost)(
    payload.hostId,
  ).catch(() => null)
  for (const domain of customDomainNames(payload.domain)) {
    for (const stripeAccount of account ? [null, account] : [null]) {
      const outcome = await ensurePaymentMethodDomain(domain, {
        hostId: payload.hostId,
        force: true,
        ...(stripeAccount ? { stripeAccount } : {}),
      })
      if (outcome.outcome === 'failed') {
        console.warn(
          `[commerce] payment method domain ${domain}${
            stripeAccount ? ` on ${stripeAccount}` : ''
          } not registered: ${outcome.error}`,
        )
      }
    }
  }
}

/** Core's `host.domain.released`: disable what no other site still serves. */
export async function onHostDomainReleased(
  payload: {
    hostId: string
    domain: string
  },
  options: { sellerAccount?: (hostId: string) => Promise<string | null> } = {},
): Promise<void> {
  const names = payload.domain.endsWith(`.${TENANT_APEX}`)
    ? [registrableDomain(payload.domain)].filter((name): name is string => Boolean(name))
    : customDomainNames(payload.domain)
  const account = await (options.sellerAccount ?? directSellerAccountForHost)(
    payload.hostId,
  ).catch(() => null)
  for (const domain of names) {
    // The PLATFORM's registration is shared by every site that answers on
    // the name, so it waits until no other site does. The seller's own is
    // that seller's alone, and goes with this site's release.
    if (account) {
      const onSeller = await disablePaymentMethodDomain(domain, { stripeAccount: account })
      if (onSeller.outcome === 'failed') {
        console.warn(
          `[commerce] payment method domain ${domain} on ${account} not disabled: ${onSeller.error}`,
        )
      }
    }
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
  /**
   * The site's direct-charge seller account: its registrations are the ones
   * the site's checkout uses, so they are the ones to show.
   */
  stripeAccount?: string | null,
): Promise<PaymentMethodDomainRecord[]> {
  const mode = stripeModeOfKey(process.env.STRIPE_SECRET_KEY)
  if (!mode) return []
  const account = accountOrNull(stripeAccount)
  const names = siteOwnHosts(site).filter((name) => registrableDomain(name))
  const snapshots = await Promise.all(
    names.map((name) => docRef(mode, name, account).get()),
  )
  return snapshots.map((snapshot, index) => {
    const data = (snapshot.exists ? snapshot.data?.() : null) as PaymentMethodDomainRecord | null
    return (
      data ?? {
        domain: names[index],
        mode,
        ...(account ? { stripeAccount: account } : {}),
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
