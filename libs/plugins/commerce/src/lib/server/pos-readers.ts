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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { authorizePosStaff, posRequestBody, type PosStaff } from './pos-auth'
import { revokePosDisplays } from './pos-display'
import { posStripe, posStripeErrorMessage, posStripeTestMode, posTerminalAvailable } from './pos-stripe'
import {
  ensurePosTerminalLocation,
  ownedTerminalReader,
  refreshPosReaderStatus,
  type PosTerminalAddress,
  type PosTerminalReader,
} from './pos-terminal'

/**
 * `POST /api/commerce/pos-readers` (AGL-3607): the site's Stripe Terminal
 * card readers, from the "Card readers" settings card, and the server-side
 * removal of a register.
 *
 * Every action names a reader by id, and every one reads that reader under
 * the CALLER's site first (`ownedTerminalReader`): a reader id copied from
 * another store is "not on this site", whatever Stripe would say about it.
 */
export const posReadersHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = posRequestBody(req)
  const hostId = String(body['hostId'] ?? '')
  const gate = await authorizePosStaff(req, hostId)
  if ('error' in gate) return res.status(gate.status).json({ error: gate.error })
  const staff = gate.staff
  const action = String(body['action'] ?? '')
  try {
    switch (action) {
      case 'list':
        return res.status(200).json(await listReaders(staff, body['refresh'] === true))
      case 'register':
        return await registerReader(staff, body, res)
      case 'update':
        return await updateReader(staff, body, res)
      case 'remove':
        return await removeReader(staff, body, res)
      case 'remove-register':
        return await removeRegister(staff, body, res)
      default:
        return res.status(400).json({ error: 'Unknown action' })
    }
  } catch (error) {
    console.error('[pos-readers]', action, error)
    return res.status(500).json({ error: 'Card readers could not be updated' })
  }
}

function readersRef(hostId: string) {
  return firebaseAdmin.app().firestore().collection('hosts').doc(hostId).collection('terminalReaders')
}

async function listReaders(staff: PosStaff, refresh: boolean) {
  const available = posTerminalAvailable()
  const snapshot = await readersRef(staff.hostId).limit(50).get()
  const readers = snapshot.docs.map((doc: any) => ({
    id: doc.id as string,
    ...(doc.data() as PosTerminalReader),
  }))
  if (available && refresh) {
    await Promise.all(
      readers.map(async (reader: PosTerminalReader & { id: string }) => {
        const fresh = await refreshPosReaderStatus(staff.hostId, reader.id).catch(() => null)
        if (fresh) reader.status = fresh.status
      }),
    )
  }
  const config = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(staff.hostId)
    .collection('terminal')
    .doc('config')
    .get()
  return {
    available,
    testMode: posStripeTestMode(),
    locationReady: Boolean(config.get('stripeLocationId')),
    readers: readers.map((reader: PosTerminalReader & { id: string }) => ({
      id: reader.id,
      label: reader.label,
      registerId: reader.registerId ?? null,
      deviceType: reader.deviceType ?? null,
      serialNumber: reader.serialNumber ?? null,
      status: reader.status ?? 'offline',
      livemode: reader.livemode,
    })),
  }
}

async function registerExists(hostId: string, registerId: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(registerId)) return false
  return (
    await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('registers')
      .doc(registerId)
      .get()
  ).exists
}

async function registerReader(
  staff: PosStaff,
  body: Record<string, any>,
  res: Parameters<PluginApiHandler>[1],
) {
  if (!posTerminalAvailable()) {
    return res.status(409).json({ error: 'Card readers are not available yet.' })
  }
  const registrationCode = String(body['registrationCode'] ?? '').trim()
  if (!/^[A-Za-z0-9-]{3,64}$/.test(registrationCode)) {
    return res.status(400).json({ error: 'Enter the code the reader shows on its screen.' })
  }
  const label = String(body['label'] ?? '').trim().slice(0, 60) || 'Card reader'
  const registerId = String(body['registerId'] ?? '')
  if (registerId && !(await registerExists(staff.hostId, registerId))) {
    return res.status(404).json({ error: 'Unknown register' })
  }
  const host = await firebaseAdmin.app().firestore().collection('hosts').doc(staff.hostId).get()
  const address = body['address'] as PosTerminalAddress | undefined
  const location = await ensurePosTerminalLocation({
    hostId: staff.hostId,
    orgId: staff.orgId,
    displayName: String(host.get('name') ?? host.get('title') ?? 'Store'),
    ...(address
      ? {
          address: {
            line1: String(address.line1 ?? '').slice(0, 200),
            ...(address.line2 ? { line2: String(address.line2).slice(0, 200) } : {}),
            city: String(address.city ?? '').slice(0, 100),
            ...(address.state ? { state: String(address.state).slice(0, 100) } : {}),
            postalCode: String(address.postalCode ?? '').slice(0, 20),
            country: String(address.country ?? '').toUpperCase().slice(0, 2),
          },
        }
      : {}),
  })
  if ('error' in location) return res.status(location.status).json({ error: location.error })
  // Not keyed: a registration code is single-use at Stripe, which is the
  // dedupe — a second press with the same code is refused there, and no
  // other store can ever register a reader this one already holds.
  const created = await posStripe('POST', 'terminal/readers', {
    params: {
      registration_code: registrationCode,
      label,
      location: location.locationId,
      'metadata[orgId]': staff.orgId,
      'metadata[hostId]': staff.hostId,
      ...(registerId ? { 'metadata[registerId]': registerId } : {}),
    },
  })
  if (!created.ok || !created.body?.id) {
    return res.status(400).json({
      error: posStripeErrorMessage(
        created.body,
        'That code did not register a reader. Check the code on the reader and try again.',
      ),
    })
  }
  const reader: PosTerminalReader = {
    label,
    ...(registerId ? { registerId } : {}),
    stripeLocationId: location.locationId,
    ...(created.body.device_type ? { deviceType: String(created.body.device_type) } : {}),
    ...(created.body.serial_number ? { serialNumber: String(created.body.serial_number) } : {}),
    status: String(created.body.status ?? 'offline'),
    livemode: Boolean(created.body.livemode),
    createdAtMs: Date.now(),
    createdBy: staff.uid,
  }
  await readersRef(staff.hostId).doc(String(created.body.id)).set(reader)
  return res.status(200).json({ reader: { id: String(created.body.id), ...reader } })
}

async function updateReader(
  staff: PosStaff,
  body: Record<string, any>,
  res: Parameters<PluginApiHandler>[1],
) {
  const reader = await ownedTerminalReader(staff.hostId, body['readerId'])
  if (!reader) return res.status(404).json({ error: 'That card reader is not on this site.' })
  const patch: Record<string, unknown> = {}
  if (typeof body['label'] === 'string') {
    patch['label'] = body['label'].trim().slice(0, 60) || reader.label
  }
  if ('registerId' in body) {
    const registerId = String(body['registerId'] ?? '')
    if (registerId && !(await registerExists(staff.hostId, registerId))) {
      return res.status(404).json({ error: 'Unknown register' })
    }
    patch['registerId'] = registerId || firebaseAdmin.firestore.FieldValue.delete()
  }
  const updated = await posStripe('POST', `terminal/readers/${reader.id}`, {
    params: {
      ...(patch['label'] ? { label: String(patch['label']) } : {}),
      ...('registerId' in body ? { 'metadata[registerId]': String(body['registerId'] ?? '') } : {}),
    },
  })
  if (!updated.ok) {
    return res.status(502).json({ error: posStripeErrorMessage(updated.body, 'The reader could not be updated.') })
  }
  await readersRef(staff.hostId).doc(reader.id).set(patch, { merge: true })
  return res.status(200).json({ ok: true })
}

async function removeReader(
  staff: PosStaff,
  body: Record<string, any>,
  res: Parameters<PluginApiHandler>[1],
) {
  const reader = await ownedTerminalReader(staff.hostId, body['readerId'])
  if (!reader) return res.status(404).json({ error: 'That card reader is not on this site.' })
  const removed = await posStripe('DELETE', `terminal/readers/${reader.id}`)
  // Already gone at Stripe is the outcome asked for; anything else is not.
  if (!removed.ok && removed.status !== 404) {
    return res.status(502).json({ error: posStripeErrorMessage(removed.body, 'The reader could not be removed.') })
  }
  await readersRef(staff.hostId).doc(reader.id).delete()
  return res.status(200).json({ ok: true })
}

/**
 * Removes a register on the server (AGL-3617). The settings card deleted it
 * with a client `deleteDoc`, which the Firestore rules refuse for everyone but
 * staff (`registers` is server-owned since AGL-1775), so a merchant's Remove
 * button failed with a permission error. Removing it here also signs out its
 * customer displays and unbinds its readers.
 */
async function removeRegister(
  staff: PosStaff,
  body: Record<string, any>,
  res: Parameters<PluginApiHandler>[1],
) {
  const registerId = String(body['registerId'] ?? '')
  if (!(await registerExists(staff.hostId, registerId))) {
    return res.status(404).json({ error: 'Unknown register' })
  }
  const firestore = firebaseAdmin.app().firestore()
  const registerRef = firestore
    .collection('hosts')
    .doc(staff.hostId)
    .collection('registers')
    .doc(registerId)
  await revokePosDisplays(staff.hostId, registerId)
  await registerRef.delete()
  const bound = await readersRef(staff.hostId).where('registerId', '==', registerId).limit(50).get()
  await Promise.all(
    bound.docs.map((doc: any) =>
      doc.ref.set({ registerId: firebaseAdmin.firestore.FieldValue.delete() }, { merge: true }),
    ),
  )
  return res.status(200).json({ ok: true })
}
