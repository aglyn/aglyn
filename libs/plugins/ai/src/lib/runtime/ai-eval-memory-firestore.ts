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

/**
 * A site in memory, for a live eval run that builds a whole job (AGL-3030).
 *
 * A recording is worth having only when it measures what production sends,
 * so the page recorder runs the page job's own step runners — which write
 * their drafts through the draft writer — rather than a copy of their
 * prompts. Those runners take the machine's Firestore handle; this is a handle
 * that keeps every document in a map instead, for the length of one recording.
 *
 * It answers exactly the calls the draft writer and the generation steps
 * make: a document read, a projection of a collection with its limit, and a
 * transaction that reads before it creates or updates. Anything else throws,
 * so a step that starts reading something new fails the recording loudly
 * rather than reading nothing. It never runs in production: nothing a
 * deployment loads imports it.
 */

import type { AiSiteInventory } from '../model/ai-site-inventory'
import { aiBracketedFacts } from './ai-doctrine-validators'

type Data = Record<string, unknown>

function valueAt(data: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) => (value && typeof value === 'object' ? (value as Data)[key] : undefined),
      data,
    )
}

function setAt(data: Data, dotted: string, value: unknown): void {
  const keys = dotted.split('.')
  let cursor = data
  for (const key of keys.slice(0, -1)) {
    cursor[key] = { ...((cursor[key] as Data | undefined) ?? {}) }
    cursor = cursor[key] as Data
  }
  cursor[keys[keys.length - 1]] = value
}

export interface AiEvalMemoryFirestore {
  /** The handle a step runner is given. */
  firestore: FirebaseFirestore.Firestore
  /** Every document by its path, as the runners left it. */
  docs: Map<string, Data>
}

/** A Firestore handle over an in-memory map, seeded with documents by path. */
export function aiEvalMemoryFirestore(seed: Record<string, Data> = {}): AiEvalMemoryFirestore {
  const docs = new Map<string, Data>(Object.entries(seed))

  const snapshotOf = (path: string) => {
    const data = docs.get(path)
    return {
      id: path.split('/').pop() as string,
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => (data ? valueAt(data, field) : undefined),
    }
  }

  interface Query {
    kind: 'query'
    limit: (count: number) => Query
    get: () => Promise<{ docs: Array<ReturnType<typeof snapshotOf>> }>
  }

  const queryOf = (path: string, max = Number.POSITIVE_INFINITY): Query => ({
    kind: 'query',
    // The products step reads a site's categories a page at a time (AGL-3074).
    limit: (count) => queryOf(path, Math.min(max, count)),
    get: async () => ({
      docs: [...docs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .sort()
        .slice(0, max)
        .map(snapshotOf),
    }),
  })

  const collectionRef = (path: string): Data => {
    const query = queryOf(path)
    return {
      path,
      doc: (id: string) => docRef(`${path}/${id}`),
      select: () => query,
      get: query.get,
    }
  }

  const docRef = (path: string): Data => ({
    kind: 'doc',
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
  })

  type Target = { kind: 'doc'; path: string } | ReturnType<typeof queryOf>

  const firestore = {
    collection: (name: string) => collectionRef(name),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const writes: Array<() => void> = []
      const result = await fn({
        get: async (target: Target) => (target.kind === 'query' ? target.get() : snapshotOf(target.path)),
        create: (ref: { path: string }, data: Data) =>
          writes.push(() => {
            if (docs.has(ref.path)) throw new Error(`6 ALREADY_EXISTS: ${ref.path}`)
            docs.set(ref.path, data)
          }),
        update: (ref: { path: string }, patch: Data) =>
          writes.push(() => {
            const current = docs.get(ref.path)
            if (!current) throw new Error(`5 NOT_FOUND: ${ref.path}`)
            const next = { ...current }
            for (const [key, value] of Object.entries(patch)) setAt(next, key, value)
            docs.set(ref.path, next)
          }),
        set: (ref: { path: string }, data: Data) =>
          writes.push(() => {
            docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...data })
          }),
      })
      for (const write of writes) write()
      return result
    },
  }
  return { firestore: firestore as unknown as FirebaseFirestore.Firestore, docs }
}

/**
 * A site's inventory as the reader would list it from the documents in
 * memory (AGL-3031): the case's own rows, and every layout, form and
 * component a job has written there since. A page job builds its creations
 * before its page, and the page is held to placing them, so the inventory it
 * reads has to change as the job builds — as the real reader's does.
 */
export function aiEvalMemoryInventory(base: AiSiteInventory, docs: ReadonlyMap<string, Data>): AiSiteInventory {
  const rows = (collection: string) =>
    [...docs.entries()]
      .filter(([path]) => path.startsWith(`hosts/${base.hostId}/${collection}/`) && path.split('/').length === 4)
      .map(([path, data]) => ({ id: path.split('/')[3], data }))
      .filter(({ data }) => data['deletedAt'] == null)
  const listed = (ids: readonly { id: string }[]) => new Set(ids.map((row) => row.id))
  const layouts = listed(base.layouts)
  const components = listed(base.components)
  const forms = listed(base.forms)
  return {
    ...base,
    layouts: [
      ...base.layouts,
      ...rows('layouts')
        .filter(({ id }) => !layouts.has(id))
        .map(({ id, data }) => ({ id, name: String(data['displayName'] ?? id), parentId: null })),
    ],
    components: [
      ...base.components,
      ...rows('components')
        .filter(({ id, data }) => !components.has(id) && Boolean(data['rootId'] || data['versionId']))
        .map(({ id, data }) => {
          const props = ((data['props'] as Array<{ name?: string; type?: string; defaultValue?: unknown }> | undefined) ?? []).filter(
            (prop) => typeof prop.name === 'string' && prop.name,
          )
          const bracketedDefaults = Object.fromEntries(
            props
              .map((prop) => [prop.name as string, aiBracketedFacts([typeof prop.defaultValue === 'string' ? prop.defaultValue : ''])] as const)
              .filter(([, facts]) => facts.length),
          )
          return {
            id,
            name: String(data['displayName'] ?? id),
            props: Object.fromEntries(props.map((prop) => [prop.name as string, prop.type || 'text'])),
            ...(Object.keys(bracketedDefaults).length ? { bracketedDefaults } : {}),
          }
        }),
    ],
    forms: [
      ...base.forms,
      ...rows('forms')
        .filter(({ id }) => !forms.has(id))
        .map(({ id, data }) => ({
          id,
          name: String(data['displayName'] ?? id),
          fields: ((data['fields'] as Array<{ fieldName?: string }> | undefined) ?? [])
            .map((field) => field.fieldName ?? '')
            .filter(Boolean),
        })),
    ],
  }
}
