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

import type { AdConversionStore, StoredConnection, StoredConsent, StoredEvent } from '../server/store'

/** An in-memory {@link AdConversionStore} for specs (AGL-3694). */
/** Deep enough for these records: a JSON copy, with `Date` fields restored. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (key, entry) =>
    key === 'expiresAt' && typeof entry === 'string' ? new Date(entry) : entry,
  )
}

export function createMemoryAdConversionStore() {
  const connections = new Map<string, StoredConnection>()
  const consents = new Map<string, StoredConsent>()
  const events = new Map<string, StoredEvent>()
  const store: AdConversionStore = {
    async getConnection(id) {
      const found = connections.get(id)
      return found ? copy(found) : null
    },
    async patchConnection(id, patch) {
      connections.set(id, { ...(connections.get(id) ?? ({} as StoredConnection)), ...copy(patch) })
    },
    async removeConnection(id) {
      connections.delete(id)
    },
    async listConnectionsForHost(hostId) {
      return [...connections.entries()]
        .filter(([, connection]) => connection.hostId === hostId)
        .map(([id, connection]) => ({ id, connection: copy(connection) }))
    },
    async putConsent(id, consent) {
      consents.set(id, copy(consent))
    },
    async getConsent(id) {
      const found = consents.get(id)
      return found ? copy(found) : null
    },
    async removeConsent(id) {
      consents.delete(id)
    },
    async enqueueEvent(id, event) {
      if (events.has(id)) return false
      events.set(id, copy(event))
      return true
    },
    async dueEvents(nowMs, limit) {
      return [...events.entries()]
        .filter(([, event]) => event.status === 'pending' && event.nextAttemptAtMs <= nowMs)
        .sort((a, b) => a[1].nextAttemptAtMs - b[1].nextAttemptAtMs)
        .slice(0, limit)
        .map(([id, stored]) => ({ id, stored: copy(stored) }))
    },
    async eventSent(id, nowMs) {
      const event = events.get(id)
      if (!event) throw new Error(`no event ${id}`)
      events.set(id, {
        ...event,
        status: 'sent',
        lastError: null,
        nextAttemptAtMs: nowMs,
        emailHash: null,
        event: { ...event.event, user: {}, browser: { ip: null, userAgent: null } },
      })
    },
    async eventRetry(id, attempts, nextAttemptAtMs, error) {
      const event = events.get(id)
      if (event) events.set(id, { ...event, attempts, nextAttemptAtMs, lastError: error })
    },
    async eventFailed(id, error) {
      const event = events.get(id)
      if (!event) throw new Error(`no event ${id}`)
      events.set(id, {
        ...event,
        status: 'failed',
        lastError: error,
        emailHash: null,
        event: { ...event.event, user: {}, browser: { ip: null, userAgent: null } },
      })
    },
    async clearEvents(connectionId) {
      for (const [id, event] of events) if (event.connectionId === connectionId) events.delete(id)
    },
    async eraseEventsByEmailHash(orgId, emailHash, dryRun) {
      const mine = [...events.entries()].filter(([, event]) => event.orgId === orgId && event.emailHash === emailHash)
      if (!dryRun) for (const [id] of mine) events.delete(id)
      return mine.length
    },
  }
  return { store, connections, consents, events }
}
