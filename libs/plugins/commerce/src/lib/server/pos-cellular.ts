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

import { firebaseAdmin, readOrgBilling } from '@aglyn/tenant-data-admin'
import {
  closePosCellularPeriod,
  isPosCellularDeviceType,
  openPosCellularPeriod,
  parsePosCellularConfig,
  posCellularReaderId,
  posCellularReaderMonthlyCents,
  POS_CELLULAR_READERS_COLLECTION,
  type PosCellularReaderRecord,
} from '../model/pos-cellular'
import type { PosStaff } from './pos-auth'
import { posStripe, posTerminalAvailable } from './pos-stripe'
import { savePosReaderConfiguration } from './pos-terminal'

/*==========================================
 * TURNING 4G ON AND OFF FOR A STORE (AGL-4038).
 *
 * The POS devices card's "Turn on 4G" sets `cellular[enabled]` on the
 * store's ONE Terminal Configuration (`savePosReaderConfiguration`, where
 * tipping, offline mode and the start-up screen also live), so every Stripe
 * Reader S710 at the store has 4G from the next time it connects. See
 * `model/pos-cellular.ts` for why it is per store and what it costs.
 *
 * Each S710 at a store with 4G on has an open period on its
 * `posCellularReaders` record, which is what the month's charge counts
 * (`pos-cellular-billing.ts`). The records follow the store: turning 4G on
 * or off, and adding or removing a reader, re-reads the store's readers and
 * opens or closes each one's period ({@link syncPosCellularReaders}).
 *
 * Turning it on needs the workspace to be billable (a Stripe customer, so a
 * card on file) and the person's agreement to the monthly charge, which the
 * store's terminal settings record with the price they agreed to.
 *=========================================*/

function firestore() {
  return firebaseAdmin.app().firestore()
}

function terminalConfigRef(hostId: string) {
  return firestore().collection('hosts').doc(hostId).collection('terminal').doc('config')
}

function readersRef(hostId: string) {
  return firestore().collection('hosts').doc(hostId).collection('terminalReaders')
}

function cellularReadersRef() {
  return firestore().collection(POS_CELLULAR_READERS_COLLECTION)
}

export interface PosCellularAnswer {
  status: number
  body: { ok: true; enabled: boolean } | { error: string; code?: string }
}

/**
 * Opens a 4G period for every S710 the store has while 4G is on, and closes
 * every open one that should not be: 4G off, or the reader gone. In one
 * transaction over the store's records, so two calls at once never open a
 * reader twice. Idempotent, and cheap where the store never had 4G: one
 * read of its settings and one of its (empty) records.
 */
export async function syncPosCellularReaders(input: {
  hostId: string
  orgId: string
  now?: number
}): Promise<{ open: number; closed: number }> {
  const now = input.now ?? Date.now()
  const [terminal, readers] = await Promise.all([
    terminalConfigRef(input.hostId).get(),
    readersRef(input.hostId).limit(50).get(),
  ])
  const enabled = terminal.get('cellularEnabled') === true
  const configurationId = String(terminal.get('stripeConfigurationId') ?? '') || null
  const capable = new Map<string, { serialNumber: string | null }>()
  for (const doc of readers.docs as Array<{ id: string; get: (field: string) => unknown }>) {
    if (isPosCellularDeviceType(doc.get('deviceType'))) {
      capable.set(String(doc.id), { serialNumber: String(doc.get('serialNumber') ?? '') || null })
    }
  }
  return firestore().runTransaction(async (transaction: any) => {
    const known = await transaction.get(cellularReadersRef().where('hostId', '==', input.hostId).limit(100))
    const records = new Map<string, PosCellularReaderRecord>()
    for (const doc of known.docs as Array<{ id: string; data: () => PosCellularReaderRecord }>) {
      records.set(String(doc.id), doc.data())
    }
    let open = 0
    let closed = 0
    if (enabled) {
      for (const [readerId, reader] of capable) {
        const id = posCellularReaderId(input.hostId, readerId)
        const existing = records.get(id) ?? null
        const next = openPosCellularPeriod(
          {
            orgId: input.orgId,
            hostId: input.hostId,
            readerId,
            serialNumber: reader.serialNumber,
            stripeConfigurationId: configurationId,
          },
          existing,
          now,
        )
        open += 1
        const unchanged =
          existing?.enabled === true &&
          existing.periods.some((period) => period.toMs === null) &&
          existing.orgId === input.orgId &&
          existing.serialNumber === reader.serialNumber &&
          existing.stripeConfigurationId === configurationId
        if (unchanged) continue
        transaction.set(cellularReadersRef().doc(id), next)
      }
    }
    for (const [id, record] of records) {
      const keep = enabled && capable.has(record.readerId)
      if (keep || !record.enabled) continue
      transaction.set(cellularReadersRef().doc(id), closePosCellularPeriod(record, now))
      closed += 1
    }
    return { open, closed }
  })
}

/**
 * `cellular` on the card readers route: turns 4G on (`enabled: true`, with
 * `consent: true`) or off for the caller's store. The route has already
 * checked the "Registers and devices" key on the store.
 */
export async function setPosStoreCellular(
  staff: PosStaff,
  body: Record<string, unknown>,
): Promise<PosCellularAnswer> {
  const config = parsePosCellularConfig(process.env)
  // Not offered: answered as unknown, the way the card never shows it.
  if (!config || !posTerminalAvailable()) {
    return { status: 404, body: { error: '4G is not available.', code: 'cellular-unavailable' } }
  }
  if (typeof body['enabled'] !== 'boolean') return { status: 400, body: { error: 'Say whether 4G is on or off.' } }
  const enable = body['enabled'] === true
  const terminalRef = terminalConfigRef(staff.hostId)
  const terminal = await terminalRef.get()
  if (!terminal.get('stripeLocationId')) {
    return { status: 409, body: { error: 'Add a card reader to this store first.', code: 'no-location' } }
  }
  if (enable) {
    if (body['consent'] !== true) {
      return {
        status: 400,
        body: { error: 'Agree to the monthly charge for each reader to turn 4G on.', code: 'consent-required' },
      }
    }
    const readers = await readersRef(staff.hostId).limit(50).get()
    const capable = (readers.docs as Array<{ get: (field: string) => unknown }>).some((doc) =>
      isPosCellularDeviceType(doc.get('deviceType')),
    )
    if (!capable) {
      return {
        status: 409,
        body: { error: '4G works on the Stripe Reader S710. Add one to this store first.', code: 'no-capable-reader' },
      }
    }
    const billing = (await readOrgBilling(staff.orgId).catch(() => ({}))) as { stripeCustomerId?: unknown }
    if (!String(billing.stripeCustomerId ?? '')) {
      return {
        status: 409,
        body: {
          error: 'Add a payment method in Billing first: 4G is charged to this workspace each month.',
          code: 'no-billing',
        },
      }
    }
  }
  const already =
    (terminal.get('cellularEnabled') === true) === enable &&
    (!enable || terminal.get('cellularConfigurationId') === terminal.get('stripeConfigurationId'))
  const now = Date.now()
  if (!already) {
    // Each direction keys its own first create: one key sent with other
    // parameters is refused by Stripe for a day.
    const saved = await savePosReaderConfiguration(
      staff.hostId,
      { 'cellular[enabled]': enable },
      enable ? 'cellular-on' : 'cellular-off',
    )
    if ('error' in saved) {
      console.error('[pos-cellular] Stripe refused the cellular setting', staff.hostId, saved.error)
      return {
        status: 502,
        body: { error: enable ? 'Stripe did not turn 4G on. Try again.' : 'Stripe did not turn 4G off. Try again.' },
      }
    }
    await terminalRef.set(
      {
        cellularEnabled: enable,
        cellularConfigurationId: saved.configurationId,
        cellularChangedAtMs: now,
        cellularChangedBy: staff.uid,
        // What they agreed to, and when: the price per reader at the time.
        ...(enable ? { cellularConsent: { atMs: now, uid: staff.uid, readerMonthlyCents: posCellularReaderMonthlyCents(config) } } : {}),
      },
      { merge: true },
    )
  }
  await syncPosCellularReaders({ hostId: staff.hostId, orgId: staff.orgId, now })
  return { status: 200, body: { ok: true, enabled: enable } }
}

/**
 * Turns 4G off at Stripe on a store's Configuration, by its id: for a store
 * or workspace that is being deleted, whose settings may be gone already.
 * True when Stripe took it, or the Configuration no longer exists.
 */
export async function turnOffPosCellularConfiguration(configurationId: string): Promise<boolean> {
  if (!/^tmc_[A-Za-z0-9]+$/.test(configurationId)) return false
  const answer = await posStripe('POST', `terminal/configurations/${configurationId}`, {
    params: { 'cellular[enabled]': false },
  })
  return answer.ok || answer.status === 404
}
