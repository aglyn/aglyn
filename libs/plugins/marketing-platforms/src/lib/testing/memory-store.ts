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

import { EVENT_MAX_ATTEMPTS } from '../constants'
import { MARKETING_PROVIDERS, type MarketingConnectionLogEntry } from '../model/connections'
import { eventRetryDelayMs, type ConnectionStore, type StoredConnection, type StoredEvent } from '../server/store'

/** An in-memory {@link ConnectionStore} with the production store's semantics, for specs. */
export function createMemoryStore() {
  const connections = new Map<string, StoredConnection>()
  const logs = new Map<string, MarketingConnectionLogEntry[]>()
  const events = new Map<string, StoredEvent>()
  let logSeq = 0

  const store: ConnectionStore = {
    async get(id) {
      const found = connections.get(id)
      return found ? structuredClone(found) : null
    },
    async patch(id, patch) {
      connections.set(id, { ...(connections.get(id) ?? ({} as StoredConnection)), ...structuredClone(patch) })
    },
    async remove(id) {
      connections.delete(id)
      logs.delete(id)
    },
    async listForHost(hostId) {
      return [...connections.entries()]
        .filter(([, connection]) => connection.hostId === hostId)
        .map(([id, connection]) => ({ id, connection: structuredClone(connection) }))
    },
    async listDue(nowMs, limit) {
      return [...connections.entries()]
        .filter(([, connection]) => connection.status === 'active' && connection.nextRunAtMs <= nowMs)
        .sort(([, a], [, b]) => a.nextRunAtMs - b.nextRunAtMs)
        .slice(0, limit)
        .map(([id]) => id)
    },
    async lease(id, nowMs, leaseMs) {
      const stored = connections.get(id)
      if (!stored || stored.status !== 'active') return null
      if ((stored.nextRunAtMs ?? 0) > nowMs || (stored.leaseUntilMs ?? 0) > nowMs) return null
      stored.leaseUntilMs = nowMs + leaseMs
      return structuredClone(stored)
    },
    async appendLog(id, entry) {
      const list = logs.get(id) ?? []
      list.push({ id: `log-${(logSeq += 1)}`, ...entry })
      logs.set(id, list)
    },
    async readLog(id, limit, beforeMs) {
      return [...(logs.get(id) ?? [])]
        .sort((a, b) => b.atMs - a.atMs)
        .filter((entry) => typeof beforeMs !== 'number' || entry.atMs < beforeMs)
        .slice(0, limit)
    },
    async eventConnectionsForHost(hostId) {
      return [...connections.entries()]
        .filter(
          ([, connection]) =>
            connection.hostId === hostId &&
            (connection.status === 'active' || connection.status === 'error') &&
            connection.syncEvents !== false &&
            MARKETING_PROVIDERS[connection.provider]?.events === true,
        )
        .map(([id]) => id)
    },
    async enqueueEvent(connectionId, owner, event, nowMs) {
      const id = `${connectionId}_${event.id}`
      if (events.has(id)) return
      events.set(id, {
        orgId: owner.orgId,
        connectionId,
        hostId: owner.hostId,
        status: 'pending',
        attempts: 0,
        nextAttemptAtMs: nowMs,
        createdAtMs: nowMs,
        lastError: null,
        event,
      })
    },
    async pendingEvents(connectionId, limit) {
      return [...events.entries()]
        .filter(([, stored]) => stored.connectionId === connectionId && stored.status === 'pending')
        .sort(([, a], [, b]) => a.createdAtMs - b.createdAtMs)
        .slice(0, limit)
        .map(([id, stored]) => ({ id, stored: structuredClone(stored) }))
    },
    async eventDelivered(id) {
      events.delete(id)
    },
    async eventFailed(id, stored, error, nowMs) {
      const attempts = (stored.attempts ?? 0) + 1
      const failed = attempts >= EVENT_MAX_ATTEMPTS
      events.set(id, {
        ...stored,
        attempts,
        lastError: error,
        status: failed ? 'failed' : 'pending',
        nextAttemptAtMs: nowMs + eventRetryDelayMs(attempts),
      })
      return failed ? 'failed' : 'retry'
    },
    async clearEvents(connectionId) {
      for (const [id, stored] of events) if (stored.connectionId === connectionId) events.delete(id)
    },
  }
  return { store, connections, logs, events }
}

/** A `fetch` that answers from a list of handlers and records every call. */
export function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = []
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const raw = typeof init.body === 'string' ? init.body : null
    let body: any
    try {
      body = raw ? JSON.parse(raw) : null
    } catch {
      body = raw
    }
    calls.push({ url, method: String(init.method ?? 'GET'), headers: (init.headers ?? {}) as Record<string, string>, body })
    const answer = handler(url, init)
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: answer.headers,
    })
  }) as typeof fetch
  return { fetch: fetchImpl, calls, http: { fetch: fetchImpl, sleep: async () => undefined } }
}
