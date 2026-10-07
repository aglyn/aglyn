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
import { posStripeTestMode, posTerminalAvailable } from './pos-stripe'
import {
  createPosTerminalConnectionToken,
  ensurePosTerminalLocation,
  posMerchantAccount,
  posTerminalLocationId,
  type PosTerminalAddress,
} from './pos-terminal'

/**
 * `POST /api/commerce/pos-terminal-connection-token` (AGL-3618): what the
 * Aglyn POS app's Stripe Terminal SDK needs to drive Tap to Pay and Bluetooth
 * readers for ONE site.
 *
 * Gated exactly like a register sale (`authorizePosStaff`): a site role that
 * may sell, `managePos`, and the `pos` entitlement. The app holds no key and
 * no privileged path. Every token is scoped to the site's own Terminal
 * Location, so the SDK can connect only to readers in that Location, and the
 * PaymentIntents it collects are the server's own (`card-present-sdk`).
 *
 * Actions:
 * - `token` (the default): the secret, the Location id, the merchant's
 *   account and display name, and test mode; or a 409 whose `code` names
 *   what is missing: `terminal-unavailable`, `merchant-not-ready`,
 *   `location-required`.
 * - `status`: the same readiness as booleans, minting nothing.
 * - `location`: registers the site's Location from an address, once.
 */
export const posMobileTerminalHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = posRequestBody(req)
  const gate = await authorizePosStaff(req, String(body['hostId'] ?? ''))
  if ('error' in gate) return res.status(gate.status).json({ error: gate.error })
  const staff = gate.staff
  const action = String(body['action'] ?? 'token')
  try {
    switch (action) {
      case 'token':
        return await mintToken(staff, res)
      case 'status':
        return res.status(200).json(await terminalReadiness(staff))
      case 'location':
        return await registerLocation(staff, body, res)
      default:
        return res.status(400).json({ error: 'Unknown action' })
    }
  } catch (error) {
    console.error('[pos-mobile-terminal]', action, error)
    return res.status(500).json({ error: 'Card readers could not be reached. Try again.' })
  }
}

async function hostName(hostId: string): Promise<string> {
  const host = await firebaseAdmin.app().firestore().collection('hosts').doc(hostId).get()
  return String(host.get('name') ?? host.get('title') ?? '').trim().slice(0, 100) || 'Store'
}

/** Readiness as the app's readers panel draws it. */
export async function terminalReadiness(staff: PosStaff) {
  const available = posTerminalAvailable()
  const [merchant, locationId] = await Promise.all([
    posMerchantAccount(staff.hostId, staff.org),
    posTerminalLocationId(staff.hostId),
  ])
  return {
    available,
    testMode: posStripeTestMode(),
    merchantReady: Boolean(merchant),
    locationReady: Boolean(locationId),
  }
}

type Res = Parameters<PluginApiHandler>[1]

async function mintToken(staff: PosStaff, res: Res) {
  if (!posTerminalAvailable()) {
    return res
      .status(409)
      .json({ error: 'Card readers are not available yet.', code: 'terminal-unavailable' })
  }
  // A reader that connects for a store that cannot take card payments would
  // only fail at the first sale, in front of a customer.
  const onBehalfOf = await posMerchantAccount(staff.hostId, staff.org)
  if (!onBehalfOf) {
    return res.status(409).json({
      error: 'Finish setting up payments in the console before taking cards.',
      code: 'merchant-not-ready',
    })
  }
  const token = await createPosTerminalConnectionToken(staff.hostId)
  if (!token) {
    const locationId = await posTerminalLocationId(staff.hostId)
    return locationId
      ? res.status(502).json({ error: 'Stripe did not answer. Try again.' })
      : res.status(409).json({
          error: 'Add the store address card readers are used at.',
          code: 'location-required',
        })
  }
  return res.status(200).json({
    secret: token.secret,
    locationId: token.locationId,
    onBehalfOf,
    merchantDisplayName: await hostName(staff.hostId),
    testMode: posStripeTestMode(),
  })
}

/** An address from the app, bounded the way `pos-readers` bounds it. */
export function readPosTerminalAddress(raw: unknown): PosTerminalAddress | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const address = raw as Record<string, unknown>
  const text = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)
  return {
    line1: text(address['line1'], 200),
    ...(text(address['line2'], 200) ? { line2: text(address['line2'], 200) } : {}),
    city: text(address['city'], 100),
    ...(text(address['state'], 100) ? { state: text(address['state'], 100) } : {}),
    postalCode: text(address['postalCode'], 20),
    country: text(address['country'], 2).toUpperCase(),
  }
}

async function registerLocation(staff: PosStaff, body: Record<string, unknown>, res: Res) {
  if (!posTerminalAvailable()) {
    return res
      .status(409)
      .json({ error: 'Card readers are not available yet.', code: 'terminal-unavailable' })
  }
  const address = readPosTerminalAddress(body['address'])
  const location = await ensurePosTerminalLocation({
    hostId: staff.hostId,
    orgId: staff.orgId,
    displayName: await hostName(staff.hostId),
    ...(address ? { address } : {}),
  })
  if ('error' in location) return res.status(location.status).json({ error: location.error })
  return res.status(200).json({ locationId: location.locationId })
}
