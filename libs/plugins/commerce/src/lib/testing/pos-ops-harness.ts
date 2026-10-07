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

import type { PluginApiRequest } from '@aglyn/aglyn/server'
import type { PosOpsDeps, PosOpsMembership } from '../server/pos-ops-gate'
import { memoryFirestore, type MemoryFirestore } from './pos-ops-memory-firestore'

/*==========================================
 * THE REGISTER'S ROUTES UNDER TEST (AGL-3609).
 *
 * One in-memory site — `hosts/shop`, owned by `org-1` on a plan with POS —
 * with three people: `owner` (a workspace admin), `cashier` (an editor with
 * `managePos`) and `viewer`. A token is the uid it signs in as. Stripe is a
 * counted fetch that answers what the spec tells it to, and nothing here can
 * reach the network.
 *=========================================*/

export interface PosOpsHarness {
  memory: MemoryFirestore
  deps: PosOpsDeps
  /** The clock every route reads; move it to expire an assertion or a lockout. */
  clock: { now: number }
  /** Per-uid membership; edit to revoke `managePos` or demote someone. */
  memberships: Record<string, PosOpsMembership>
  config: Record<string, unknown>
  entitled: { pos: boolean }
  stripeCalls: Array<{ url: string; body: URLSearchParams; idempotencyKey: string | null }>
  /** What the next Stripe call answers; a queue, then `ok` with a fresh id. */
  stripeReplies: Array<{ status: number; body: Record<string, unknown> }>
  /** Every drawer kick and report print the routes queued, in order. */
  printed: Array<{ kind: 'drawer' | 'report'; input: Record<string, any> }>
  request(uid: string | null, body: Record<string, unknown>, headers?: Record<string, string>): PluginApiRequest
}

export function posOpsHarness(): PosOpsHarness {
  const clock = { now: 1_800_000_000_000 }
  const memory = memoryFirestore(() => clock.now)
  const memberships: Record<string, PosOpsMembership> = {
    owner: { orgWide: true, hostRole: 'admin', permissions: { managePos: true } },
    cashier: { orgWide: false, hostRole: 'editor', permissions: { managePos: true } },
    cashier2: { orgWide: false, hostRole: 'editor', permissions: { managePos: true } },
    viewer: { orgWide: false, hostRole: 'viewer', permissions: { managePos: false } },
  }
  const config: Record<string, unknown> = {}
  const entitled = { pos: true }
  const stripeCalls: PosOpsHarness['stripeCalls'] = []
  const stripeReplies: PosOpsHarness['stripeReplies'] = []
  let refundSeq = 0
  const printed: PosOpsHarness['printed'] = []
  memory.seed('hosts/shop', {
    memberRoles: { owner: 'admin', cashier: 'editor', cashier2: 'editor', viewer: 'viewer' },
  })
  memory.seed('hosts/other', { memberRoles: { owner: 'admin' } })
  memory.seed('hosts/shop/registers/front', { name: 'Front', locationId: 'loc-1' })
  memory.seed('hosts/shop/registers/back', { name: 'Back' })
  memory.seed('hosts/other/registers/theirs', { name: 'Theirs' })
  const fetchDouble = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    stripeCalls.push({
      url: String(url),
      body: new URLSearchParams(String(init?.body ?? '')),
      idempotencyKey: headers['Idempotency-Key'] ?? null,
    })
    const reply = stripeReplies.shift() ?? { status: 200, body: { id: `re_${++refundSeq}` } }
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
    } as unknown as Response
  }) as unknown as typeof fetch
  const deps: PosOpsDeps = {
    firestore: () => memory.firestore,
    verifyIdToken: async (token) => {
      if (!token.startsWith('token-')) throw new Error('bad token')
      return { uid: token.slice('token-'.length) }
    },
    membership: async (uid) =>
      memberships[uid] ?? { orgWide: false, hostRole: null, permissions: {} },
    orgForHost: async () => ({ orgId: 'org-1', org: { id: 'org-1' } }),
    pluginConfig: async () => config,
    posEntitled: () => entitled.pos,
    signingSecret: () => 'test-signing-secret',
    memberName: async (uid) => ({ owner: 'Olive Owner', cashier: 'Cal Cashier' } as Record<string, string>)[uid] ?? uid,
    now: () => clock.now,
    fetch: fetchDouble,
    printer: {
      kickDrawer: async (input) => {
        printed.push({ kind: 'drawer', input })
        return { jobIds: [`job-${printed.length}`] }
      },
      printReport: async (input) => {
        printed.push({ kind: 'report', input })
        return { jobIds: [`job-${printed.length}`] }
      },
    },
  }
  return {
    memory,
    deps,
    clock,
    memberships,
    config,
    entitled,
    stripeCalls,
    stripeReplies,
    printed,
    request: (uid, body, headers = {}) =>
      ({
        method: 'POST',
        headers: { ...(uid ? { authorization: `Bearer token-${uid}` } : {}), ...headers },
        body,
        query: {},
      }) as unknown as PluginApiRequest,
  }
}
