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
 * A fake of PayPal's REST API for this plugin's specs (AGL-3630), answering
 * in the payload shapes PayPal documents for the sandbox: OAuth, Partner
 * Referrals and merchant integrations, Orders v2 (create, get, patch,
 * capture), capture refunds and webhook verification. It keeps state —
 * orders move CREATED → APPROVED → COMPLETED, refunds add up against the
 * capture — and honors `PayPal-Request-Id` the way PayPal does: a repeated
 * id answers the first call's response and acts once.
 */

export interface FakeCall {
  method: string
  path: string
  headers: Record<string, string>
  body: any
}

interface FakeOrder {
  id: string
  status: 'CREATED' | 'APPROVED' | 'COMPLETED'
  body: any
  payer?: any
  shipping?: any
  captures: any[]
}

export interface FakePayPal {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  calls: FakeCall[]
  orders: Map<string, FakeOrder>
  /** The buyer approves an order in PayPal, choosing an address and option. */
  approve(orderId: string, choice?: { country?: string; postalCode?: string; optionId?: string }): void
  /** The next capture answers this instead of COMPLETED. */
  nextCapture: 'COMPLETED' | 'PENDING' | 'INSTRUMENT_DECLINED' | 'NETWORK'
  /** Whether the seller has finished onboarding (the tracking id resolves). */
  sellerLinked: boolean
  sellerReady: { payments_receivable: boolean; primary_email_confirmed: boolean; granted: boolean }
  /** Whether the next verification succeeds. */
  verifies: boolean
  tokenCalls: number
  callsTo(method: string, pathPrefix: string): FakeCall[]
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'paypal-debug-id': 'f00dbabe', ...headers },
  })

const issue = (status: number, name: string, value: string) =>
  json({ name, message: name, debug_id: 'f00dbabe', details: [{ issue: value, description: value }] }, status)

const cents = (money: any): number => Math.round(Number(money?.value ?? 0) * 100)
const money = (minor: number, code = 'USD') => ({ currency_code: code, value: (minor / 100).toFixed(2) })

export function createFakePayPal(options: { clientId: string; partnerMerchantId: string }): FakePayPal {
  const calls: FakeCall[] = []
  const orders = new Map<string, FakeOrder>()
  const replays = new Map<string, { status: number; body: any }>()
  const refunds = new Map<string, number>()
  let sequence = 0
  const fake: FakePayPal = {
    calls,
    orders,
    nextCapture: 'COMPLETED',
    sellerLinked: true,
    sellerReady: { payments_receivable: true, primary_email_confirmed: true, granted: true },
    verifies: true,
    tokenCalls: 0,
    callsTo: (method, prefix) => calls.filter((call) => call.method === method && call.path.startsWith(prefix)),
    approve(orderId, choice = {}) {
      const order = orders.get(orderId)
      if (!order) throw new Error(`no order ${orderId}`)
      order.status = 'APPROVED'
      order.payer = {
        email_address: 'buyer@example.com',
        payer_id: 'QYR5Z8XDVJNXQ',
        name: { given_name: 'Ada', surname: 'Buyer' },
        address: { country_code: choice.country ?? 'US' },
      }
      const unit = order.body.purchase_units[0]
      if (unit.shipping) {
        const options = unit.shipping.options ?? []
        const chosen = choice.optionId ?? options.find((option: any) => option.selected)?.id ?? options[0]?.id
        unit.shipping.options = options.map((option: any) => ({ ...option, selected: option.id === chosen }))
        const shippingCents = cents(unit.shipping.options.find((option: any) => option.selected)?.amount)
        const breakdown = unit.amount.breakdown
        if (breakdown?.shipping) {
          const previous = cents(breakdown.shipping)
          breakdown.shipping = money(shippingCents)
          unit.amount.value = ((cents(unit.amount) - previous + shippingCents) / 100).toFixed(2)
        }
        order.shipping = {
          name: { full_name: 'Ada Buyer' },
          address: {
            address_line_1: '1 Main St',
            admin_area_2: 'San Jose',
            admin_area_1: 'CA',
            postal_code: choice.postalCode ?? '95131',
            country_code: choice.country ?? 'US',
          },
          options: unit.shipping.options,
        }
      }
    },
    fetch: async (url, init) => {
      const parsed = new URL(url)
      const headers: Record<string, string> = {}
      new Headers(init.headers as HeadersInit).forEach((value, key) => (headers[key.toLowerCase()] = value))
      let body: any = undefined
      if (typeof init.body === 'string') {
        try {
          body = JSON.parse(init.body)
        } catch {
          body = init.body
        }
      }
      const path = `${parsed.pathname}${parsed.search}`
      const method = String(init.method ?? 'GET').toUpperCase()
      calls.push({ method, path, headers, body })
      if (path === '/v1/oauth2/token') {
        fake.tokenCalls++
        return json({ scope: 'https://uri.paypal.com/services/payments/realtimepayment', access_token: `A21AA${fake.tokenCalls}`, token_type: 'Bearer', app_id: 'APP-80W284485P519543T', expires_in: 32400 })
      }
      const requestId = headers['paypal-request-id']
      const replayKey = requestId ? `${method} ${parsed.pathname} ${requestId}` : ''
      if (replayKey && replays.has(replayKey)) {
        const replay = replays.get(replayKey) as { status: number; body: any }
        return json(replay.body, replay.status)
      }
      const remember = (response: { status: number; body: any }) => {
        if (replayKey) replays.set(replayKey, response)
        return json(response.body, response.status)
      }
      if (method === 'POST' && parsed.pathname === '/v2/customer/partner-referrals') {
        return json({
          links: [
            { href: 'https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/ZjcyODU4ZWYtYTA1OC00ODIwLTk2M2EtOTZkZWQ4NmQwYzI3', rel: 'self', method: 'GET' },
            { href: 'https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=ZjcyODU4ZWYt', rel: 'action_url', method: 'GET' },
          ],
        }, 201)
      }
      const integrations = `/v1/customer/partners/${options.partnerMerchantId}/merchant-integrations`
      if (method === 'GET' && parsed.pathname === integrations) {
        if (!fake.sellerLinked) return issue(404, 'RESOURCE_NOT_FOUND', 'MERCHANT_NOT_FOUND')
        return json({ merchant_id: 'SELLER7RXQG3L', tracking_id: parsed.searchParams.get('tracking_id'), links: [] })
      }
      if (method === 'GET' && parsed.pathname.startsWith(`${integrations}/`)) {
        const merchantId = parsed.pathname.slice(integrations.length + 1)
        return json({
          merchant_id: merchantId,
          tracking_id: 'aglyn-org',
          products: [{ name: 'EXPRESS_CHECKOUT', vetting_status: 'SUBSCRIBED' }],
          payments_receivable: fake.sellerReady.payments_receivable,
          primary_email_confirmed: fake.sellerReady.primary_email_confirmed,
          oauth_integrations: fake.sellerReady.granted
            ? [
                {
                  integration_type: 'OAUTH_THIRDPARTY',
                  integration_method: 'PAYPAL',
                  oauth_third_party: [
                    { partner_client_id: options.clientId, merchant_client_id: 'MERCHANTCLIENT', scopes: ['https://uri.paypal.com/services/payments/realtimepayment', 'https://uri.paypal.com/services/payments/refund'] },
                  ],
                },
              ]
            : [],
        })
      }
      if (method === 'POST' && parsed.pathname === '/v2/checkout/orders') {
        const id = `5O190127TN3647${String(++sequence).padStart(2, '0')}T`
        orders.set(id, { id, status: 'CREATED', body: JSON.parse(JSON.stringify(body)), captures: [] })
        return remember({
          status: 201,
          body: { id, status: 'PAYER_ACTION_REQUIRED', links: [{ href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`, rel: 'payer-action', method: 'GET' }] },
        })
      }
      const orderMatch = /^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/.exec(parsed.pathname)
      if (orderMatch) {
        const order = orders.get(decodeURIComponent(orderMatch[1]))
        if (!order) return issue(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID')
        const view = () => ({
          id: order.id,
          intent: 'CAPTURE',
          status: order.status,
          ...(order.payer ? { payer: order.payer } : {}),
          purchase_units: [
            {
              reference_id: 'default',
              amount: order.body.purchase_units[0].amount,
              payee: order.body.purchase_units[0].payee,
              ...(order.shipping ? { shipping: order.shipping } : {}),
              ...(order.captures.length ? { payments: { captures: order.captures } } : {}),
            },
          ],
        })
        if (method === 'GET') return json(view())
        if (method === 'PATCH') {
          for (const op of body ?? []) {
            if (String(op.path).endsWith('/amount')) order.body.purchase_units[0].amount = op.value
            if (String(op.path).endsWith('/shipping/options')) order.body.purchase_units[0].shipping.options = op.value
          }
          return json(null, 204)
        }
        if (method === 'POST' && orderMatch[2]) {
          if (order.status === 'COMPLETED') return remember({ status: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] } })
          if (order.status !== 'APPROVED') return remember({ status: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }] } })
          if (fake.nextCapture === 'NETWORK') {
            fake.nextCapture = 'COMPLETED'
            throw new TypeError('fetch failed')
          }
          if (fake.nextCapture === 'INSTRUMENT_DECLINED') {
            fake.nextCapture = 'COMPLETED'
            return remember({ status: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] } })
          }
          const unit = order.body.purchase_units[0]
          const fee = unit.payment_instruction?.platform_fees?.[0]?.amount
          const capture = {
            id: `3C679366HH9089${String(++sequence).padStart(2, '0')}F`,
            status: fake.nextCapture,
            amount: unit.amount,
            final_capture: true,
            ...(fake.nextCapture === 'PENDING' ? { status_details: { reason: 'PENDING_REVIEW' } } : {}),
            seller_receivable_breakdown: {
              gross_amount: unit.amount,
              paypal_fee: money(Math.round(cents(unit.amount) * 0.0349) + 49),
              ...(fee ? { platform_fees: [{ amount: fee, payee: { merchant_id: options.partnerMerchantId } }] } : {}),
            },
            supplementary_data: { related_ids: { order_id: order.id } },
          }
          fake.nextCapture = 'COMPLETED'
          order.captures.push(capture)
          order.status = 'COMPLETED'
          return remember({ status: 201, body: view() })
        }
      }
      const refundMatch = /^\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(parsed.pathname)
      if (method === 'POST' && refundMatch) {
        const captureId = decodeURIComponent(refundMatch[1])
        const capture = [...orders.values()].flatMap((order) => order.captures).find((one) => one.id === captureId)
        if (!capture) return issue(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID')
        const asked = cents(body?.amount ?? capture.amount)
        const left = cents(capture.amount) - (refunds.get(captureId) ?? 0)
        if (asked > left) return remember({ status: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'REFUND_AMOUNT_EXCEEDED' }] } })
        refunds.set(captureId, (refunds.get(captureId) ?? 0) + asked)
        return remember({
          status: 201,
          body: { id: `1JU08902781691${String(++sequence).padStart(3, '0')}`, status: 'COMPLETED', links: [{ href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}`, rel: 'up', method: 'GET' }] },
        })
      }
      if (method === 'POST' && parsed.pathname === '/v1/notifications/verify-webhook-signature') {
        return json({ verification_status: fake.verifies ? 'SUCCESS' : 'FAILURE' })
      }
      return issue(404, 'RESOURCE_NOT_FOUND', 'UNKNOWN_PATH')
    },
  }
  return fake
}
