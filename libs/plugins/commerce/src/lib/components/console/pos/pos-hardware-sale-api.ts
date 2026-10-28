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

import type { PosHardwareSku, PosHardwareSkuId } from '../../../model/pos-hardware'
import { sendPosHardwareRequest } from './pos-hardware-api'

/*
 * Selling a card reader in person (AGL-4038), the client half of
 * `/api/commerce/pos-hardware-sale`, so no component builds a request by hand.
 */

type User = Parameters<typeof sendPosHardwareRequest>[0]

const SALE = '/api/commerce/pos-hardware-sale'

export type PosHardwareSaleStatus =
  | { seller: false }
  | { seller: true; items: Array<{ sku: PosHardwareSkuId; name: string; kind: PosHardwareSku['kind'] }> }

/** Whether a store is the platform's own hardware seller, once per store per session. */
const statusByHost = new Map<string, Promise<PosHardwareSaleStatus>>()

export function posHardwareSaleStatus(user: User, hostId: string): Promise<PosHardwareSaleStatus> {
  const cached = statusByHost.get(hostId)
  if (cached) return cached
  const asked = sendPosHardwareRequest<PosHardwareSaleStatus>(user, SALE, {
    method: 'POST',
    body: { action: 'status', hostId },
  }).catch((error: unknown) => {
    // A refusal is not remembered: the next editor that opens asks again.
    statusByHost.delete(hostId)
    throw error
  })
  statusByHost.set(hostId, asked)
  return asked
}

/** A sale on the To attach list, as `pending` and `attach` answer it. */
export interface ToAttachRow {
  id: string
  number: string
  registerOrderId: string | null
  registerNumber: number | null
  kiosk: boolean
  offline: boolean
  lines: Array<{ sku: PosHardwareSkuId; name: string; quantity: number }>
  totalCents: number
  createdAtMs: number
  contactEmail: string | null
  attached: boolean
  awaitingWorkspace: boolean
  invited: boolean
}

export interface BuyerStore {
  hostId: string
  name: string
  hasLocation: boolean
}

export interface BuyerWorkspace {
  orgId: string
  name: string
  posPlan: boolean
  stores: BuyerStore[]
}

export interface BuyerPerson {
  uid: string
  name: string
  email: string
  workspaces: BuyerWorkspace[]
}

export interface BuyerFindResult {
  kind: 'email' | 'name'
  people: BuyerPerson[]
  workspaces: Array<BuyerWorkspace & { owner: Omit<BuyerPerson, 'workspaces'> | null }>
  noAccount: boolean
}

/** Who the register says the buyer is. */
export type BuyerChoice = { uid: string; orgId?: string; hostId?: string } | { email: string }

export function posHardwareToAttach(user: User, hostId: string) {
  return sendPosHardwareRequest<{ orders: ToAttachRow[] }>(user, SALE, {
    method: 'POST',
    body: { action: 'pending', hostId },
  })
}

export function posHardwareFindBuyer(user: User, hostId: string, query: string) {
  return sendPosHardwareRequest<BuyerFindResult>(user, SALE, {
    method: 'POST',
    body: { action: 'find', hostId, query },
  })
}

export function posHardwareAttach(
  user: User,
  attemptKey: string,
  body: { hostId: string; buyer: BuyerChoice; registerOrderId?: string; orderId?: string },
) {
  return sendPosHardwareRequest<{ outcome: 'waiting' } | { outcome: 'attached' | 'pending'; order: ToAttachRow }>(
    user,
    SALE,
    { method: 'POST', body: { ...body, action: 'attach' }, attemptKey },
  )
}
