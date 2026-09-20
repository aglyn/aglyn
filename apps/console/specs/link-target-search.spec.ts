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
 * What a link picker's entry lookup actually READS (AGL-3119).
 *
 * The owner's condition on entry links was that they cost few reads, so what
 * is pinned here is the query — its shape, its ceiling, and the normalization
 * that makes a typed word match a stored slug — rather than the rendering,
 * which `screen-link-field.component.spec.tsx` drives.
 *
 * Firestore is mocked as a recorder: every constraint is kept as data, so a
 * query that grew a second `orderBy` (and with it a composite index this
 * repo would have to deploy before the code that needs it) fails here.
 */

interface Recorded {
  path: string
  constraints: Array<Record<string, unknown>>
}

const reads: Recorded[] = []
const docReads: string[] = []
/** Documents by collection id, in the order a query would walk them. */
const stored: Record<
  string,
  Array<{ id: string; data: Record<string, unknown> }>
> = {}

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  doc: (parent: { path: string }, id: string) => ({
    path: `${parent.path}/${id}`,
  }),
  query: (base: { path: string }, ...constraints: Array<Record<string, unknown>>) => ({
    path: base.path,
    constraints,
  }),
  orderBy: (field: string, direction = 'asc') => ({
    type: 'orderBy',
    field,
    direction,
  }),
  startAt: (value: string) => ({ type: 'startAt', value }),
  endAt: (value: string) => ({ type: 'endAt', value }),
  where: (field: string) => ({ type: 'where', field }),
  limit: (count: number) => ({ type: 'limit', count }),
  getDocs: async (recorded: Recorded) => {
    reads.push(recorded)
    const collectionId = recorded.path.split('/')[3] ?? ''
    const rows = stored[collectionId] ?? []
    const max =
      (recorded.constraints.find((c) => c['type'] === 'limit')?.[
        'count'
      ] as number) ?? rows.length
    const prefix = recorded.constraints.find((c) => c['type'] === 'startAt')?.[
      'value'
    ] as string | undefined
    const matched = prefix
      ? rows.filter((row) => String(row.data['slug'] ?? '').startsWith(prefix))
      : rows
    return { docs: matched.slice(0, max).map((row) => ({ id: row.id, data: () => row.data })) }
  },
  getDoc: async (ref: { path: string }) => {
    docReads.push(ref.path)
    const [, , , collectionId, , entryId] = ref.path.split('/')
    const row = (stored[collectionId ?? ''] ?? []).find(
      (candidate) => candidate.id === entryId,
    )
    return { exists: () => Boolean(row), data: () => row?.data }
  },
}))

const {
  createLinkTargetSearch,
  linkTargetSearchSlug,
  LINK_TARGET_COLLECTION_CAP,
  LINK_TARGET_ENTRIES_PER_COLLECTION,
} = require('../components/link-target-search-provider.component')

const COLLECTIONS = {
  blog: { slug: 'blog', name: 'Blog' },
}

const search = (
  collections: Record<string, { slug: string; name: string }> = COLLECTIONS,
) =>
  createLinkTargetSearch({
    firestore: {} as never,
    hostId: 'host-1',
    collections,
  })

const constraintOf = (recorded: Recorded, type: string) =>
  recorded.constraints.find((c) => c['type'] === type)

beforeEach(() => {
  reads.length = 0
  docReads.length = 0
  for (const key of Object.keys(stored)) delete stored[key]
  stored['blog'] = [
    {
      id: '9fKqR',
      data: {
        title: 'Hello world',
        slug: 'hello-world',
        status: 'published',
      },
    },
    { id: 'dR4ft', data: { title: 'Half written', slug: 'half-written' } },
    { id: 'nOsLug', data: { title: 'No address yet' } },
  ]
})

describe('what a typed query asks Firestore for', () => {
  it('is one prefix range over `slug`, five deep, per collection', async () => {
    await search().searchEntries('Hello World')
    expect(reads).toHaveLength(1)
    expect(reads[0].path).toBe('hosts/host-1/collections/blog/entries')
    expect(constraintOf(reads[0], 'orderBy')).toEqual({
      type: 'orderBy',
      field: 'slug',
      direction: 'asc',
    })
    expect(constraintOf(reads[0], 'startAt')).toEqual({
      type: 'startAt',
      value: 'hello-world',
    })
    expect(constraintOf(reads[0], 'endAt')).toEqual({
      type: 'endAt',
      value: 'hello-world',
    })
    expect(constraintOf(reads[0], 'limit')).toEqual({
      type: 'limit',
      count: LINK_TARGET_ENTRIES_PER_COLLECTION,
    })
  })

  it('needs no composite index: one ordered field, no filter', async () => {
    // A `where` beside an `orderBy` on another field is a composite index —
    // which a promotion does not deploy, so a picker that needed one would be
    // a FAILED_PRECONDITION in production and green in the emulator.
    await search().searchEntries('hello')
    await search().searchEntries('')
    for (const recorded of reads) {
      expect(recorded.constraints.filter((c) => c['type'] === 'orderBy')).toHaveLength(1)
      expect(recorded.constraints.some((c) => c['type'] === 'where')).toBe(false)
    }
  })

  it('asks for the most recently edited entries when nothing is typed', async () => {
    await search().searchEntries('   ')
    expect(constraintOf(reads[0], 'orderBy')).toEqual({
      type: 'orderBy',
      field: 'updatedAt',
      direction: 'desc',
    })
    expect(constraintOf(reads[0], 'startAt')).toBeUndefined()
  })

  it('normalizes what was typed to the slug rule entries are minted with', () => {
    expect(linkTargetSearchSlug('Hello World')).toBe('hello-world')
    expect(linkTargetSearchSlug('  A/B Testing! ')).toBe('a-b-testing')
    expect(linkTargetSearchSlug('')).toBe('')
  })

  it('caps how many collections one search reaches', async () => {
    const many: Record<string, { slug: string; name: string }> = {}
    for (let index = 0; index < LINK_TARGET_COLLECTION_CAP + 4; index++) {
      many[`c${index}`] = { slug: `c${index}`, name: `Collection ${index}` }
    }
    await search(many).searchEntries('hello')
    expect(reads).toHaveLength(LINK_TARGET_COLLECTION_CAP)
  })

  it('reads a query once, however often the picker asks', async () => {
    const lookup = search()
    await lookup.searchEntries('hello')
    await lookup.searchEntries('Hello')
    expect(reads).toHaveLength(1)
  })

  it('rejects an aborted search rather than answering it', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      search().searchEntries('hello', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(reads).toHaveLength(0)
  })
})

describe('what an entry option carries', () => {
  it('names the entry, its address, its collection and its status', async () => {
    const [option] = await search().searchEntries('hello')
    expect(option).toEqual({
      value: 'entry:blog/9fKqR',
      label: 'Hello world (/blog/hello-world) — Blog entry · published',
      title: 'Hello world',
      collectionName: 'Blog',
      status: 'published',
    })
  })

  it('reads an entry with no stored status as a draft', async () => {
    const [option] = await search().searchEntries('half')
    expect(option.status).toBe('draft')
    expect(option.label).toContain('· draft')
  })

  it('offers no entry that has no address to link to', async () => {
    const found = await search().searchEntries('')
    expect(found.map((option: { value: string }) => option.value)).toEqual([
      'entry:blog/9fKqR',
      'entry:blog/dR4ft',
    ])
  })
})

describe('naming a stored reference', () => {
  it('reads that one entry, and only once', async () => {
    const lookup = search()
    expect(await lookup.describeTarget('entry:blog/9fKqR')).toBe(
      'Hello world (/blog/hello-world) — Blog entry · published',
    )
    await lookup.describeTarget('entry:blog/9fKqR')
    expect(docReads).toEqual([
      'hosts/host-1/collections/blog/entries/9fKqR',
    ])
  })

  it('spends no read for an entry a search already named', async () => {
    const lookup = search()
    await lookup.searchEntries('hello')
    expect(await lookup.describeTarget('entry:blog/9fKqR')).toContain(
      'Hello world',
    )
    expect(docReads).toEqual([])
  })

  it('answers nothing for an entry that is gone', async () => {
    expect(await search().describeTarget('entry:blog/deleted')).toBeUndefined()
  })

  it('names nothing that is not an entry reference', async () => {
    const lookup = search()
    expect(await lookup.describeTarget('collection:blog')).toBeUndefined()
    expect(await lookup.describeTarget('screen:r_RYOXo')).toBeUndefined()
    expect(docReads).toEqual([])
  })
})
