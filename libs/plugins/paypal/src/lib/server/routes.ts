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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { firebaseAdmin, resolveOrgMembership } from '@aglyn/tenant-data-admin'
import { isEmailVerified, isImpersonationSession } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { PAYPAL_ENTITLEMENT } from '../constants'
import {
  capturePayPalCheckout,
  changePayPalShipping,
  checkPayPalAddress,
  openPayPalOrder,
  payPalAmount,
  PayPalCheckoutRefusal,
  readCheckout,
  type PayPalFundingSource,
} from './checkouts'
import { payPalConfigForMoney, readPayPalConfig } from './config'
import { isDocumentId, payPalDb } from './db'
import { renderPayNotice, renderPayPage } from './pay-page'
import { PayPalApiError } from './paypal-api'
import { disconnectSeller, readSeller, refreshSeller, sellerView, startSellerOnboarding } from './sellers'
import { applyPayPalWebhook, verifyPayPalWebhook, type PayPalWebhookEvent } from './webhooks'

/**
 * PayPal's routes (AGL-3630). Three kinds:
 *
 * - the workspace owner's, on the console: the seller account — read it,
 *   connect it through PayPal's onboarding, re-read it, disconnect it. Each
 *   names its workspace (`?orgId=`) and answers 404 while the deployment is
 *   not configured, which is what hides every PayPal surface;
 * - the buyer's, on both apps: the pay page and the four calls PayPal's
 *   buttons make from it. Each names its checkout (`?c=`) and nothing else;
 *   the record decides the rest, so a buyer can only ever act on the
 *   checkout whose link they hold;
 * - PayPal's webhook, on the console, verified with PayPal first.
 */

const NO_STORE = { 'Cache-Control': 'no-store' }

const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: NO_STORE })
const fail = (status: number, error: string): Response => json({ error }, status)

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET') return {}
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

interface Member {
  uid: string
  orgId: string
  org: Record<string, unknown>
  owner: boolean
  body: Record<string, unknown>
}

/** A signed-in member of the named workspace, or the refusal. */
async function memberGate(request: Request, options: { owner: boolean }): Promise<Member | Response> {
  if (!readPayPalConfig().configured) return fail(404, 'Not found')
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return fail(401, 'Unauthenticated')
  let decoded
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(authorization.slice('Bearer '.length))
  } catch (error) {
    if (!isRefusedIdToken(error)) throw error
    return fail(401, 'Unauthenticated')
  }
  if (!isEmailVerified(decoded) && !isImpersonationSession(decoded)) return fail(403, 'Verify your email address first')
  const orgId = new URL(request.url).searchParams.get('orgId') ?? ''
  if (!isDocumentId(orgId)) return fail(400, 'Missing orgId')
  const orgSnapshot = await payPalDb().collection('orgs').doc(orgId).get()
  if (!orgSnapshot.exists) return fail(404, 'Not found')
  const org = (orgSnapshot.data() ?? {}) as Record<string, unknown>
  const staff = decoded['staff'] === true
  const membership = staff ? null : await resolveOrgMembership(decoded.uid, orgId)
  if (!staff && !membership) return fail(403, 'Not permitted')
  const owner = String(org['ownerUid'] ?? '') === decoded.uid
  if (options.owner && !owner) return fail(403, 'Only the workspace owner can connect PayPal')
  return { uid: decoded.uid, orgId, org, owner, body: await readBody(request) }
}

function refusal(error: unknown): Response {
  if (error instanceof PayPalCheckoutRefusal) return fail(error.status, error.message)
  if (error instanceof PayPalApiError) {
    console.error('[paypal]', error.message)
    return fail(502, 'PayPal could not be reached. Try again.')
  }
  throw error
}

/** `GET ?orgId` */
export async function sellerRoute(request: Request): Promise<Response> {
  const member = await memberGate(request, { owner: false })
  if (member instanceof Response) return member
  const config = readPayPalConfig()
  if (!config.configured) return fail(404, 'Not found')
  const money = payPalConfigForMoney()
  return json({
    offered: Boolean(money) && checkEntitlement(member.org as never, PAYPAL_ENTITLEMENT as never),
    seller: sellerView(await readSeller(member.orgId), config.config),
    canManage: member.owner,
  })
}

/**
 * Where PayPal sends the owner back: the console page they started from,
 * and only on this console's own origin.
 */
function returnUrlFor(request: Request, asked: unknown): string | null {
  const origin = new URL(request.url).origin
  try {
    const url = new URL(String(asked ?? ''))
    if (url.origin !== origin) return null
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null
    url.searchParams.set('paypal', 'returned')
    return url.toString()
  } catch {
    return null
  }
}

/** `POST ?orgId` `{ returnUrl }` */
export async function sellerOnboardRoute(request: Request): Promise<Response> {
  const member = await memberGate(request, { owner: true })
  if (member instanceof Response) return member
  const config = payPalConfigForMoney()
  if (!config) return fail(409, 'PayPal is not available on this deployment.')
  if (!checkEntitlement(member.org as never, PAYPAL_ENTITLEMENT as never)) {
    return fail(403, 'Your plan does not include selling.')
  }
  const returnUrl = returnUrlFor(request, member.body['returnUrl'])
  if (!returnUrl) return fail(400, 'Missing returnUrl')
  try {
    const started = await startSellerOnboarding(config, { orgId: member.orgId, uid: member.uid, returnUrl })
    return json(started ?? { ready: true })
  } catch (error) {
    return refusal(error)
  }
}

/** `POST ?orgId` */
export async function sellerRefreshRoute(request: Request): Promise<Response> {
  const member = await memberGate(request, { owner: false })
  if (member instanceof Response) return member
  const config = readPayPalConfig()
  if (!config.configured) return fail(404, 'Not found')
  try {
    const seller = await refreshSeller(config.config, member.orgId)
    return json({ seller: sellerView(seller, config.config), canManage: member.owner })
  } catch (error) {
    return refusal(error)
  }
}

/** `POST ?orgId` */
export async function sellerDisconnectRoute(request: Request): Promise<Response> {
  const member = await memberGate(request, { owner: true })
  if (member instanceof Response) return member
  const config = readPayPalConfig()
  if (!config.configured) return fail(404, 'Not found')
  await disconnectSeller(member.orgId)
  return json({ seller: sellerView(await readSeller(member.orgId), config.config), canManage: true })
}

/** The checkout a buyer's request names, by its `?c=`. */
function checkoutIdOf(request: Request): string {
  return new URL(request.url).searchParams.get('c') ?? ''
}

/** `GET ?c` — the page. */
export async function payRoute(request: Request): Promise<Response> {
  const config = payPalConfigForMoney()
  const record = await readCheckout(checkoutIdOf(request))
  if (!record) return renderPayNotice('Checkout not found', 'This checkout link is not valid.', null)
  if (!config || record.environment !== config.environment) {
    return renderPayNotice('PayPal is unavailable', 'PayPal is not available for this store right now. Nothing was charged.', record.cancelUrl)
  }
  return renderPayPage({ record, recordId: checkoutIdOf(request), config })
}

/** `POST ?c` `{ source }` */
export async function payOrderRoute(request: Request): Promise<Response> {
  const config = payPalConfigForMoney()
  if (!config) return fail(404, 'Not found')
  const body = await readBody(request)
  const source: PayPalFundingSource = body['source'] === 'venmo' ? 'venmo' : 'paypal'
  try {
    return json({ orderId: await openPayPalOrder(config, checkoutIdOf(request), source) })
  } catch (error) {
    return refusal(error)
  }
}

/** `POST ?c` `{ orderId, optionId }` */
export async function payShippingRoute(request: Request): Promise<Response> {
  const config = payPalConfigForMoney()
  if (!config) return fail(404, 'Not found')
  const body = await readBody(request)
  const recordId = checkoutIdOf(request)
  try {
    await changePayPalShipping(config, recordId, String(body['orderId'] ?? ''), String(body['optionId'] ?? ''))
    const record = await readCheckout(recordId)
    if (!record) return fail(404, 'Not found')
    const { totals } = payPalAmount(record, String(body['optionId'] ?? ''))
    let total = ''
    try {
      total = new Intl.NumberFormat('en-US', { style: 'currency', currency: record.currency.toUpperCase() }).format(
        totals.totalCents / (['huf', 'jpy', 'twd'].includes(record.currency) ? 1 : 100),
      )
    } catch {
      total = ''
    }
    return json({ ok: true, ...(total ? { total } : {}) })
  } catch (error) {
    return refusal(error)
  }
}

/** `POST ?c` `{ country }` */
export async function payAddressRoute(request: Request): Promise<Response> {
  const body = await readBody(request)
  return json({ delivers: await checkPayPalAddress(checkoutIdOf(request), String(body['country'] ?? '')) })
}

/** `POST ?c` `{ orderId }` */
export async function payCaptureRoute(request: Request): Promise<Response> {
  const config = payPalConfigForMoney()
  if (!config) return fail(404, 'Not found')
  const body = await readBody(request)
  try {
    const outcome = await capturePayPalCheckout(config, checkoutIdOf(request), String(body['orderId'] ?? ''))
    switch (outcome.kind) {
      case 'captured':
        return json({ redirectUrl: outcome.redirectUrl })
      case 'pending':
        return json({ pending: true, message: outcome.message }, 202)
      case 'restart':
        return json({ restart: true, error: outcome.message }, 409)
      default:
        return fail(outcome.status, outcome.message)
    }
  } catch (error) {
    return refusal(error)
  }
}

/** `POST` — PayPal's webhook. */
export async function webhookRoute(request: Request): Promise<Response> {
  const read = readPayPalConfig()
  if (!read.configured) return fail(404, 'Not found')
  const text = await request.text().catch(() => '')
  let event: PayPalWebhookEvent
  try {
    event = JSON.parse(text) as PayPalWebhookEvent
  } catch {
    return fail(400, 'Not JSON')
  }
  if (!(await verifyPayPalWebhook(read.config, request.headers, event))) return fail(400, 'Unverified')
  try {
    return json({ result: await applyPayPalWebhook(read.config, event) })
  } catch (error) {
    console.error('[paypal] webhook failed; PayPal will redeliver', { id: event.id, type: event.event_type }, error)
    return fail(500, 'Not applied')
  }
}
