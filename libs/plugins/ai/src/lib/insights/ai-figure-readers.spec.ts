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

import type { PluginFigureRead, PluginFigureReader, PluginFigureTable } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { AI_SITE_CHANGES_MAX_ROWS, aiFigureReaders, aiSiteChangeKind } from './ai-figure-readers'

/**
 * The readers for the platform's own records (AGL-2915): what each table
 * holds, and that it is aggregates and never a record.
 */

type Data = Record<string, unknown>

/** A Firestore that answers the reads these readers make, from a flat map of document paths. */
function firestoreOf(docs: Record<string, Data>) {
  const snapshot = (path: string) => {
    const data = docs[path]
    return {
      id: path.split('/').pop() as string,
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  }
  const children = (path: string) =>
    Object.keys(docs)
      .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      .sort()
  const collection = (path: string, cap = Infinity, keep: (data: Data) => boolean = () => true): any => ({
    doc: (id: string) => ({
      path: `${path}/${id}`,
      get: async () => snapshot(`${path}/${id}`),
      collection: (name: string) => collection(`${path}/${id}/${name}`),
    }),
    limit: (n: number) => collection(path, n, keep),
    orderBy: () => collection(path, cap, keep),
    where: (field: string, op: '>=' | '<', value: Date) => {
      const inRange = (data: Data) => {
        const at = (data[field] as { toDate: () => Date }).toDate().getTime()
        return op === '>=' ? at >= value.getTime() : at < value.getTime()
      }
      return collection(path, cap, (data) => keep(data) && inRange(data))
    },
    get: async () => ({
      docs: children(path)
        .filter((key) => keep(docs[key]))
        .slice(0, cap)
        .map(snapshot),
    }),
    count: () => ({ get: async () => ({ data: () => ({ count: children(path).length }) }) }),
  })
  return {
    collection,
    getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path)),
  } as unknown as FirebaseFirestore.Firestore
}

const NOW = new Date('2026-09-16T15:00:00.000Z')

const readerOf = (docs: Record<string, Data>, id: string): PluginFigureReader => {
  const reader = aiFigureReaders(() => firestoreOf(docs)).find((entry) => entry.id === id)
  if (!reader) throw new Error(`no reader ${id}`)
  return reader
}

async function tableOf(
  docs: Record<string, Data>,
  id: string,
  request: { hostId?: string | null; days?: number; uid?: string | null; params?: Record<string, string> } = {},
): Promise<PluginFigureTable> {
  const read: PluginFigureRead = await readerOf(docs, id).read({
    orgId: 'org-1',
    hostId: request.hostId === undefined ? 'host-1' : request.hostId,
    days: request.days ?? 7,
    now: NOW,
    uid: request.uid ?? null,
    params: request.params ?? {},
  })
  if (read.ok === false) throw new Error(read.error)
  return read.table
}

const day = (id: string, data: Data) => ({ [`hosts/host-1/analytics/${id}`]: data })

describe('what changed on the site (AGL-4131)', () => {
  const entry = (id: string, iso: string, action: string, target: Data) => ({
    [`hosts/host-1/activity/${id}`]: {
      action,
      target,
      createdAt: { toDate: () => new Date(iso) },
      actorId: 'someone',
      actorEmail: 'someone@example.com',
    },
  })
  const docs = {
    ...entry('a', '2026-09-16T12:00:00Z', 'Published version', { type: 'screen', id: 's1', name: 'Pricing' }),
    ...entry('b', '2026-09-16T09:00:00Z', 'Published the screen', { type: 'screen', id: 's1', name: 'Pricing' }),
    ...entry('c', '2026-09-14T12:00:00Z', 'Saved the screen', { type: 'screen', id: 's1', name: 'Pricing' }),
    ...entry('d', '2026-09-14T11:00:00Z', 'Created product', { type: 'content', id: 'p1', name: 'Blue mug' }),
    ...entry('e', '2026-09-13T11:00:00Z', 'Added contact', { type: 'contact', id: 'c1', name: 'A Person' }),
    ...entry('f', '2026-09-12T11:00:00Z', 'Workflow ran on formSubmission', { type: 'workflow', id: 'w1', name: 'Welcome' }),
    ...entry('g', '2026-09-11T11:00:00Z', 'Updated host settings', { type: 'host', id: 'host-1' }),
    ...entry('h', '2026-09-01T11:00:00Z', 'Published version', { type: 'screen', id: 's2', name: 'Too old' }),
  }

  it('lists what a visitor would see change, one row a target a day', async () => {
    const table = await tableOf(docs, 'traffic.changes')
    expect(table.rows).toEqual([
      { day: '2026-09-16', what: 'Pricing', kind: 'Page published' },
      { day: '2026-09-14', what: 'Blue mug', kind: 'Product added' },
      { day: '2026-09-11', what: 'Site settings changed', kind: 'Site settings changed' },
    ])
    expect(table.omitted).toBe(0)
    expect(table.notes).toEqual([])
  })

  it('never reads who did it', async () => {
    expect(JSON.stringify(await tableOf(docs, 'traffic.changes'))).not.toMatch(/someone/)
  })

  it('says so when nothing changed', async () => {
    const table = await tableOf({}, 'traffic.changes')
    expect(table.rows).toEqual([])
    expect(table.notes.join(' ')).toMatch(/Nothing visitors would see/)
  })

  it('reads a day’s nameless entries of a kind as one row', async () => {
    const table = await tableOf(
      {
        ...entry('a', '2026-09-16T12:00:00Z', 'Created redirect', { type: 'content', id: 'r1' }),
        ...entry('b', '2026-09-16T11:00:00Z', 'Created redirect', { type: 'content', id: 'r2' }),
      },
      'traffic.changes',
    )
    expect(table.rows).toEqual([{ day: '2026-09-16', what: 'Redirect added', kind: 'Redirect added' }])
  })

  it('lets what arrives by the dozen give way first when a week has too many to list', async () => {
    const redirects = Object.assign(
      {},
      ...Array.from({ length: AI_SITE_CHANGES_MAX_ROWS }, (_, index) =>
        entry(`a${String(index).padStart(2, '0')}`, '2026-09-16T12:00:00Z', 'Created redirect', { type: 'content', id: `r${index}`, name: `/old-${index}` }),
      ),
    )
    const table = await tableOf(
      { ...redirects, ...entry('z', '2026-09-11T11:00:00Z', 'Published version', { type: 'screen', id: 's1', name: 'Pricing' }) },
      'traffic.changes',
    )
    expect(table.rows).toHaveLength(AI_SITE_CHANGES_MAX_ROWS)
    expect(table.rows.at(-1)).toEqual({ day: '2026-09-11', what: 'Pricing', kind: 'Page published' })
    expect(table.omitted).toBe(1)
  })

  it('counts what it cannot list', async () => {
    const many = Object.assign(
      {},
      ...Array.from({ length: AI_SITE_CHANGES_MAX_ROWS + 3 }, (_, index) =>
        entry(`e${String(index).padStart(2, '0')}`, '2026-09-16T12:00:00Z', 'Created redirect', { type: 'content', id: `r${index}`, name: `/old-${index}` }),
      ),
    )
    const table = await tableOf(many, 'traffic.changes')
    expect(table.rows).toHaveLength(AI_SITE_CHANGES_MAX_ROWS)
    expect(table.omitted).toBe(3)
  })

  it('answers only for what it was told about, so a new kind of entry stays out', () => {
    expect(aiSiteChangeKind('Published entry', 'content')).toBe('Entry published')
    expect(aiSiteChangeKind('Saved the component', 'component')).toBe('Component changed')
    expect(aiSiteChangeKind('Saved the layout', 'layout')).toBe('Shared layout changed')
    expect(aiSiteChangeKind('Unpublished screen', 'screen')).toBeNull()
    expect(aiSiteChangeKind('Created entry', 'content')).toBeNull()
    expect(aiSiteChangeKind('Anything', 'contact')).toBeNull()
    expect(aiSiteChangeKind(undefined, undefined)).toBeNull()
  })
})

describe('traffic', () => {
  const docs = {
    // The window: Sep 10 to 16. A referring host is stored as the collector
    // writes it, its dots as `_`.
    ...day('2026-09-16', { total: 40, visitors: 20, paths: { '/pricing': 30, '/': 10 }, referrers: { google_com: 12 }, utm: { source: { newsletter: 5 } } }),
    ...day('2026-09-12', { total: 60, visitors: 25, paths: { '/pricing': 20, '/': 40 }, referrers: { google_com: 8, bing_com: 2 } }),
    // The week before: Sep 3 to 9.
    ...day('2026-09-05', { total: 80, visitors: 50, paths: { '/pricing': 10, '/': 70 } }),
  }

  it('sums the window and the one before it, with the Traffic card’s change', async () => {
    const table = await tableOf(docs, 'traffic.summary')
    expect(table.period).toEqual({ from: '2026-09-10', to: '2026-09-16', days: 7 })
    expect(table.rows).toEqual([
      { figure: 'Page views', current: 100, previous: 80, change: 25 },
      { figure: 'Visitors', current: 45, previous: 50, change: -10 },
      { figure: 'Page views a day', current: 14, previous: 11, change: 27.3 },
    ])
    expect(table.source).toEqual({ label: 'Analytics', path: 'analytics' })
  })

  it('reads no change where the window before recorded nothing, and says so', async () => {
    const table = await tableOf({ ...day('2026-09-16', { total: 5, visitors: 5 }) }, 'traffic.summary')
    expect(table.rows[0]).toEqual({ figure: 'Page views', current: 5, previous: 0, change: null })
    expect(table.notes.join(' ')).toMatch(/no change to compare/)
  })

  it('ranks pages by views with their share and change', async () => {
    const table = await tableOf(docs, 'traffic.pages')
    // Two pages with the same views are ranked by their path.
    expect(table.rows).toEqual([
      { page: '/', views: 50, share: 50, change: -28.6, rank: 1, rankBefore: 1 },
      { page: '/pricing', views: 50, share: 50, change: 400, rank: 2, rankBefore: 2 },
    ])
  })

  it('says each page’s rank the window before, and none for a page new to the list', async () => {
    const table = await tableOf(
      {
        ...day('2026-09-16', { total: 90, visitors: 20, paths: { '/new': 60, '/pricing': 30, '/': 5 } }),
        ...day('2026-09-05', { total: 80, visitors: 50, paths: { '/': 70, '/pricing': 10 } }),
      },
      'traffic.pages',
    )
    expect(table.rows.map((row) => [row['page'], row['rank'], row['rankBefore']])).toEqual([
      ['/new', 1, null],
      ['/pricing', 2, 2],
      ['/', 3, 1],
    ])
  })

  it('names where visits came from — referring sites as hosts again, and campaign tags', async () => {
    const table = await tableOf(docs, 'traffic.sources')
    expect(table.rows).toEqual([
      { source: 'google.com', type: 'Referring site', views: 20, share: 20, change: null },
      { source: 'bing.com', type: 'Referring site', views: 2, share: 2, change: null },
      { source: 'newsletter', type: 'Campaign source', views: 5, share: 5, change: null },
    ])
  })

  it('compares each source with the window before', async () => {
    const table = await tableOf(
      {
        ...day('2026-09-16', { total: 30, visitors: 20, referrers: { google_com: 30 }, utm: { source: { newsletter: 8 } } }),
        ...day('2026-09-05', { total: 12, visitors: 10, referrers: { google_com: 10 }, utm: { source: { newsletter: 16 } } }),
      },
      'traffic.sources',
    )
    expect(table.rows.map((row) => [row['source'], row['change']])).toEqual([
      ['google.com', 200],
      ['newsletter', -50],
    ])
  })

  it('lists each day of a short window, oldest first, and no longer one', async () => {
    const table = await tableOf(docs, 'traffic.daily')
    expect(table.rows.map((row) => row['day'])).toEqual([
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
    ])
    expect(table.rows[2]).toEqual({ day: '2026-09-12', views: 60, visitors: 25 })
    const refused = await readerOf(docs, 'traffic.daily').read({
      orgId: 'org-1',
      hostId: 'host-1',
      days: 30,
      now: NOW,
      uid: null,
      params: {},
    })
    expect(refused.ok).toBe(false)
  })
})

describe('forms', () => {
  it('reads each form’s counters over the months the window falls in, and leaves a deleted form out', async () => {
    const docs = {
      'hosts/host-1/forms/quote': {
        displayName: 'Quote request',
        stats: {
          views: 900,
          submissions: 90,
          periods: { '2026-08': { views: 500, submissions: 40 }, '2026-09': { views: 200, submissions: 30, leads: 12 } },
        },
      },
      'hosts/host-1/forms/news': { displayName: 'Newsletter', stats: { periods: { '2026-09': { views: 100, submissions: 5 } } } },
      'hosts/host-1/forms/old': { displayName: 'Old', deletedAt: 1, stats: { periods: { '2026-09': { submissions: 99 } } } },
    }
    const table = await tableOf(docs, 'forms.performance')
    expect(table.rows).toEqual([
      { form: 'Quote request', views: 200, submissions: 30, completion: 15, leads: 12 },
      { form: 'Newsletter', views: 100, submissions: 5, completion: 5, leads: null },
    ])
    expect(table.period).toEqual({ from: '2026-09-01', to: '2026-09-16', days: 16 })
  })

  it('reads a form with no submissions as 0, never a blank (AGL-3834)', async () => {
    const docs = {
      // Copper Kettle Catering, 2026-10-15: viewed twice, never submitted.
      'hosts/host-1/forms/inquiry': {
        displayName: 'Catering inquiry form',
        routing: { lead: true },
        stats: { periods: { '2026-09': { views: 2 } } },
      },
      'hosts/host-1/forms/fresh': { displayName: 'New form' },
    }
    const table = await tableOf(docs, 'forms.performance')
    expect(table.rows).toEqual([
      { form: 'Catering inquiry form', views: 2, submissions: 0, completion: 0, leads: 0 },
      // Nothing recorded at all: still 0 submissions; no views to rate, and
      // no leads measured on a form that does not route them.
      { form: 'New form', views: null, submissions: 0, completion: null, leads: null },
    ])
    expect(table.notes).toContain('A blank Leads figure means the form does not add its submissions to Leads.')
  })
})
