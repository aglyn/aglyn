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
import { POS_DISPLAY_TOKEN_HEADER } from '../pos-display/pos-display-api'

/**
 * The self-service kiosk's half of `/api/commerce/pos-kiosk` (AGL-3623).
 *
 * Every call carries the kiosk's device token — the customer display's
 * header, because a kiosk is paired exactly like one — and never a staff
 * session. 401 means the kiosk was unpaired (or its register removed), which
 * the page reads as "pair again".
 */
export const POS_KIOSK_ENDPOINT = '/api/commerce/pos-kiosk'

/**
 * Where the kiosk's token lives on the device: the ONE thing it stores.
 * Nothing a customer chooses or types is ever written to storage.
 */
export const POS_KIOSK_TOKEN_KEY = 'aglyn.posKioskToken'

export interface PosKioskResult<T> {
  ok: boolean
  /** The HTTP status, or 0 when the request never landed. */
  status: number
  value?: T
  error?: string
}

export function readKioskToken(): string | null {
  try {
    return window.localStorage.getItem(POS_KIOSK_TOKEN_KEY) || null
  } catch {
    return null
  }
}

export function storeKioskToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(POS_KIOSK_TOKEN_KEY, token)
    else window.localStorage.removeItem(POS_KIOSK_TOKEN_KEY)
  } catch {
    // Storage blocked: the kiosk works until it reloads, then asks for a code.
  }
}

/** Every key the kiosk could own on this origin starts with this. */
export const POS_KIOSK_STORAGE_PREFIX = 'aglyn.posKiosk'

/**
 * The idle reset's storage sweep: every kiosk key in local and session
 * storage but the device token. The kiosk keeps a customer's cart, email and
 * phone in memory only, so on a working kiosk this finds nothing; it is the
 * guarantee that nothing a customer chose outlives their turn should a later
 * change ever persist some of it. Other pages' keys on the console origin
 * are not the kiosk's to touch.
 */
export function clearKioskCustomerStorage(): void {
  for (const pick of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const storage = pick()
      const keys: string[] = []
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index)
        if (key && key.startsWith(POS_KIOSK_STORAGE_PREFIX) && key !== POS_KIOSK_TOKEN_KEY) keys.push(key)
      }
      for (const key of keys) storage.removeItem(key)
    } catch {
      // Blocked storage holds nothing to clear.
    }
  }
}

async function call<T>(
  token: string,
  init: { method: 'GET'; query: Record<string, string> } | { method: 'POST'; body: Record<string, unknown>; attemptKey?: string },
): Promise<PosKioskResult<T>> {
  const headers: Record<string, string> = { [POS_DISPLAY_TOKEN_HEADER]: token }
  if (init.method === 'POST') {
    headers['Content-Type'] = 'application/json'
    if (init.attemptKey) headers['Idempotency-Key'] = init.attemptKey
  }
  try {
    const response = await fetch(
      init.method === 'GET'
        ? `${POS_KIOSK_ENDPOINT}?${new URLSearchParams(init.query).toString()}`
        : POS_KIOSK_ENDPOINT,
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
    return { ok: false, status: 0, error: 'No connection. Try again.' }
  }
}

const post = <T>(token: string, body: Record<string, unknown>, attemptKey?: string) =>
  call<T>(token, { method: 'POST', body, ...(attemptKey ? { attemptKey } : {}) })

export const kioskApi = {
  context: (token: string) => call<CommerceModel.PosKioskContext>(token, { method: 'GET', query: { action: 'context' } }),
  catalog: (token: string, categoryId: string | null) =>
    call<CommerceModel.PosKioskCatalog>(token, {
      method: 'GET',
      query: { action: 'catalog', ...(categoryId ? { categoryId } : {}) },
    }),
  sale: (token: string, orderId: string) =>
    call<{ sale: CommerceModel.PosKioskSale }>(token, { method: 'GET', query: { action: 'sale', orderId } }),
  checkout: (token: string, lines: CommerceModel.PosKioskLine[], attemptKey: string) =>
    post<{ sale: CommerceModel.PosKioskSale }>(token, { action: 'checkout', lines }, attemptKey),
  pay: (
    token: string,
    input: {
      orderId: string
      method: 'reader' | 'tap'
      tipChoice: 'percent' | 'custom' | 'none'
      tipPercent?: number
      tipCents?: number
    },
    attemptKey: string,
  ) =>
    post<{ sale: CommerceModel.PosKioskSale; paymentId?: string; clientSecret?: string; paymentIntentId?: string }>(
      token,
      { action: 'pay', ...input },
      attemptKey,
    ),
  paymentStatus: (token: string, orderId: string, paymentId: string) =>
    post<{ sale: CommerceModel.PosKioskSale }>(token, { action: 'payment-status', orderId, paymentId }),
  cancelPayment: (token: string, orderId: string, paymentId: string) =>
    post<{ sale: CommerceModel.PosKioskSale }>(token, { action: 'cancel-payment', orderId, paymentId }),
  simulate: (token: string, orderId: string, paymentId: string) =>
    post<{ sale: CommerceModel.PosKioskSale }>(token, { action: 'simulate', orderId, paymentId }),
  counter: (token: string, orderId: string) =>
    post<{ sale: CommerceModel.PosKioskSale }>(token, { action: 'counter', orderId }),
  receipt: (
    token: string,
    input: { orderId: string; channel: CommerceModel.PosReceiptChannel; to?: string; marketingOptIn?: boolean },
  ) => post<{ ok: true }>(token, { action: 'receipt', ...input }),
  abandon: (token: string, orderId: string) =>
    post<{ sale: CommerceModel.PosKioskSale }>(token, { action: 'abandon', orderId }),
  unlock: (token: string, pin: string) => post<{ unlock: string; expiresAtMs: number }>(token, { action: 'unlock', pin }),
  settings: (token: string, unlock: string) =>
    post<PosKioskSettingsView>(token, { action: 'settings', unlock }),
  setReader: (token: string, unlock: string, readerId: string) =>
    post<PosKioskSettingsView>(token, { action: 'set-reader', unlock, readerId }),
  exit: (token: string, unlock: string) => post<{ ok: true }>(token, { action: 'exit', unlock }),
}

export interface PosKioskSettingsView {
  readers: Array<{ id: string; label: string; status: string }>
  readerId: string | null
  label: string
}
