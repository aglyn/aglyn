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

import { logHostActivity } from '@aglyn/tenant-data-admin'
import { LoyaltyVendorError } from '../connectors/types'
import {
  isLoyaltyConnectorId,
  LOYALTY_DISCONNECT_EXPLANATION,
  LOYALTY_CONNECTOR_LABELS,
  loyaltyConnectorCredentialsProblem,
  secretLast4,
  type LoyaltyConnectionAnswer,
  type LoyaltyConnectorId,
} from '../model/loyalty-connectors'
import { formatPoints } from '../model/loyalty-math'
import {
  loyaltyVendorFor,
  readLoyaltyConnectorsKeyring,
} from './connector-config'
import {
  closeOpenLoyaltySync,
  loyaltySyncAttention,
  sendLoyaltySync,
} from './connector-sync'
import {
  readLoyaltyConnection,
  sealLoyaltyApiToken,
  toLoyaltyConnectionView,
} from './connection-store'
import { loyaltyDb, loyaltyRefs } from './db'
import type { LoyaltyScope } from './members'
import { forgetLoyaltyProgramCache, readLoyaltyProgram } from './program-store'
import { json, loyaltyGate, refuse } from './route-gate'
import { programTotals } from './routes'

/**
 * `loyalty/connection` (AGL-3677): the store's own Smile.io or Yotpo account.
 *
 *   GET  ?hostId                       viewer: whether the deployment can connect
 *                                      one, the connection (never its key), and
 *                                      the movements waiting or refused
 *   POST {hostId, action: 'connect', provider, credentials, replaceBalances}
 *   POST {hostId, action: 'disconnect', confirm: true}
 *   POST {hostId, action: 'retry', rowIds?}         admin
 *
 * Connecting checks the credentials with the vendor before anything is kept.
 * Built-in points members already hold are SET ASIDE, never spent or erased:
 * the merchant confirms that first, and disconnecting gives every member
 * exactly the built-in points they had at connect, while what was earned at
 * the vendor stays there. Store credit is never touched by either.
 * Disconnecting needs `confirm: true` — the card shows what it does first —
 * and turns the program off, so nothing earns twice while the merchant
 * decides what runs next.
 */

const NOT_CONFIGURED =
  'Connecting a rewards account is not available on this deployment.'

async function answer(scope: LoyaltyScope): Promise<LoyaltyConnectionAnswer> {
  if (!readLoyaltyConnectorsKeyring())
    return {
      configured: false,
      connection: null,
      attention: [],
      builtInPoints: null,
    }
  const [connection, program] = await Promise.all([
    readLoyaltyConnection(scope.orgId, scope.hostId),
    readLoyaltyProgram(scope.orgId, scope.hostId),
  ])
  const live =
    connection && program.connected === connection.provider ? connection : null
  const attention = live ? await loyaltySyncAttention(scope) : []
  const builtInPoints = live
    ? null
    : (await programTotals(scope.orgId, scope.hostId, program))
        .outstandingPoints
  return {
    configured: true,
    connection: live ? toLoyaltyConnectionView(live) : null,
    attention,
    builtInPoints,
  }
}

/**
 * CONNECTING SETS BUILT-IN POINTS ASIDE; IT NEVER SPENDS THEM. Each member's
 * built-in points are parked (`parked`, `parkedPoints`) on their own document
 * and `points` starts mirroring the connected account from zero. A member
 * already parked (the store is switching accounts) keeps what was parked.
 * Store credit and live checkout holds are not touched.
 */
async function parkBuiltInPoints(
  scope: LoyaltyScope,
  nowMs: number,
): Promise<number> {
  let parked = 0
  for (const sign of ['>', '<'] as const) {
    for (let page = 0; page < 200; page += 1) {
      const snapshot = await loyaltyRefs
        .members(scope.orgId)
        .where('hostId', '==', scope.hostId)
        .where('points', sign, 0)
        .limit(400)
        .get()
      if (snapshot.empty) break
      const batch = loyaltyDb().batch()
      for (const doc of snapshot.docs) {
        const data = doc.data()
        const already = data['parked'] === true
        batch.set(doc.ref, {
          ...data,
          ...(already
            ? {}
            : {
                parked: true,
                parkedPoints: Math.trunc(Number(data['points']) || 0),
              }),
          points: 0,
          updatedAtMs: nowMs,
        })
        if (!already) parked += 1
      }
      await batch.commit()
    }
  }
  return parked
}

/**
 * DISCONNECTING GIVES BUILT-IN POINTS BACK EXACTLY. The mirror of the account
 * is cleared (those points stay at the vendor), then every parked member's
 * built-in points are restored to what they were at connect. Store credit and
 * holds are not touched.
 */
async function restoreBuiltInPoints(
  scope: LoyaltyScope,
  nowMs: number,
): Promise<number> {
  for (const sign of ['>', '<'] as const) {
    for (let page = 0; page < 200; page += 1) {
      const snapshot = await loyaltyRefs
        .members(scope.orgId)
        .where('hostId', '==', scope.hostId)
        .where('points', sign, 0)
        .limit(400)
        .get()
      if (snapshot.empty) break
      const batch = loyaltyDb().batch()
      for (const doc of snapshot.docs)
        batch.set(doc.ref, { ...doc.data(), points: 0, updatedAtMs: nowMs })
      await batch.commit()
    }
  }
  let restored = 0
  for (let page = 0; page < 200; page += 1) {
    const snapshot = await loyaltyRefs
      .members(scope.orgId)
      .where('hostId', '==', scope.hostId)
      .where('parked', '==', true)
      .limit(400)
      .get()
    if (snapshot.empty) break
    const batch = loyaltyDb().batch()
    for (const doc of snapshot.docs) {
      const {
        parked: _parked,
        parkedPoints,
        ...rest
      } = doc.data() as Record<string, unknown>
      batch.set(doc.ref, {
        ...rest,
        points: Math.trunc(Number(parkedPoints) || 0),
        updatedAtMs: nowMs,
      })
      restored += 1
    }
    await batch.commit()
  }
  return restored
}

async function setConnected(
  scope: LoyaltyScope,
  provider: LoyaltyConnectorId | null,
  uid: string,
  nowMs: number,
) {
  const current = await readLoyaltyProgram(scope.orgId, scope.hostId)
  await loyaltyRefs.program(scope.orgId, scope.hostId).set({
    ...current,
    connected: provider,
    // Disconnecting turns the program off: the built-in points start from
    // nothing, and the merchant turns them on knowingly.
    ...(provider ? {} : { enabled: false }),
    orgId: scope.orgId,
    hostId: scope.hostId,
    updatedAtMs: nowMs,
    updatedBy: uid,
  })
  forgetLoyaltyProgramCache(scope.hostId)
}

export async function connectionRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST')
    return refuse(405, 'Method not allowed')
  const gate = await loyaltyGate(request, {
    role: request.method === 'GET' ? 'viewer' : 'admin',
  })
  if (gate instanceof Response) return gate
  const scope = { orgId: gate.orgId, hostId: gate.hostId }
  if (request.method === 'GET') return json(await answer(scope))
  if (!readLoyaltyConnectorsKeyring()) return refuse(404, NOT_CONFIGURED)

  const action = String(gate.body['action'] ?? '')
  const nowMs = Date.now()
  const actor = { uid: gate.uid, email: gate.email }

  if (action === 'connect') {
    const provider = gate.body['provider']
    if (!isLoyaltyConnectorId(provider))
      return refuse(400, 'Choose Smile.io or Yotpo Loyalty.')
    const raw = (gate.body['credentials'] ?? {}) as Record<string, unknown>
    const problem = loyaltyConnectorCredentialsProblem(provider, raw)
    if (problem) return refuse(400, problem)
    const credentials = {
      apiKey: String(raw['apiKey']).trim(),
      ...(provider === 'yotpo' ? { guid: String(raw['guid']).trim() } : {}),
    }
    const label = LOYALTY_CONNECTOR_LABELS[provider]
    let accountLabel: string | null
    try {
      accountLabel = (await loyaltyVendorFor(provider).verify(credentials))
        .accountLabel
    } catch (error) {
      if (error instanceof LoyaltyVendorError) {
        return refuse(
          error.kind === 'transient' ? 502 : 400,
          error.kind === 'auth'
            ? `${label} did not accept those credentials.`
            : error.message,
        )
      }
      throw error
    }
    const program = await readLoyaltyProgram(scope.orgId, scope.hostId)
    if (!program.connected) {
      const held =
        (await programTotals(scope.orgId, scope.hostId, program))
          .outstandingPoints ?? 0
      if (held > 0 && gate.body['replaceBalances'] !== true) {
        return Response.json(
          {
            error: `Members hold ${formatPoints(held)} built-in points. While ${label} is connected, each member’s ${label} balance is used instead; their built-in points are set aside and come back exactly if you disconnect.`,
            builtInPoints: held,
          },
          { status: 409, headers: { 'Cache-Control': 'no-store' } },
        )
      }
    }
    const sealed = sealLoyaltyApiToken(credentials.apiKey, scope.hostId)
    if (!sealed) return refuse(404, NOT_CONFIGURED)
    if (program.connected && program.connected !== provider) {
      await closeOpenLoyaltySync(
        scope,
        'The store connected a different account before this was sent.',
        nowMs,
      )
    }
    const previous = await readLoyaltyConnection(scope.orgId, scope.hostId)
    await loyaltyRefs.connection(scope.orgId, scope.hostId).set({
      orgId: scope.orgId,
      hostId: scope.hostId,
      provider,
      ...sealed,
      guid: provider === 'yotpo' ? credentials.guid : null,
      keyLast4: secretLast4(credentials.apiKey),
      accountLabel,
      connectedByUid: gate.uid,
      connectedAtMs:
        previous?.provider === provider ? previous.connectedAtMs : nowMs,
      lastError: null,
      lastSyncedAtMs:
        previous?.provider === provider ? previous.lastSyncedAtMs : null,
      updatedAtMs: nowMs,
    })
    if (program.connected !== provider) await parkBuiltInPoints(scope, nowMs)
    await setConnected(scope, provider, gate.uid, nowMs)
    await logHostActivity(
      gate.hostId,
      actor,
      `Connected ${label} for rewards`,
      {
        type: 'loyalty:connection',
        id: gate.hostId,
        name: label,
      },
    ).catch(() => undefined)
    // Anything the old key could not send goes now.
    if (program.connected === provider)
      await sendLoyaltySync({ ...scope, limit: 20 })
    return json(await answer(scope))
  }

  if (action === 'disconnect') {
    const program = await readLoyaltyProgram(scope.orgId, scope.hostId)
    const connection = await readLoyaltyConnection(scope.orgId, scope.hostId)
    if (!program.connected && !connection) return json(await answer(scope))
    if (gate.body['confirm'] !== true) {
      return Response.json(
        { error: LOYALTY_DISCONNECT_EXPLANATION, confirmRequired: true },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const label =
      LOYALTY_CONNECTOR_LABELS[
        (program.connected ?? connection?.provider) as LoyaltyConnectorId
      ]
    await closeOpenLoyaltySync(
      scope,
      'The store disconnected its rewards account before this was sent.',
      nowMs,
    )
    await loyaltyRefs.connection(scope.orgId, scope.hostId).delete()
    await restoreBuiltInPoints(scope, nowMs)
    await setConnected(scope, null, gate.uid, nowMs)
    await logHostActivity(
      gate.hostId,
      actor,
      `Disconnected ${label} from rewards`,
      {
        type: 'loyalty:connection',
        id: gate.hostId,
        name: label,
      },
    ).catch(() => undefined)
    return json(await answer(scope))
  }

  if (action === 'retry') {
    const program = await readLoyaltyProgram(scope.orgId, scope.hostId)
    if (!program.connected)
      return refuse(409, 'No rewards account is connected.')
    const rowIds = Array.isArray(gate.body['rowIds'])
      ? (gate.body['rowIds'] as unknown[])
          .map(String)
          .filter(
            (id) => id.startsWith(`${gate.hostId}__`) && !id.includes('/'),
          )
          .slice(0, 50)
      : undefined
    const result = await sendLoyaltySync({
      ...scope,
      force: true,
      ...(rowIds ? { rowIds } : { limit: 50 }),
    })
    return json({ ...(await answer(scope)), result })
  }

  return refuse(400, 'Unknown action')
}
