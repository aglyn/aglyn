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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  POS_OFFLINE_SYNC_ROUTE,
  type PosOfflineKit,
  type PosOfflineSale,
  type PosOfflineSaleOutcome,
} from '../../../model/commerce-pos-offline'

/**
 * The offline register's two calls (AGL-3625), answered as data. `status: 0`
 * is the network itself failing — the register's signal that it is offline
 * even while the browser says it is not.
 */
export type PosOfflineAnswer<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; error: string }

type User = Parameters<typeof authorizedFetch>[0]

async function call<T>(user: User, init: RequestInit, query = ''): Promise<PosOfflineAnswer<T>> {
  let response: Response
  try {
    response = await authorizedFetch(user, `${POS_OFFLINE_SYNC_ROUTE}${query}`, init)
  } catch {
    return { ok: false, status: 0, error: 'The register is offline.' }
  }
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) {
    return { ok: false, status: response.status, error: String(body?.error ?? 'Something went wrong') }
  }
  return { ok: true, status: response.status, body }
}

/** The site's offline rules, from the server. */
export function fetchPosOfflineKit(user: User, hostId: string) {
  return call<{ kit: PosOfflineKit }>(user, { method: 'GET' }, `?${new URLSearchParams({ hostId })}`)
}

/** Sends one batch of queued sales; an empty batch only asks whether the route answers. */
export function syncPosOfflineSales(user: User, hostId: string, sales: PosOfflineSale[]) {
  return call<{ results: PosOfflineSaleOutcome[] }>(user, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostId, sales }),
  })
}

/** A key for one offline sale: the order's id once it syncs. */
export function newPosOfflineSaleKey(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  // Leading letters keep a key from ever reading as an order number.
  return `off${random}`.slice(0, 40)
}
