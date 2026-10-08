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
 * A site's posts written on a member's behalf (AGL-3676), against an Admin
 * SDK double that honors transactions, batches, counts and `in` queries:
 *
 *  - THE COLLECTION claims the first free slug of its kind, under the cap,
 *    for a member who may write the site, once under its id.
 *  - AN ENTRY keeps the resources route's allow-list, takes a free slug, and
 *    is born a draft with its title's search keys, once under its id.
 *  - PUBLISHING needs the publish role and a byline.
 */

import { COLLECTIONS_MAX_PER_HOST } from '@aglyn/aglyn/app-utils/collection-entries'
import {
  CONTENT_COLLECTIONS_FULL_REFUSAL,
  CONTENT_DRAFT_ROLE_REFUSAL,
  CONTENT_PUBLISH_NO_BYLINE,
  CONTENT_PUBLISH_ROLE_REFUSAL,
  contentEntrySlug,
  publishContentEntries,
  writeContentCollection,
  writeContentEntryDraft,
} from './content-entry-drafts'

const NOW = new Date('2026-10-07T20:00:00.000Z')

const store = new Map<string, Record<string, unknown>>()

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? data[field] : undefined),
  }
}

const childrenOf = (path: string) =>
  [...store.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))

function docRef(path: string): Record<string, unknown> {
  return {
    kind: 'doc',
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
  }
}

function queryOf(path: string, filters: Array<[string, string, unknown]>): Record<string, unknown> {
  return {
    kind: 'query',
    where: (field: string, op: string, value: unknown) => queryOf(path, [...filters, [field, op, value]]),
    get: async () => ({
      docs: childrenOf(path)
        .map(snapshotOf)
        .filter((doc) =>
          filters.every(([field, op, value]) =>
            op === 'in' ? (value as unknown[]).includes(doc.get(field)) : doc.get(field) === value,
          ),
        ),
    }),
  }
}

function collectionRef(path: string): Record<string, unknown> {
  return {
    path,
    doc: (id: string) => docRef(`${path}/${id}`),
    count: () => ({ kind: 'count', get: async () => ({ data: () => ({ count: childrenOf(path).length }) }) }),
    where: (field: string, op: string, value: unknown) => queryOf(path, [[field, op, value]]),
  }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  batch: () => {
    const sets: Array<[string, Record<string, unknown>]> = []
    return {
      set: (ref: { path: string }, data: Record<string, unknown>) => sets.push([ref.path, data]),
      commit: async () => {
        for (const [path, data] of sets) store.set(path, { ...(store.get(path) ?? {}), ...data })
      },
    }
  },
  runTransaction: async (body: (tx: unknown) => Promise<unknown>) => {
    const creates: Array<[string, Record<string, unknown>]> = []
    const result = await body({
      get: async (target: { kind: string; path: string; get: () => Promise<unknown> }) =>
        target.kind === 'doc' ? snapshotOf(target.path) : target.get(),
      create: (ref: { path: string }, data: Record<string, unknown>) => creates.push([ref.path, data]),
    })
    for (const [path, data] of creates) {
      if (store.has(path)) throw new Error(`6 ALREADY_EXISTS: ${path}`)
      store.set(path, data)
    }
    return result
  },
} as unknown as FirebaseFirestore.Firestore

const HOST = 'hosts/h1'
const collection = (slugs: string[] = ['blog', 'posts'], uid = 'owner') =>
  writeContentCollection(firestore, { hostId: 'h1', uid, id: 'c1', displayName: 'Blog', slugs, now: NOW })
const entry = (id: string, content: Record<string, unknown>, uid = 'owner') =>
  writeContentEntryDraft(firestore, { hostId: 'h1', collectionId: 'c1', uid, id, content, now: NOW })

beforeEach(() => {
  store.clear()
  store.set(HOST, { memberRoles: { owner: 'admin', viewer: 'viewer', author: 'author' } })
})

describe('the collection a site’s posts go in', () => {
  it('claims the first slug no content collection holds — a catalog’s slug is another address — once under its id', async () => {
    store.set(`${HOST}/collections/old`, { kind: 'content', slug: 'blog' })
    store.set(`${HOST}/collections/shop`, { kind: 'catalog', slug: 'posts' })
    await expect(collection()).resolves.toEqual({ ok: true, replayed: false, id: 'c1', slug: 'posts', displayName: 'Blog' })
    expect(store.get(`${HOST}/collections/c1`)).toEqual({ displayName: 'Blog', slug: 'posts', kind: 'content', createdAt: NOW })
    await expect(collection(['journal'])).resolves.toMatchObject({ ok: true, replayed: true, slug: 'posts' })
  })

  it('is refused for a member who may not write the site, at the cap, and when every slug is taken', async () => {
    await expect(collection(['blog'], 'viewer')).resolves.toEqual({ ok: false, status: 403, error: CONTENT_DRAFT_ROLE_REFUSAL })
    store.set(`${HOST}/collections/old`, { kind: 'content', slug: 'blog' })
    await expect(collection(['blog'])).resolves.toMatchObject({ ok: false, status: 409 })
    for (let index = 1; index < COLLECTIONS_MAX_PER_HOST; index += 1) {
      store.set(`${HOST}/collections/x${index}`, { kind: 'content', slug: `x${index}` })
    }
    await expect(collection(['fresh'])).resolves.toEqual({ ok: false, status: 403, error: CONTENT_COLLECTIONS_FULL_REFUSAL })
    expect(store.has(`${HOST}/collections/c1`)).toBe(false)
  })
})

describe('a post, written as a draft', () => {
  beforeEach(async () => {
    await collection()
  })

  it('keeps the allow-list, takes a free slug from its title, and is born a draft with its search keys', async () => {
    store.set(`${HOST}/collections/c1/entries/old`, { slug: 'first-steps-in-clay', title: 'First steps in clay' })
    const written = await entry('e1', {
      title: '  First steps in clay ',
      excerpt: 'Where to begin.',
      body: '## Start small\n\nA short paragraph.',
      authorName: 'Clay Studio',
      coverImage: '/_static/starter/desk.jpg',
      status: 'published',
      publishedAt: NOW,
      createdBy: 'someone-else',
    })
    expect(written).toEqual({ ok: true, replayed: false, id: 'e1', slug: 'first-steps-in-clay-2', title: 'First steps in clay' })
    const stored = store.get(`${HOST}/collections/c1/entries/e1`) as Record<string, unknown>
    expect(stored).toMatchObject({
      title: 'First steps in clay',
      slug: 'first-steps-in-clay-2',
      excerpt: 'Where to begin.',
      authorName: 'Clay Studio',
      status: 'draft',
      createdBy: 'owner',
      createdAt: NOW,
    })
    expect(stored['publishedAt']).toBeUndefined()
    expect(stored['titleTokens']).toEqual(expect.arrayContaining(['clay']))
    await expect(entry('e1', { title: 'Another' })).resolves.toMatchObject({ ok: true, replayed: true, slug: 'first-steps-in-clay-2' })
  })

  it('is refused without a title, for a member who may not write, and under a collection that is not content', async () => {
    await expect(entry('e2', { title: ' ' })).resolves.toMatchObject({ ok: false, status: 400 })
    await expect(entry('e2', { title: 'Hi' }, 'viewer')).resolves.toEqual({ ok: false, status: 403, error: CONTENT_DRAFT_ROLE_REFUSAL })
    store.set(`${HOST}/collections/c1`, { kind: 'catalog', slug: 'blog' })
    await expect(entry('e2', { title: 'Hi' })).resolves.toMatchObject({ ok: false, status: 404 })
  })

  it('mints a slug from any title', () => {
    expect(contentEntrySlug('Crème brûlée, the right way!')).toBe('creme-brulee-the-right-way')
    expect(contentEntrySlug('!!!')).toBe('post')
    expect(contentEntrySlug('a'.repeat(200)).length).toBe(80)
  })
})

describe('publishing a site’s posts', () => {
  beforeEach(async () => {
    await collection()
    await entry('e1', { title: 'One', authorName: 'Clay Studio' })
    await entry('e2', { title: 'Two' })
  })

  it('publishes an entry with a byline, keeps one without, and reports a gone one', async () => {
    const result = await publishContentEntries(firestore, { hostId: 'h1', collectionId: 'c1', uid: 'owner', ids: ['e1', 'e2', 'e3'], now: NOW })
    expect(result).toEqual({
      published: ['e1'],
      kept: [
        { id: 'e2', reason: CONTENT_PUBLISH_NO_BYLINE },
        { id: 'e3', reason: expect.any(String) },
      ],
    })
    expect(store.get(`${HOST}/collections/c1/entries/e1`)).toMatchObject({ status: 'published', publishedAt: NOW })
    expect(store.get(`${HOST}/collections/c1/entries/e2`)).toMatchObject({ status: 'draft' })
  })

  it('is refused for a member who may write but not publish', async () => {
    await expect(
      publishContentEntries(firestore, { hostId: 'h1', collectionId: 'c1', uid: 'author', ids: ['e1'], now: NOW }),
    ).resolves.toEqual({ ok: false, status: 403, error: CONTENT_PUBLISH_ROLE_REFUSAL })
  })
})
