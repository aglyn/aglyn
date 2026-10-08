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

import type { ZapierHook, ZapierHookRecord, ZapierHookStore } from '../server/store'

/**
 * The in-memory `ZapierHookStore` the specs drive (AGL-3643), with the
 * semantics the Firestore one has: newest first, one hook per site and URL,
 * the per-site limit, and a delivered marker per event per hook. Test-only.
 */
export function memoryZapierHookStore(seed: ZapierHook[] = []) {
  const hooks = new Map<string, ZapierHook>(seed.map((hook) => [hook.id, { ...hook }]))
  const delivered = new Set<string>()
  let next = 0
  const store: ZapierHookStore = {
    async listHooks(hostId, event) {
      return [...hooks.values()]
        .filter((hook) => hook.hostId === hostId && (!event || hook.events.includes(event)))
        .sort((a, b) => b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id))
        .map((hook) => ({ ...hook }))
    },
    async hasHook(hostId, event) {
      return [...hooks.values()].some((hook) => hook.hostId === hostId && hook.events.includes(event))
    },
    async getHook(id) {
      const hook = hooks.get(id)
      return hook ? { ...hook } : null
    },
    async upsertHook(record: ZapierHookRecord, max: number) {
      const same = [...hooks.values()].find(
        (hook) => hook.hostId === record.hostId && hook.targetUrl === record.targetUrl,
      )
      if (same) {
        Object.assign(same, {
          events: record.events,
          keyId: record.keyId,
          keyName: record.keyName,
          updatedAtMs: record.updatedAtMs,
        })
        return { hook: { ...same }, created: false }
      }
      if ([...hooks.values()].filter((hook) => hook.hostId === record.hostId).length >= max) {
        return { limit: true } as const
      }
      const hook = { ...record, id: `hook_${++next}` }
      hooks.set(hook.id, hook)
      return { hook: { ...hook }, created: true }
    },
    async updateHook(id, patch) {
      const hook = hooks.get(id)
      if (!hook) throw new Error(`no hook ${id}`)
      Object.assign(hook, patch)
    },
    async deleteHook(id) {
      hooks.delete(id)
    },
    async wasDelivered(eventId, hookId) {
      return delivered.has(`${eventId}|${hookId}`)
    },
    async markDelivered(input) {
      delivered.add(`${input.eventId}|${input.hookId}`)
    },
  }
  return { store, hooks, delivered }
}
