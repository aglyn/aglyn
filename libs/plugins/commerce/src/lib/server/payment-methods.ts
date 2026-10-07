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

import { checkEntitlement, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import type { SiteReturnHost } from '@aglyn/aglyn/app-utils/site-return-url'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import {
  isStorefrontPaymentMethodOn,
  normalizeStorefrontPaymentMethodSettings,
  STOREFRONT_PAYMENT_METHODS,
  type StorefrontPaymentMethodId,
  type StorefrontPaymentMethodSettings,
} from '../model/commerce-payment-methods'
import {
  type PaymentMethodDomainRecord,
  readSiteDomainRecords,
} from './payment-method-domains'

/**
 * The merchant's payment methods card (AGL-3629):
 * `GET|POST /api/commerce/payment-methods?hostId=…`, served by the console.
 *
 * GET answers, per method, three facts the card needs and no client can read:
 *
 *  - whether the PLATFORM offers it (its default payment method configuration
 *    — storefront charges are destination charges with the platform as
 *    merchant of record, so that configuration is the ceiling). A method the
 *    platform has not turned on, or that Stripe has not made available to it,
 *    is reported `unavailable` and the card does not show it at all;
 *  - the connected account's capability for it, which Stripe asks platforms to
 *    request before an account accepts BNPL, Cash App, Amazon Pay or crypto;
 *  - the site's domain registrations, which Apple Pay depends on.
 *
 * POST saves the toggles to `hosts/{hostId}/settings/store.paymentMethods` and
 * requests the capability of each method turned on, in one account update with
 * an idempotency key. Server-side, because the toggle and the capability are
 * one decision: a toggle saved by the browser with no capability behind it
 * would read as on and never appear.
 */

export type PlatformAvailability = 'on' | 'unavailable' | null

export type CapabilityStatus = 'active' | 'pending' | 'inactive' | 'unrequested' | null

export interface PaymentMethodRow {
  id: StorefrontPaymentMethodId
  on: boolean
  platform: PlatformAvailability
  capability: CapabilityStatus
}

export interface PaymentMethodsAnswer {
  methods: PaymentMethodRow[]
  domains: PaymentMethodDomainRecord[]
  accountConnected: boolean
  /** The caller may save toggles: a site admin. */
  canEdit: boolean
  /** The caller may open Stripe to finish a method: the organization owner. */
  canFinish: boolean
  warnings: string[]
}

/** How long the platform's configuration is trusted in memory. */
const PLATFORM_CONFIGURATION_TTL_MS = 10 * 60 * 1000

let platformCache: { at: number; value: Record<string, PlatformAvailability> } | null = null

/** Test seam: forget the cached platform configuration. */
export function resetPlatformPaymentMethodCacheForTests(): void {
  platformCache = null
}

async function stripe<T>(
  method: 'GET' | 'POST',
  path: string,
  params?: URLSearchParams,
  idempotencyKey?: string,
): Promise<T> {
  const query = method === 'GET' && params ? `?${params}` : ''
  const response = await fetch(`https://api.stripe.com/v1/${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      ...(method === 'POST' && { 'Content-Type': 'application/x-www-form-urlencoded' }),
      ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }),
    },
    ...(method === 'POST' && params && { body: params.toString() }),
  })
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string }
  }
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Stripe ${path} failed (${response.status})`)
  }
  return payload
}

interface StripeConfiguration {
  is_default?: boolean
  application?: string | null
  active?: boolean
  [key: string]: unknown
}

/**
 * Which methods the platform's own default configuration offers. The list
 * also returns configurations OTHER Connect applications made for this
 * account (`application` set); those do not govern our sessions and are
 * skipped. `null` per method when Stripe could not be asked — the card then
 * shows the toggle without a verdict rather than hiding a method that may work.
 */
export async function platformPaymentMethodAvailability(): Promise<
  Record<string, PlatformAvailability>
> {
  if (platformCache && Date.now() - platformCache.at < PLATFORM_CONFIGURATION_TTL_MS) {
    return platformCache.value
  }
  const value: Record<string, PlatformAvailability> = {}
  try {
    const list = await stripe<{ data?: StripeConfiguration[] }>(
      'GET',
      'payment_method_configurations',
      new URLSearchParams({ limit: '20' }),
    )
    const own =
      list.data?.find((entry) => entry.is_default && !entry.application) ??
      list.data?.find((entry) => !entry.application) ??
      null
    for (const method of STOREFRONT_PAYMENT_METHODS) {
      if (!own) {
        value[method.id] = null
        continue
      }
      const entry = own[method.configurationKey] as
        | { available?: boolean; display_preference?: { value?: string } }
        | undefined
      value[method.id] =
        entry?.available === true && entry?.display_preference?.value === 'on'
          ? 'on'
          : 'unavailable'
    }
    platformCache = { at: Date.now(), value }
  } catch (error) {
    console.warn('[commerce] payment method configuration unreadable', error)
    for (const method of STOREFRONT_PAYMENT_METHODS) value[method.id] = null
  }
  return value
}

function capabilityStatus(
  capabilities: Record<string, string> | undefined,
  key: string | undefined,
): CapabilityStatus {
  if (!key) return null
  const status = capabilities?.[key]
  if (status === 'active' || status === 'pending' || status === 'inactive') return status
  return 'unrequested'
}

async function readAccountCapabilities(
  accountId: string | null,
): Promise<Record<string, string> | undefined> {
  if (!accountId) return undefined
  try {
    const account = await stripe<{ capabilities?: Record<string, string> }>(
      'GET',
      `accounts/${encodeURIComponent(accountId)}`,
    )
    return account.capabilities ?? {}
  } catch (error) {
    console.warn('[commerce] connected account unreadable', error)
    return undefined
  }
}

/** The capabilities a save asks Stripe for: on, offered, not yet requested. */
export function capabilitiesToRequest(
  settings: StorefrontPaymentMethodSettings,
  platform: Record<string, PlatformAvailability>,
  capabilities: Record<string, string> | undefined,
): string[] {
  return STOREFRONT_PAYMENT_METHODS.filter(
    (method) =>
      method.capability &&
      isStorefrontPaymentMethodOn(settings, method.id) &&
      platform[method.id] !== 'unavailable' &&
      capabilityStatus(capabilities, method.capability) === 'unrequested',
  ).map((method) => method.capability as string)
}

export function buildPaymentMethodRows(
  settings: StorefrontPaymentMethodSettings,
  platform: Record<string, PlatformAvailability>,
  capabilities: Record<string, string> | undefined,
): PaymentMethodRow[] {
  return STOREFRONT_PAYMENT_METHODS.map((method) => ({
    id: method.id,
    on: isStorefrontPaymentMethodOn(settings, method.id),
    platform: platform[method.id] ?? null,
    capability: capabilities ? capabilityStatus(capabilities, method.capability) : null,
  }))
}

const json = (body: unknown, status = 200) => Response.json(body, { status })

/**
 * Where Stripe sends the owner back: the console page they pressed the button
 * on, judged against the request's own origin so a forged `Referer` cannot
 * turn the link into a redirect to somewhere else.
 */
export function consoleReturnUrl(headers: Partial<Record<string, string>>): string {
  const origin = headers.origin || (headers.host ? `https://${headers.host}` : '')
  const referer = headers.referer ?? ''
  try {
    if (origin && referer && new URL(referer).origin === new URL(origin).origin) {
      return referer
    }
  } catch {
    // Unparseable: fall through to the origin.
  }
  return origin || 'https://localhost/'
}

export async function paymentMethodsHandler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders, query, body } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return json({ error: 'Payments are not configured (STRIPE_SECRET_KEY).' }, 501)
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return json({ error: 'Unauthenticated' }, 401)

  const parsed =
    typeof body === 'string' ? (JSON.parse(body || '{}') as Record<string, unknown>) : (body ?? {})
  const hostId = String(
    (method === 'GET' ? query?.['hostId'] : (parsed as Record<string, unknown>)['hostId']) ?? '',
  )
  if (!hostId) return json({ error: 'Missing hostId' }, 400)

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) return json({ error: 'Not found' }, 404)

    // An allowlist. Reading the card is for whoever manages the store; a
    // change asks Stripe for capabilities on the owner's payout account, so it
    // is an admin's, like connecting that account is the owner's.
    const role = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    const mayRead = role === 'admin' || role === 'editor'
    if (!mayRead) return json({ error: 'Not found' }, 404)
    if (method === 'POST' && role !== 'admin') {
      return json({ error: 'Only a site admin can change payment methods' }, 403)
    }

    const owner = await getOrgForHost(hostId)
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: owner?.org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked
    if (!checkEntitlement((owner?.org ?? {}) as never, 'commerce')) {
      return json({ error: 'Selling is not included on this plan' }, 402)
    }

    const ownerUid = String(owner?.org?.ownerUid ?? '')
    const accountId = ownerUid
      ? (((await firestore.collection('profiles').doc(ownerUid).get()).get(
          'stripeAccountId',
        ) as string | undefined) ?? null)
      : null

    const storeRef = hostRef.collection('settings').doc('store')
    let settings = normalizeStorefrontPaymentMethodSettings(
      (await storeRef.get()).get('paymentMethods'),
    )
    const platform = await platformPaymentMethodAvailability()
    let capabilities = await readAccountCapabilities(accountId)
    const warnings: string[] = []

    // FINISH IN STRIPE: a capability Stripe holds `inactive` needs details
    // only the account holder can give, and an Express account has no login of
    // its own, so a link minted here is the only way in. The owner's alone,
    // as connecting the account is (`connect.ts`): the link opens the owner's
    // identity and bank details.
    if (method === 'POST' && (parsed as Record<string, unknown>)['action'] === 'finish') {
      if (!accountId || decoded.uid !== ownerUid) {
        return json({ error: 'Only the organization owner can finish this in Stripe' }, 403)
      }
      const back = consoleReturnUrl(headers)
      const link = await stripe<{ url?: string }>(
        'POST',
        'account_links',
        new URLSearchParams({
          account: accountId,
          type: 'account_onboarding',
          'collection_options[fields]': 'currently_due',
          refresh_url: back,
          return_url: back,
        }),
      )
      return json({ url: link.url ?? null })
    }

    if (method === 'POST') {
      const requested = normalizeStorefrontPaymentMethodSettings(
        (parsed as Record<string, unknown>)['methods'],
      )
      if (!Object.keys(requested).length) {
        return json({ error: 'Nothing to save' }, 400)
      }
      settings = { ...settings, ...requested }
      await storeRef.set(
        { paymentMethods: settings, paymentMethodsUpdatedAtMs: Date.now(), paymentMethodsUpdatedBy: decoded.uid },
        { merge: true },
      )
      const wanted = accountId ? capabilitiesToRequest(settings, platform, capabilities) : []
      if (accountId && wanted.length) {
        const params = new URLSearchParams()
        for (const capability of wanted) {
          params.set(`capabilities[${capability}][requested]`, 'true')
        }
        try {
          const account = await stripe<{ capabilities?: Record<string, string> }>(
            'POST',
            `accounts/${encodeURIComponent(accountId)}`,
            params,
            `aglyn-pm-capabilities:${accountId}:${[...wanted].sort().join(',')}`,
          )
          capabilities = account.capabilities ?? capabilities
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          warnings.push(
            `Stripe did not accept the request to enable ${wanted.join(', ')} on your payout account: ${message}`,
          )
        }
      }
    }

    const answer: PaymentMethodsAnswer = {
      methods: buildPaymentMethodRows(settings, platform, capabilities),
      domains: await readSiteDomainRecords(hostSnapshot.data() as SiteReturnHost | undefined),
      accountConnected: Boolean(accountId),
      canEdit: role === 'admin',
      canFinish: Boolean(accountId) && decoded.uid === ownerUid,
      warnings,
    }
    return json(answer)
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return json({ error: 'Payment methods could not be loaded' }, 500)
  }
}
