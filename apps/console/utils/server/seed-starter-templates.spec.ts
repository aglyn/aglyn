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
import seedStarterTemplates, {
  STARTER_SEED_MARKER_FIELD,
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

describe('seedStarterTemplates', () => {
  it('seeds one document per starter screen', async () => {
    const fake = createFakeFirestore()
    const result = await seedStarterTemplates(fake.firestore, 'host1')
    const expected = buildAllStarterTemplateDocs().length

    expect(result.created).toBe(expected)
    expect(fake.templates.size).toBe(expected)
    expect(fake.hosts.get('host1')?.[STARTER_SEED_MARKER_FIELD]).toBe(1)
  })

  it('stamps starter provenance the rules freeze', async () => {
    const fake = createFakeFirestore()
    await seedStarterTemplates(fake.firestore, 'host1')
    const landing = fake.templates.get(starterTemplateDocId('landing', 'landing'))

    expect(landing).toBeDefined()
    expect((landing as any).kind).toBe('page')
    expect((landing as any).source).toMatchObject({
      type: 'starter',
      starterId: 'landing',
    })
  })

  // The point of the whole exercise: this runs against orgs that already
  // exist, so a second run must reconcile, not duplicate.
  it('is idempotent — running twice leaves one document per starter screen', async () => {
    const fake = createFakeFirestore()
    const first = await seedStarterTemplates(fake.firestore, 'host1')
    const second = await seedStarterTemplates(fake.firestore, 'host1', {
      force: true,
    })

    expect(second.created).toBe(0)
    expect(second.skipped).toBe(first.created)
    expect(fake.templates.size).toBe(first.created)
  })

  it('short-circuits on the marker without re-reading the templates', async () => {
    const fake = createFakeFirestore()
    await seedStarterTemplates(fake.firestore, 'host1')
    const commitsAfterSeed = fake.commits
    const repeat = await seedStarterTemplates(fake.firestore, 'host1')

    expect(repeat.alreadySeeded).toBe(true)
    expect(repeat.created).toBe(0)
    expect(fake.commits).toBe(commitsAfterSeed)
  })

  it('never clobbers a user edit to a previously seeded starter', async () => {
    const fake = createFakeFirestore()
    await seedStarterTemplates(fake.firestore, 'host1')
    const id = starterTemplateDocId('business', 'about-us')
    fake.templates.set(id, {
      ...(fake.templates.get(id) as Record<string, unknown>),
      displayName: 'Our story',
      nodes: { root: { $id: 'root', componentId: 'div', nodes: [] } },
      editedAt: 'yesterday',
    })

    await seedStarterTemplates(fake.firestore, 'host1', { force: true })

    expect(fake.templates.get(id)).toMatchObject({
      displayName: 'Our story',
      editedAt: 'yesterday',
    })
    expect(Object.keys((fake.templates.get(id) as any).nodes)).toEqual(['root'])
  })

  it('does not resurrect a starter the user deleted', async () => {
    const fake = createFakeFirestore()
    await seedStarterTemplates(fake.firestore, 'host1')
    const id = starterTemplateDocId('portfolio', 'portfolio')
    fake.templates.set(id, {
      ...(fake.templates.get(id) as Record<string, unknown>),
      deletedAt: 'yesterday',
    })

    await seedStarterTemplates(fake.firestore, 'host1', { force: true })

    expect((fake.templates.get(id) as any).deletedAt).toBe('yesterday')
  })

  it('fills in only the documents that are missing', async () => {
    const fake = createFakeFirestore()
    await seedStarterTemplates(fake.firestore, 'host1')
    const id = starterTemplateDocId('landing', 'landing')
    fake.templates.delete(id)

    const result = await seedStarterTemplates(fake.firestore, 'host1', {
      force: true,
    })

    expect(result.created).toBe(1)
    expect(fake.templates.has(id)).toBe(true)
  })

  it('does nothing for an unknown host', async () => {
    const fake = createFakeFirestore(null)
    const result = await seedStarterTemplates(fake.firestore, 'host1')

    expect(result).toEqual({ created: 0, skipped: 0, alreadySeeded: false })
    expect(fake.templates.size).toBe(0)
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
