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

import { randomBytes } from 'node:crypto'
import { PAYPAL_API_ROUTES } from '../constants'
import { checkoutPayable, payPalAmount, type PayPalCheckoutRecord } from './checkouts'
import type { PayPalConfig } from './config'
import { VENMO_CURRENCY } from './money'

/**
 * The buyer's PayPal and Venmo page for one checkout (AGL-3630).
 *
 * Served by this plugin from the host the buyer came from, so the store's
 * own pages never load PayPal's script — it loads here, on the one page
 * that needs it, and nowhere else. The page shows what is being paid for,
 * PayPal's own buttons (Venmo's where PayPal says the buyer is eligible),
 * and the way back to the store.
 *
 * ## Its own Content-Security-Policy
 *
 * API routes carry none from the storefront's middleware, so the page sets
 * a strict one: no script but PayPal's and the page's own (by nonce), no
 * connection but to this host and PayPal, no frame but PayPal's and
 * Venmo's, and no one may frame the page.
 */

export interface PayPageInput {
  record: PayPalCheckoutRecord
  recordId: string
  config: PayPalConfig
  nowMs?: number
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)

/** JSON a `<script>` can carry without ending early or opening a comment. */
const scriptJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

function formatMoney(cents: number, currency: string): string {
  const decimals = ['huf', 'jpy', 'twd'].includes(currency) ? 0 : 2
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(
      cents / 10 ** decimals,
    )
  } catch {
    return `${(cents / 10 ** decimals).toFixed(decimals)} ${currency.toUpperCase()}`
  }
}

export function payPageSecurityHeaders(nonce: string): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': [
      "default-src 'none'",
      `script-src 'nonce-${nonce}' https://www.paypal.com https://*.paypal.com`,
      "connect-src 'self' https://*.paypal.com",
      'frame-src https://*.paypal.com https://*.venmo.com',
      "img-src 'self' data: https://*.paypal.com https://*.paypalobjects.com",
      `style-src 'nonce-${nonce}' 'unsafe-inline' https://*.paypal.com`,
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  }
}

/** A page with a message and the way back, for a checkout that cannot be paid. */
export function renderPayNotice(title: string, message: string, backUrl: string | null): Response {
  const nonce = randomBytes(16).toString('base64')
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${style(nonce)}</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${
    backUrl ? `<p><a href="${escapeHtml(backUrl)}">Back to the store</a></p>` : ''
  }</main></body></html>`
  return new Response(body, { status: 200, headers: payPageSecurityHeaders(nonce) })
}

function style(nonce: string): string {
  return `<style nonce="${nonce}">
:root{color-scheme:light dark;--fg:#1f2328;--muted:#59636e;--line:#d1d9e0;--bg:#fff;--card:#f6f8fa;--error:#cf222e}
@media (prefers-color-scheme:dark){:root{--fg:#f0f6fc;--muted:#9198a1;--line:#3d444d;--bg:#0d1117;--card:#151b23;--error:#f85149}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:480px;margin:0 auto;padding:24px 16px 48px}h1{font-size:1.375rem;margin:0 0 4px}
.muted{color:var(--muted);font-size:.9375rem}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:20px 0}
.row{display:flex;justify-content:space-between;gap:16px;padding:4px 0}.row.total{border-top:1px solid var(--line);margin-top:8px;padding-top:12px;font-weight:600}
#buttons{display:flex;flex-direction:column;gap:12px;min-height:56px}#message{margin:16px 0 0}#message.error{color:var(--error)}
a{color:inherit}.back{display:inline-block;margin-top:24px}
</style>`
}

/** The page itself. */
export function renderPayPage(input: PayPageInput): Response {
  const { record, recordId, config } = input
  const refusal = checkoutPayable(record, input.nowMs)
  if (refusal) {
    return renderPayNotice(refusal.startsWith('This order is already paid') ? 'Already paid' : 'Checkout closed', refusal, record.cancelUrl)
  }
  const nonce = randomBytes(16).toString('base64')
  const { totals } = payPalAmount(record, record.selectedShippingId)
  const money = (cents: number) => formatMoney(cents, record.currency)
  const name = record.merchantName || 'this store'
  const lines = record.lines
    .map(
      (line) =>
        `<div class="row"><span>${line.quantity > 1 ? `${line.quantity} × ` : ''}${escapeHtml(line.name)}</span><span>${money(
          line.unitCents * line.quantity,
        )}</span></div>`,
    )
    .join('')
  const rows = [
    totals.discountCents > 0 ? `<div class="row"><span>Discount</span><span>−${money(totals.discountCents)}</span></div>` : '',
    record.shipping
      ? `<div class="row"><span>Shipping</span><span>${money(totals.shippingCents)}</span></div>`
      : '',
    totals.taxCents > 0 ? `<div class="row"><span>Tax</span><span>${money(totals.taxCents)}</span></div>` : '',
    `<div class="row total"><span>Total</span><span id="total">${money(totals.totalCents)}</span></div>`,
  ].join('')
  const sdkQuery = new URLSearchParams({
    'client-id': config.clientId,
    'merchant-id': record.merchantId,
    currency: record.currency.toUpperCase(),
    intent: 'capture',
    components: 'buttons',
    // Cards are taken by the store's own checkout; PayPal's page is for
    // PayPal balances, Pay Later and Venmo.
    'disable-funding': 'card',
    ...(record.currency === VENMO_CURRENCY ? { 'enable-funding': 'venmo' } : {}),
  })
  const routes = {
    order: `/api/${PAYPAL_API_ROUTES.payOrder}?c=${encodeURIComponent(recordId)}`,
    shipping: `/api/${PAYPAL_API_ROUTES.payShipping}?c=${encodeURIComponent(recordId)}`,
    address: `/api/${PAYPAL_API_ROUTES.payAddress}?c=${encodeURIComponent(recordId)}`,
    capture: `/api/${PAYPAL_API_ROUTES.payCapture}?c=${encodeURIComponent(recordId)}`,
  }
  const boot = {
    routes,
    venmo: record.currency === VENMO_CURRENCY,
    shipping: Boolean(record.shipping),
  }
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Pay ${escapeHtml(name)}</title>
${style(nonce)}
</head>
<body>
<main>
<h1>Pay ${escapeHtml(name)}</h1>
<p class="muted">Pay with PayPal${boot.venmo ? ' or Venmo' : ''}. ${
    record.shipping ? 'Choose your delivery address and method in PayPal.' : ''
  }</p>
<section class="card" aria-label="Order summary">${lines}${rows}</section>
<div id="buttons"><div id="paypal-button"></div><div id="venmo-button"></div></div>
<p id="message" role="status" aria-live="polite"></p>
<a class="back" href="${escapeHtml(record.cancelUrl)}">Cancel and return to the store</a>
</main>
<script nonce="${nonce}" src="${config.sdkBase}/sdk/js?${escapeHtml(sdkQuery.toString())}" data-partner-attribution-id="${escapeHtml(
    config.attributionId,
  )}" data-csp-nonce="${nonce}"></script>
<script nonce="${nonce}">
(function () {
  var boot = ${scriptJson(boot)};
  var message = document.getElementById('message');
  function say(text, error) { message.textContent = text || ''; message.className = error ? 'error' : ''; }
  function post(path, body) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (response) { return response.json().catch(function () { return {}; }).then(function (json) { return { ok: response.ok, body: json }; }); });
  }
  if (!window.paypal || !window.paypal.Buttons) { say('PayPal could not be loaded. Check your connection and reload this page.', true); return; }
  function buttons(source) {
    return window.paypal.Buttons({
      fundingSource: source === 'venmo' ? window.paypal.FUNDING.VENMO : window.paypal.FUNDING.PAYPAL,
      style: { layout: 'vertical', shape: 'rect', label: 'pay' },
      createOrder: function () {
        say('');
        return post(boot.routes.order, { source: source }).then(function (r) {
          if (!r.ok || !r.body.orderId) { throw new Error(r.body.error || 'PayPal could not start this payment.'); }
          return r.body.orderId;
        });
      },
      onShippingOptionsChange: boot.shipping ? function (data, actions) {
        return post(boot.routes.shipping, { orderId: data.orderID, optionId: data.selectedShippingOption && data.selectedShippingOption.id }).then(function (r) {
          if (!r.ok) { return actions.reject(); }
          if (r.body.total) { document.getElementById('total').textContent = r.body.total; }
        });
      } : undefined,
      onShippingAddressChange: boot.shipping ? function (data, actions) {
        var address = data.shippingAddress || {};
        return post(boot.routes.address, { country: address.countryCode }).then(function (r) {
          if (!r.ok || !r.body.delivers) { return actions.reject(data.errors && data.errors.COUNTRY_ERROR); }
        });
      } : undefined,
      onApprove: function (data, actions) {
        say('Completing your payment…');
        return post(boot.routes.capture, { orderId: data.orderID }).then(function (r) {
          if (r.body.redirectUrl) { window.location.assign(r.body.redirectUrl); return; }
          if (r.body.restart) { say(r.body.error || 'Choose another way to pay in PayPal.', true); return actions.restart(); }
          say(r.body.error || r.body.message || 'PayPal could not complete the payment. Nothing was charged.', !r.body.pending);
        });
      },
      onCancel: function () { say('Payment canceled. Nothing was charged.'); },
      onError: function (error) { say((error && error.message) || 'PayPal could not complete the payment. Nothing was charged.', true); }
    });
  }
  buttons('paypal').render('#paypal-button');
  if (boot.venmo) { var venmo = buttons('venmo'); if (venmo.isEligible()) { venmo.render('#venmo-button'); } }
})();
</script>
</body>
</html>`
  return new Response(html, { status: 200, headers: payPageSecurityHeaders(nonce) })
}
