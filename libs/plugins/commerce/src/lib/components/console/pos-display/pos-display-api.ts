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

import type * as CommerceModel from '../../../model'

/**
 * The customer display's half of `/api/commerce/pos-display` (AGL-3608).
 *
 * Every call carries the DISPLAY token, never a staff session: the screen
 * faces the public, and the token opens one register's display state and
 * nothing else. The route answers 401 when the token is unknown or revoked,
 * which the page reads as "pair again".
 */
export const POS_DISPLAY_ENDPOINT = '/api/commerce/pos-display'

/** Where the paired token lives on the device. */
export const POS_DISPLAY_TOKEN_KEY = 'aglyn.posDisplayToken'

export const POS_DISPLAY_TOKEN_HEADER = 'X-Pos-Display-Token'

/** The store's look for the idle and thank-you screens. */
export interface PosDisplayBranding {
  name: string
  logoUrl: string | null
  logoDarkUrl: string | null
  message: string
}

/** The state as the route hands it to the display. */
export type PosDisplayPublicState = Omit<CommerceModel.PosDisplayState, 'response'> & {
  answered: boolean
}

/** What the customer sends back for the current prompt. */
export interface PosDisplayAnswer {
  promptId: string
  tipChoice?: 'percent' | 'custom' | 'none'
  tipPercent?: number
  tipCents?: number
  receiptChannel?: CommerceModel.PosReceiptChannel
  email?: string
  phone?: string
  marketingOptIn?: boolean
}

/**
 * A call's outcome, with the status the page branches on: `value` when `ok`,
 * `error` when not. One flat shape rather than a union, because the
 * workspace compiles without `strict` and an `ok` check would not narrow one.
 */
export interface PosDisplayResult<T> {
  ok: boolean
  /** The HTTP status, or 0 when the request never landed. */
  status: number
  value?: T
  error?: string
}

export function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(POS_DISPLAY_TOKEN_KEY) || null
  } catch {
    return null
  }
}

export function storeToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(POS_DISPLAY_TOKEN_KEY, token)
    else window.localStorage.removeItem(POS_DISPLAY_TOKEN_KEY)
  } catch {
    // Storage blocked (a private window, a locked-down kiosk browser): the
    // display still works until it reloads, then asks for a code again.
  }
}

async function call<T>(
  init: { method: 'GET'; query: string } | { method: 'POST'; body: Record<string, unknown> },
  token: string | null,
): Promise<PosDisplayResult<T>> {
  const headers: Record<string, string> = {}
  if (token) headers[POS_DISPLAY_TOKEN_HEADER] = token
  if (init.method === 'POST') headers['Content-Type'] = 'application/json'
  try {
    const response = await fetch(
      init.method === 'GET' ? `${POS_DISPLAY_ENDPOINT}?${init.query}` : POS_DISPLAY_ENDPOINT,
      {
        method: init.method,
        headers,
        cache: 'no-store',
        ...(init.method === 'POST' ? { body: JSON.stringify(init.body) } : {}),
      },
    )
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: String(payload?.['error'] ?? 'Something went wrong. Try again.'),
      }
    }
    return { ok: true, status: response.status, value: (payload ?? {}) as T }
  } catch {
    // Offline or the request never landed: status 0, which the poll treats
    // as "try again next tick" rather than as a reason to unpair.
    return { ok: false, status: 0, error: 'No connection. Trying again…' }
  }
}

/**
 * Exchanges a register's code for this device's token. `mode` is the kind of
 * screen this page is — a customer display, or a self-service kiosk
 * (AGL-3623) — and a code made for the other kind is refused.
 */
export function pairDisplay(code: string, mode: CommerceModel.PosDeviceMode = 'display') {
  return call<{ token: string; mode?: CommerceModel.PosDeviceMode; branding: PosDisplayBranding }>(
    {
      method: 'POST',
      body: {
        action: 'pair',
        code,
        mode,
        label: mode === 'kiosk' ? 'Self-service kiosk' : 'Customer display',
      },
    },
    null,
  )
}

export function pollDisplay(token: string, withBranding: boolean) {
  return call<{ state: PosDisplayPublicState; branding?: PosDisplayBranding }>(
    { method: 'GET', query: `action=poll${withBranding ? '&branding=true' : ''}` },
    token,
  )
}

export function respondToDisplay(token: string, response: PosDisplayAnswer) {
  return call<{ ok: true }>({ method: 'POST', body: { action: 'respond', response } }, token)
}

export function forgetDisplay(token: string) {
  return call<{ ok: true }>({ method: 'POST', body: { action: 'forget' } }, token)
}

/**
 * Minor units as the register shows them, in the store's currency (the
 * display state's `currency`; US dollars when a state predates it). A
 * zero-decimal currency (JPY) has no minor unit to divide out.
 */
export function displayMoney(cents: number, currency?: string | null): string {
  const code = String(currency || 'usd').toUpperCase()
  const amount = Number(cents) || 0
  try {
    const format = new Intl.NumberFormat('en-US', { style: 'currency', currency: code })
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2
    return format.format(amount / 10 ** digits)
  } catch {
    return `${(amount / 100).toFixed(2)} ${code}`
  }
}

/**
 * Dollars typed on the display as whole cents, or null when the entry is not
 * an amount (`12`, `12.5` and `$12.50` are; `12.505` and `abc` are not).
 */
export function dollarsToCents(input: string): number | null {
  const cleaned = String(input ?? '').trim().replace(/^\$/, '')
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  return Math.round(Number(cleaned) * 100)
}
