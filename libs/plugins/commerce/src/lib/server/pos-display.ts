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

import { createHash, randomBytes, randomInt } from 'crypto'
import { consumeRateLimit, firebaseAdmin, getPluginConfig, getOrgForHost } from '@aglyn/tenant-data-admin'
import type { PluginApiHandler, PluginApiRequest } from '@aglyn/aglyn/server'
import { resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import * as CommerceModel from '../model'
import { posRegisterSettings } from '../plugin-config'
import { authorizePosStaff, posQueryBody, posRequestBody } from './pos-auth'

/*==========================================
 * THE CUSTOMER DISPLAY (AGL-3608).
 *
 * A second screen — a tablet on a stand facing the customer — that shows the
 * basket, takes the tip and the receipt choice, and hands both back to the
 * cashier. It must work with NO staff sign-in on the customer's device, so it
 * holds nothing but a display token.
 *
 * ## Pairing
 *
 * The register asks for a six-digit code (`pairing-code`), good for ten
 * minutes and usable once. The display sends it (`pair`) and receives a
 * random 256-bit token. Only hashes are stored: `posDisplayPairings/{sha256}`
 * for the code and `posDisplayTokens/{sha256}` for the token, each naming the
 * one site and register it opens. Revoking a display, or removing its
 * register, kills the token. A six-digit space is small, so `pair` is rate
 * limited per address and a code dies at its first use.
 *
 * ## Why polling through this route, not a Firestore listener
 *
 * A Firestore listener needs a Firebase identity the rules can test, which on
 * the customer's device means minting a custom auth session — a credential
 * that would sit on an unattended tablet with the console's own SDK. Polling
 * this route once a second with the display token is the simplest thing that
 * is secure: the token opens exactly one register's display state and
 * nothing else, the state lives in a server-only collection
 * (`posDisplayStates`, denied to every client by the rules) so not even a
 * signed-in site member can read a customer's typed address out of it, and a
 * revoked token stops working on the next poll.
 *=========================================*/

const PAIRINGS = 'posDisplayPairings'
const TOKENS = 'posDisplayTokens'
const STATES = 'posDisplayStates'

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** The one state document a register's display reads. */
export function posDisplayStateId(hostId: string, registerId: string): string {
  return `${hostId}__${registerId}`
}

function stateRef(hostId: string, registerId: string) {
  return firebaseAdmin
    .app()
    .firestore()
    .collection(STATES)
    .doc(posDisplayStateId(hostId, registerId))
}

/** Writes the display state whole, so nothing from the last prompt lingers. */
export async function writePosDisplayState(
  hostId: string,
  registerId: string,
  state: CommerceModel.PosDisplayState,
): Promise<void> {
  await stateRef(hostId, registerId).set({ ...state, hostId, registerId })
}

/** The register's display returns to the thank-you screen with no customer data. */
export async function resetPosDisplay(hostId: string, registerId: string): Promise<void> {
  await writePosDisplayState(hostId, registerId, { mode: 'thanks', updatedAtMs: Date.now() })
}

/** Signs every display of a register out, and forgets its state. */
export async function revokePosDisplays(hostId: string, registerId: string): Promise<void> {
  const firestore = firebaseAdmin.app().firestore()
  const tokens = await firestore
    .collection(TOKENS)
    .where('hostId', '==', hostId)
    .where('registerId', '==', registerId)
    .limit(50)
    .get()
  await Promise.all(tokens.docs.map((doc: any) => doc.ref.delete()))
  await stateRef(hostId, registerId).delete().catch(() => undefined)
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

/** The store's name, logo and welcome line, for the idle and thank-you screens. */
async function displayBranding(hostId: string) {
  const firestore = firebaseAdmin.app().firestore()
  const host = await firestore.collection('hosts').doc(hostId).get()
  const ownerOrg = await getOrgForHost(hostId).catch(() => null)
  const settings = posRegisterSettings(
    await getPluginConfig(ownerOrg?.orgId, 'commerce', { hostId }).catch(() => ({})),
  )
  return {
    name: String(host.get('displayName') ?? host.get('name') ?? '').slice(0, 80) || 'Welcome',
    logoUrl: resolveMediaSrc(host.get('logoUrl'), { hostId }) ?? null,
    logoDarkUrl: resolveMediaSrc(host.get('logoDarkUrl'), { hostId }) ?? null,
    message: settings.displayMessage || 'Welcome',
  }
}

/** The display token on a request, or ''. */
function displayToken(req: PluginApiRequest, body: Record<string, any>): string {
  const header = String(req.headers['x-pos-display-token'] ?? '')
  return (header || String(body['token'] ?? '')).trim().slice(0, 128)
}

/** The register a live display token opens, or null. */
async function resolveDisplayToken(
  token: string,
): Promise<{ hostId: string; registerId: string; ref: any } | null> {
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) return null
  const ref = firebaseAdmin.app().firestore().collection(TOKENS).doc(sha256(token))
  const snapshot = await ref.get()
  if (!snapshot.exists) return null
  const hostId = String(snapshot.get('hostId') ?? '')
  const registerId = String(snapshot.get('registerId') ?? '')
  if (!hostId || !registerId) return null
  // A display whose register was removed is dead, even if its token row
  // somehow outlived the removal.
  if (!(await registerExists(hostId, registerId))) return null
  const lastSeen = Number(snapshot.get('lastSeenAtMs') ?? 0)
  if (Date.now() - lastSeen > 60_000) {
    await ref.set({ lastSeenAtMs: Date.now() }, { merge: true }).catch(() => undefined)
  }
  return { hostId, registerId, ref }
}

/**
 * `POST /api/commerce/pos-display`.
 *
 * Staff (Firebase token + the register's gate): `pairing-code`, `push`,
 * `state`, `displays`, `revoke`.
 * Display (display token only): `pair`, `poll`, `respond`, `forget`.
 */
export const posDisplayHandler: PluginApiHandler = async (req, res) => {
  // The two polls are GETs: a read is not a console write, so a display and a
  // register asking once a second do not spend the console's write budget.
  const body = req.method === 'GET' ? posQueryBody(req) : posRequestBody(req)
  const action = String(body['action'] ?? '')
  if (
    !(req.method === 'POST' || (req.method === 'GET' && (action === 'poll' || action === 'state')))
  ) {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  res.setHeader('Cache-Control', 'no-store')
  try {
    switch (action) {
      case 'pair':
        return await pair(req, body, res)
      case 'poll':
      case 'respond':
      case 'forget': {
        const display = await resolveDisplayToken(displayToken(req, body))
        if (!display) return res.status(401).json({ error: 'This display is not paired.' })
        if (action === 'forget') {
          await display.ref.delete()
          return res.status(200).json({ ok: true })
        }
        const snapshot = await stateRef(display.hostId, display.registerId).get()
        const state = snapshot.exists ? (snapshot.data() as CommerceModel.PosDisplayState) : null
        if (action === 'poll') {
          return res.status(200).json({
            state: CommerceModel.posDisplayPublicState(state, Date.now()),
            branding:
              body['branding'] === true || body['branding'] === 'true'
                ? await displayBranding(display.hostId)
                : undefined,
          })
        }
        const response = CommerceModel.sanitizePosDisplayResponse(state, body['response'], Date.now())
        if (!response) {
          return res.status(409).json({ error: 'That screen has moved on. Check the display.' })
        }
        await stateRef(display.hostId, display.registerId).set({ response }, { merge: true })
        return res.status(200).json({ ok: true })
      }
      default:
        return await staffAction(req, body, action, res)
    }
  } catch (error) {
    console.error('[pos-display]', action, error)
    return res.status(500).json({ error: 'The customer display could not be updated' })
  }
}

async function pair(
  req: PluginApiRequest,
  body: Record<string, any>,
  res: Parameters<PluginApiHandler>[1],
) {
  const address = String(req.socket?.remoteAddress ?? '') || 'no-address'
  const rate = await consumeRateLimit(`pos-display-pair:${address}`, {
    limit: 10,
    windowMs: 10 * 60 * 1000,
  })
  if (!rate.allowed) {
    return res.status(429).json({ error: 'Too many tries. Wait a few minutes and try again.' })
  }
  const code = String(body['code'] ?? '').replace(/\D/g, '')
  if (code.length !== 6) return res.status(400).json({ error: 'Enter the 6-digit code from the register.' })
  const firestore = firebaseAdmin.app().firestore()
  const pairingRef = firestore.collection(PAIRINGS).doc(sha256(code))
  const token = randomBytes(32).toString('base64url')
  // Spent in the same transaction that mints the token: a code opens one
  // display, once, and a second display racing the first gets nothing.
  const paired = await firestore.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(pairingRef)
    if (!snapshot.exists) return null
    const expiresAtMs = Number(snapshot.get('expiresAtMs') ?? 0)
    transaction.delete(pairingRef)
    if (!(expiresAtMs > Date.now())) return null
    const hostId = String(snapshot.get('hostId') ?? '')
    const registerId = String(snapshot.get('registerId') ?? '')
    transaction.set(firestore.collection(TOKENS).doc(sha256(token)), {
      hostId,
      registerId,
      createdAtMs: Date.now(),
      createdBy: String(snapshot.get('createdBy') ?? ''),
      lastSeenAtMs: Date.now(),
      label: String(body['label'] ?? '').slice(0, 60) || 'Customer display',
    })
    return { hostId, registerId }
  })
  if (!paired) {
    return res.status(404).json({ error: 'That code is not valid. Show a new code on the register.' })
  }
  return res.status(200).json({ token, branding: await displayBranding(paired.hostId) })
}

async function staffAction(
  req: PluginApiRequest,
  body: Record<string, any>,
  action: string,
  res: Parameters<PluginApiHandler>[1],
) {
  const hostId = String(body['hostId'] ?? '')
  const gate = await authorizePosStaff(req, hostId)
  if ('error' in gate) return res.status(gate.status).json({ error: gate.error })
  const registerId = String(body['registerId'] ?? '')
  if (!(await registerExists(hostId, registerId))) {
    return res.status(404).json({ error: 'Unknown register' })
  }
  const firestore = firebaseAdmin.app().firestore()
  switch (action) {
    case 'pairing-code': {
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
        const ref = firestore.collection(PAIRINGS).doc(sha256(code))
        const expiresAtMs = Date.now() + CommerceModel.POS_DISPLAY_PAIRING_TTL_MS
        const claimed = await firestore.runTransaction(async (transaction: any) => {
          const existing = await transaction.get(ref)
          // A live code another register is showing is never overwritten.
          if (existing.exists && Number(existing.get('expiresAtMs') ?? 0) > Date.now()) return false
          transaction.set(ref, {
            hostId,
            registerId,
            expiresAtMs,
            createdBy: gate.staff.uid,
          })
          return true
        })
        if (claimed) return res.status(200).json({ code, expiresAtMs })
      }
      return res.status(503).json({ error: 'Could not make a code. Try again.' })
    }
    case 'push': {
      const state = CommerceModel.sanitizePosDisplayState(body['state'], Date.now())
      await writePosDisplayState(hostId, registerId, state)
      return res.status(200).json({ ok: true, promptId: state.promptId ?? null })
    }
    case 'state': {
      const snapshot = await stateRef(hostId, registerId).get()
      const state = snapshot.exists ? (snapshot.data() as CommerceModel.PosDisplayState) : null
      const displays = await firestore
        .collection(TOKENS)
        .where('hostId', '==', hostId)
        .where('registerId', '==', registerId)
        .limit(10)
        .get()
      return res.status(200).json({
        state,
        // A display that polled within the last two minutes is "connected".
        connected: displays.docs.some(
          (doc: any) => Date.now() - Number(doc.get('lastSeenAtMs') ?? 0) < 120_000,
        ),
      })
    }
    case 'displays': {
      const displays = await firestore
        .collection(TOKENS)
        .where('hostId', '==', hostId)
        .where('registerId', '==', registerId)
        .limit(10)
        .get()
      return res.status(200).json({
        displays: displays.docs.map((doc: any) => ({
          id: doc.id.slice(0, 16),
          label: String(doc.get('label') ?? 'Customer display'),
          createdAtMs: Number(doc.get('createdAtMs') ?? 0),
          lastSeenAtMs: Number(doc.get('lastSeenAtMs') ?? 0),
        })),
      })
    }
    case 'revoke': {
      const prefix = String(body['displayId'] ?? '')
      const displays = await firestore
        .collection(TOKENS)
        .where('hostId', '==', hostId)
        .where('registerId', '==', registerId)
        .limit(10)
        .get()
      const doomed = displays.docs.filter(
        (doc: any) => prefix === '*' || (prefix.length === 16 && doc.id.startsWith(prefix)),
      )
      await Promise.all(doomed.map((doc: any) => doc.ref.delete()))
      return res.status(200).json({ revoked: doomed.length })
    }
    default:
      return res.status(400).json({ error: 'Unknown action' })
  }
}
