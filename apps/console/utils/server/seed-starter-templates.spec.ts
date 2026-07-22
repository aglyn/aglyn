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

import {
  buildAllStarterTemplateDocs,
  buildStarterTemplateDocs,
  starterTemplateDocId,
  STARTER_TEMPLATES,
} from '../../constants/starter-templates'
import materializeStarterTemplate, {
  type SeedFirestore,
} from './seed-starter-templates'

/**
 * In-memory stand-in for the admin Firestore surface the seed uses. Enough
 * to answer the question the seed's idempotency turns on: how many documents
 * exist under `hosts/{hostId}/templates`, and what is in them.
 */
function createFakeFirestore(hostDoc: Record<string, unknown> | null = {}) {
  const hosts = new Map<string, Record<string, unknown>>()
  if (hostDoc) hosts.set('host1', { ...hostDoc })
  const templates = new Map<string, Record<string, unknown>>()
  const pending: Array<() => void> = []
  let commits = 0

  const snapshot = (store: Map<string, Record<string, unknown>>, id: string) => ({
    get exists() {
      return store.has(id)
    },
    get(field: string) {
      return store.get(id)?.[field]
    },
  })
  const hostRef = (id: string) => ({
    __store: hosts,
    __id: id,
    get: async () => snapshot(hosts, id),
    collection: () => ({
      doc: (templateId: string) => ({
        __store: templates,
        __id: templateId,
        get: async () => snapshot(templates, templateId),
      }),
    }),
  })

  const firestore = {
    collection: () => ({ doc: hostRef }),
    batch: () => ({
      set(ref: any, data: Record<string, unknown>) {
        pending.push(() => ref.__store.set(ref.__id, { ...data }))
      },
      update(ref: any, data: Record<string, unknown>) {
        pending.push(() =>
          ref.__store.set(ref.__id, { ...(ref.__store.get(ref.__id) ?? {}), ...data }),
        )
      },
      async commit() {
        commits += 1
        for (const write of pending.splice(0)) write()
      },
    }),
  } as unknown as SeedFirestore

  return {
    firestore,
    templates,
    hosts,
    get commits() {
      return commits
    },
  }
}

const FIRST = STARTER_TEMPLATES[0]
const SECOND = STARTER_TEMPLATES[1]

describe('materializeStarterTemplate (AGL-687)', () => {
  it('copies in only the starter that was asked for', async () => {
    const { firestore, templates } = createFakeFirestore()
    const result = await materializeStarterTemplate(
      firestore as unknown as SeedFirestore,
      'host1',
      FIRST.id,
    )
    expect(result.created).toBe(FIRST.screens.length)
    expect(templates.size).toBe(FIRST.screens.length)
    // The other starters stay virtual — nothing of theirs was written.
    for (const doc of buildStarterTemplateDocs(SECOND)) {
      expect(templates.has(doc.id)).toBe(false)
    }
  })

  it('writes nothing for a starter nobody asked for', async () => {
    const { firestore, templates } = createFakeFirestore()
    const result = await materializeStarterTemplate(
      firestore as unknown as SeedFirestore,
      'host1',
      'no-such-starter',
    )
    expect(result).toEqual({ created: 0, skipped: 0 })
    expect(templates.size).toBe(0)
  })

  it('is idempotent — twice leaves one copy, not two', async () => {
    const { firestore, templates } = createFakeFirestore()
    await materializeStarterTemplate(
      firestore as unknown as SeedFirestore, 'host1', FIRST.id,
    )
    const second = await materializeStarterTemplate(
      firestore as unknown as SeedFirestore, 'host1', FIRST.id,
    )
    expect(second.created).toBe(0)
    expect(second.skipped).toBe(FIRST.screens.length)
    expect(templates.size).toBe(FIRST.screens.length)
  })

  it('never clobbers a user edit to an already-materialized starter', async () => {
    const { firestore, templates } = createFakeFirestore()
    await materializeStarterTemplate(
      firestore as unknown as SeedFirestore, 'host1', FIRST.id,
    )
    const id = starterTemplateDocId(FIRST.id, FIRST.screens[0].key)
    templates.set(id, { ...templates.get(id), displayName: 'My renamed page' })
    await materializeStarterTemplate(
      firestore as unknown as SeedFirestore, 'host1', FIRST.id,
    )
    expect(templates.get(id)?.displayName).toBe('My renamed page')
  })

  it('does not resurrect a starter page the user deleted', async () => {
    const { firestore, templates } = createFakeFirestore()
    await materializeStarterTemplate(
      firestore as unknown as SeedFirestore, 'host1', FIRST.id,
    )
    const id = starterTemplateDocId(FIRST.id, FIRST.screens[0].key)
    templates.set(id, { ...templates.get(id), deletedAt: 'yes' })
    await materializeStarterTemplate(
      firestore as unknown as SeedFirestore, 'host1', FIRST.id,
    )
    expect(templates.get(id)?.deletedAt).toBe('yes')
  })

  it('fills in only the pages that are missing', async () => {
    const { firestore, templates } = createFakeFirestore()
    const docs = buildStarterTemplateDocs(FIRST)
    templates.set(docs[0].id, { displayName: 'already here' })
    const result = await materializeStarterTemplate(
      firestore as unknown as SeedFirestore, 'host1', FIRST.id,
    )
    expect(result.created).toBe(docs.length - 1)
    expect(result.skipped).toBe(1)
  })

  it('does not consult a host-level seed marker', async () => {
    // There is no "this host is seeded" state any more: whether a starter
    // is present is a property of that starter's documents, not the host.
    const { firestore, templates } = createFakeFirestore({
      starterTemplatesSeedVersion: 99,
    })
    const result = await materializeStarterTemplate(
      firestore as unknown as SeedFirestore, 'host1', FIRST.id,
    )
    expect(result.created).toBe(FIRST.screens.length)
    expect(templates.size).toBe(FIRST.screens.length)
  })
})

describe('starter template documents', () => {
  it('derives ids from the starter and screen keys, not randomness', () => {
    const [starter] = STARTER_TEMPLATES
    const first = buildStarterTemplateDocs(starter).map((entry) => entry.id)
    const second = buildStarterTemplateDocs(starter).map((entry) => entry.id)

    expect(first).toEqual(second)
    expect(first[0]).toBe(
      starterTemplateDocId(starter.id, starter.screens[0].key),
    )
  })

  it('gives every seeded document a distinct id', () => {
    const ids = buildAllStarterTemplateDocs().map((entry) => entry.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the bundle name, blurb and order on `source`', () => {
    const business = STARTER_TEMPLATES.find((entry) => entry.id === 'business')!
    const docs = buildStarterTemplateDocs(business)

    expect(docs).toHaveLength(business.screens.length)
    expect(docs.map((entry) => (entry.data.source as any).starterOrder)).toEqual(
      business.screens.map((_, index) => index),
    )
    for (const entry of docs) {
      expect(entry.data.source).toMatchObject({
        starterName: business.displayName,
        starterDescription: business.description,
      })
      expect(entry.data.category).toBe(business.category)
    }
  })

  // A template's description is carried onto the page it creates, and a
  // screen description is the live site's meta-description fallback — the
  // starter blurb must not leak there.
  it('never puts the starter blurb in a template description', () => {
    for (const starter of STARTER_TEMPLATES) {
      for (const entry of buildStarterTemplateDocs(starter)) {
        expect(entry.data.description).not.toBe(starter.description)
      }
    }
  })
})
