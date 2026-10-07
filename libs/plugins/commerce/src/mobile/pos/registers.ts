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

import { collection, type DocumentData, type Firestore, getDocs, limit, query } from 'firebase/firestore'
import { posKeys } from './catalog'

/*==========================================
 * WHICH REGISTER THIS DEVICE IS (AGL-3618).
 *
 * A sale runs through a named register (AGL-472): the plan's register seats
 * are counted by them and the takings are attributed to one. The device
 * remembers its register per store, the way the console register defaults
 * to the first; a register that pins a stock location sells from it.
 *
 * And a sale in progress is remembered too, per store and register: an app
 * killed between "Charge" and the receipt opens back on that sale rather
 * than leaving a pending order nobody will finish.
 *=========================================*/

export interface PosRegister {
  id: string
  name: string
  locationId: string | null
}

/** The console register's own window (`pos-page`: registers, limit 25). */
export const POS_REGISTER_WINDOW = 25

export function posRegisterFrom(id: string, data: DocumentData): PosRegister {
  return {
    id,
    name: String(data['name'] ?? '').trim() || 'Register',
    locationId: typeof data['locationId'] === 'string' && data['locationId'] ? data['locationId'] : null,
  }
}

export function sortRegisters(registers: readonly PosRegister[]): PosRegister[] {
  return [...registers].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export function posRegistersQuery(firestore: Firestore, hostId: string) {
  return {
    queryKey: [...posKeys.all(hostId), 'registers'] as const,
    queryFn: async (): Promise<PosRegister[]> => {
      const snapshot = await getDocs(
        query(collection(firestore, 'hosts', hostId, 'registers'), limit(POS_REGISTER_WINDOW)),
      )
      return sortRegisters(snapshot.docs.map((entry) => posRegisterFrom(entry.id, entry.data())))
    },
  }
}

export const registerChoiceKey = (hostId: string) => `aglyn.pos.register.${hostId}`
export const cartStorageKey = (hostId: string, registerId: string) => `aglyn.pos.cart.${hostId}.${registerId}`
export const pendingSaleKey = (hostId: string, registerId: string) => `aglyn.pos.sale.${hostId}.${registerId}`

/** The sale this register has open, as remembered across a restart. */
export interface PendingSale {
  orderId: string
  totalCents: number
  openedAtMs: number
}

/** A pending sale older than a day is the console's to clean up, not the till's to resume. */
export const PENDING_SALE_MAX_AGE_MS = 24 * 60 * 60 * 1000

export function readPendingSale(raw: unknown, nowMs: number): PendingSale | null {
  const record = (raw && typeof raw === 'object' ? raw : null) as Partial<PendingSale> | null
  if (!record || typeof record.orderId !== 'string' || !record.orderId) return null
  const openedAtMs = Number(record.openedAtMs)
  if (!Number.isFinite(openedAtMs) || nowMs - openedAtMs > PENDING_SALE_MAX_AGE_MS) return null
  return { orderId: record.orderId, totalCents: Math.round(Number(record.totalCents) || 0), openedAtMs }
}
