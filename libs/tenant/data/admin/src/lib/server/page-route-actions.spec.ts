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

import { SERVER_TIMESTAMP, settingsFirestoreDouble } from '../testing/settings-firestore-double'
import {
  applyPageRouteAction,
  applyPageUpdate,
  settlePageRouteCache,
  type PageRouteActionInput,
  type PageUpdateInput,
} from './page-route-actions'

const HOST = 'hosts/host-1'
const person = { uid: 'u1', email: 'owner@example.com' }

function site(screens: Record<string, Record<string, unknown>>, host: Record<string, unknown> = {}) {
  return settingsFirestoreDouble({
    [HOST]: host,
    ...Object.fromEntries(Object.entries(screens).map(([id, data]) => [`${HOST}/screens/${id}`, data])),
  })
}

const run = (double: ReturnType<typeof site>, input: Omit<PageRouteActionInput, 'hostId' | 'actor'>) =>
  applyPageRouteAction(double.firestore, { hostId: 'host-1', actor: person, ...input })

const activity = (double: ReturnType<typeof site>) =>
  [...double.docs.entries()].filter(([path]) => path.startsWith(`${HOST}/activity/`)).map(([, row]) => row)

describe('applyPageRouteAction · publish (AGL-4235)', () => {
  it('routes the page, stamps it, stages the outbox entry and the activity row in one batch', async () => {
    const double = site({ about: { displayName: 'About', kind: 'page' } }, { screens: {} })
    const result = await run(double, { action: 'publish', pageId: 'about', slug: 'About Us' })
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        answer: { ok: true, path: '/about-us' },
        entries: { about: 'about-us' },
        livePaths: ['/about-us'],
        outboxId: expect.any(String),
      }),
    )
    expect(double.read(HOST)?.['screens']).toEqual({ about: 'about-us' })
    expect(double.read(`${HOST}/screens/about`)).toEqual(expect.objectContaining({ slug: 'about-us', publishedAt: expect.anything() }))
    expect(double.outbox().map(([, entry]) => entry)).toEqual([
      { hostId: 'host-1', paths: ['/about-us'], createdAt: SERVER_TIMESTAMP, attempts: 0 },
    ])
    expect(activity(double)).toEqual([
      expect.objectContaining({
        actorId: 'u1',
        actorEmail: 'owner@example.com',
        action: 'Published route /about-us',
        target: { type: 'screen', id: 'about', name: 'About' },
      }),
    ])
  })

  it('names the key that wrote it, for a write the API made', async () => {
    const double = site({ about: { kind: 'page' } }, { screens: {} })
    await applyPageRouteAction(double.firestore, {
      hostId: 'host-1',
      action: 'publish',
      pageId: 'about',
      slug: 'about',
      actor: { uid: 'api', apiKeyName: 'Sync' },
    })
    expect(activity(double)).toEqual([expect.objectContaining({ actorId: 'api', actorEmail: null, apiKeyName: 'Sync' })])
  })

  it('releases the placeholder home page when another page takes the root', async () => {
    const double = site({ home: { kind: 'page', publishedAt: 1 }, landing: { kind: 'page' } }, { screens: { home: '/' }, defaultHomeScreenId: 'home' })
    const result = await run(double, { action: 'publish', pageId: 'landing', slug: '/' })
    expect(result).toEqual(expect.objectContaining({ ok: true, answer: { ok: true, path: '/' } }))
    expect(double.read(HOST)).toEqual({ screens: { landing: '/' } })
    expect(double.read(`${HOST}/screens/home`)).not.toHaveProperty('publishedAt')
  })

  it('refuses a group, a path separator, an empty slug, a reserved address and another owner, writing nothing', async () => {
    const screens = { about: { kind: 'page' }, team: { kind: 'group' }, other: { kind: 'page' } }
    const cases: Array<[Omit<PageRouteActionInput, 'hostId' | 'actor'>, number, RegExp]> = [
      [{ action: 'publish', pageId: 'team', slug: 'team' }, 400, /group has no address/],
      [{ action: 'publish', pageId: 'about', slug: 'a/b' }, 400, /./],
      [{ action: 'publish', pageId: 'about', slug: '' }, 400, /Enter a slug/],
      [{ action: 'publish', pageId: 'about', slug: 'api' }, 400, /./],
      [{ action: 'publish', pageId: 'about', slug: 'taken' }, 409, /already published at \/taken/],
      [{ action: 'publish', pageId: 'missing', slug: 'x' }, 404, /not found/],
    ]
    for (const [input, status, error] of cases) {
      const double = site(screens, { screens: { other: 'taken' } })
      const result = await run(double, input)
      expect({ input, result }).toEqual({ input, result: { ok: false, status, error: expect.stringMatching(error) } })
      expect(double.writes).toEqual([])
    }
  })

  it('cascade re-addresses the attached live pages below, as the page editor does', async () => {
    const screens = {
      company: { kind: 'page', slug: 'company' },
      about: { kind: 'page', slug: 'about', parentId: 'company' },
    }
    const map = { company: 'company', about: 'company/about' }
    const plain = site(screens, { screens: map })
    expect(await run(plain, { action: 'publish', pageId: 'company', slug: 'team' })).toEqual(
      expect.objectContaining({ ok: true, entries: { company: 'team' } }),
    )
    const cascaded = site(screens, { screens: map })
    expect(await run(cascaded, { action: 'publish', pageId: 'company', slug: 'team', cascade: true })).toEqual(
      expect.objectContaining({
        ok: true,
        entries: { company: 'team', about: 'team/about' },
        livePaths: expect.arrayContaining(['/company', '/team', '/company/about', '/team/about']),
      }),
    )
    expect(cascaded.read(HOST)?.['screens']).toEqual({ company: 'team', about: 'team/about' })
  })

  it('cascade checks every entry it would write against the other pages', async () => {
    const double = site(
      {
        company: { kind: 'page', slug: 'company' },
        about: { kind: 'page', slug: 'about', parentId: 'company' },
        other: { kind: 'page', slug: 'about' },
      },
      { screens: { company: 'company', about: 'company/about', other: 'team/about' } },
    )
    expect(await run(double, { action: 'publish', pageId: 'company', slug: 'team', cascade: true })).toEqual({
      ok: false,
      status: 409,
      error: 'Another page is already published at /team/about',
    })
    expect(double.writes).toEqual([])
  })
})

describe('applyPageRouteAction · unpublish, delete, move, delete-group (AGL-4235)', () => {
  it('unpublishes and deletes a page by its one entry, announcing its old address', async () => {
    for (const action of ['unpublish', 'delete'] as const) {
      const double = site({ about: { kind: 'page', publishedAt: 1 } }, { screens: { about: 'about' } })
      const result = await run(double, { action, pageId: 'about' })
      expect(result).toEqual(expect.objectContaining({ ok: true, answer: { ok: true }, entries: { about: null }, livePaths: ['/about'] }))
      expect(double.read(HOST)?.['screens']).toEqual({})
      expect(Boolean(double.read(`${HOST}/screens/about`)?.['deletedAt'])).toBe(action === 'delete')
      expect(activity(double)).toEqual([
        expect.objectContaining({ action: action === 'delete' ? 'Deleted screen' : 'Unpublished screen' }),
      ])
    }
  })

  it('moves a page and its live address, orders the siblings, and refuses a cycle', async () => {
    const screens = {
      company: { kind: 'page', slug: 'company', order: 0 },
      about: { kind: 'page', slug: 'about', order: 1 },
    }
    const double = site(screens, { screens: { company: 'company', about: 'about' } })
    const result = await run(double, { action: 'move', pageId: 'about', parentId: 'company', index: 0 })
    expect(result).toEqual(expect.objectContaining({ ok: true, answer: { ok: true, moved: 1 }, entries: { about: 'company/about' } }))
    expect(double.read(`${HOST}/screens/about`)).toEqual(expect.objectContaining({ parentId: 'company', order: 0 }))
    expect(activity(double)).toEqual([])

    const cycle = site({ ...screens, about: { ...screens.about, parentId: 'company' } }, { screens: {} })
    expect(await run(cycle, { action: 'move', pageId: 'company', parentId: 'about' })).toEqual({
      ok: false,
      status: 409,
      error: 'A page cannot move inside itself',
    })
  })

  it('dissolves a group without changing a live address', async () => {
    const double = site({ team: { kind: 'group' }, about: { kind: 'page', slug: 'about', parentId: 'team' } }, { screens: { about: 'about' } })
    expect(await run(double, { action: 'delete-group', pageId: 'team' })).toEqual(
      expect.objectContaining({ ok: true, entries: {}, livePaths: [], outboxId: null }),
    )
    expect(double.read(`${HOST}/screens/about`)).not.toHaveProperty('parentId')
    expect(activity(double)).toEqual([expect.objectContaining({ action: 'Deleted group', target: { type: 'group', id: 'team' } })])
  })
})

describe('settlePageRouteCache (AGL-4235)', () => {
  it('drops the changed addresses and releases the entry only when the drop landed', async () => {
    const double = settingsFirestoreDouble({ 'publishOutbox/e1': { hostId: 'host-1' } })
    const failed = jest.fn(async () => ({ dropped: 0, skipped: 1, complete: false }))
    expect(await settlePageRouteCache(double.firestore, { hostId: 'host-1', livePaths: ['/a'], outboxId: 'e1' }, { dropCache: failed })).toBe(false)
    expect(double.read('publishOutbox/e1')).toBeDefined()
    const dropCache = jest.fn(async () => ({ dropped: 1, skipped: 0, complete: true }))
    expect(await settlePageRouteCache(double.firestore, { hostId: 'host-1', livePaths: ['/a', '/b'], outboxId: 'e1' }, { dropCache })).toBe(true)
    expect(dropCache).toHaveBeenCalledWith(expect.objectContaining({ hostIds: ['host-1'], paths: { 'host-1': ['/a', '/b'] } }))
    expect(double.read('publishOutbox/e1')).toBeUndefined()
  })

  it('owes nothing when nothing live changed', async () => {
    const dropCache = jest.fn()
    expect(await settlePageRouteCache(settingsFirestoreDouble().firestore, { hostId: 'host-1', livePaths: [], outboxId: null }, { dropCache })).toBe(false)
    expect(dropCache).not.toHaveBeenCalled()
  })
})

describe('applyPageUpdate (AGL-4235)', () => {
  const update = (double: ReturnType<typeof site>, input: Omit<PageUpdateInput, 'hostId' | 'actor'>) =>
    applyPageUpdate(double.firestore, { hostId: 'host-1', actor: person, ...input })
  /** A published `company` with a live child and an unpublished child, an unpublished draft, a folder and a held address. */
  const tree = () =>
    site(
      {
        company: { kind: 'page', displayName: 'Company', slug: 'company', order: 0 },
        about: { kind: 'page', displayName: 'About', slug: 'about', parentId: 'company', order: 0, publishedAt: 'then' },
        careers: { kind: 'page', displayName: 'Careers', slug: 'careers', parentId: 'company', order: 1 },
        draft: { kind: 'page', displayName: 'Draft', slug: 'draft', order: 1 },
        team: { kind: 'group', displayName: 'Team', order: 2 },
        pricing: { kind: 'page', displayName: 'Pricing', slug: 'pricing', order: 3 },
        newsletter: { kind: 'email', displayName: 'Newsletter' },
        post: { kind: 'template', displayName: 'Post' },
        missing: { kind: 'error', displayName: 'Not found' },
      },
      { screens: { company: 'company', about: 'company/about', pricing: 'pricing' } },
    )

  it('renames a page as the details card does, with its activity row, announcing a published one at its address', async () => {
    const double = tree()
    const result = await update(double, { pageId: 'company', details: { displayName: ' Our company ', description: ' Who ' } })
    expect(result).toEqual(
      expect.objectContaining({ ok: true, entries: {}, livePaths: ['/company'], announced: true, impact: { published: true, readdresses: false } }),
    )
    expect(double.read(`${HOST}/screens/company`)).toEqual(
      expect.objectContaining({ displayName: 'Our company', description: 'Who', nameLower: 'our company', updatedAt: expect.anything() }),
    )
    expect(double.outbox().map(([, entry]) => entry)).toEqual([
      { hostId: 'host-1', paths: ['/company'], createdAt: SERVER_TIMESTAMP, attempts: 0 },
    ])
    expect(activity(double)).toEqual([
      expect.objectContaining({ action: 'Updated screen details', target: { type: 'screen', id: 'company', name: 'Our company' } }),
    ])
  })

  it('announces nothing for an unpublished page, and renames a folder with no row', async () => {
    const double = tree()
    expect(await update(double, { pageId: 'draft', details: { displayName: 'Soon' } })).toEqual(
      expect.objectContaining({ ok: true, livePaths: [], outboxId: null, announced: false }),
    )
    expect(await update(double, { pageId: 'team', details: { displayName: 'People' } })).toEqual(
      expect.objectContaining({ ok: true, livePaths: [], announced: false }),
    )
    expect(double.read(`${HOST}/screens/team`)?.['displayName']).toBe('People')
    expect(activity(double)).toHaveLength(1)
    expect(await update(double, { pageId: 'team', details: { description: 'x' } })).toEqual(
      expect.objectContaining({ ok: false, status: 400, field: 'description' }),
    )
  })

  it('stores an unpublished page’s new slug and routes nothing', async () => {
    const double = tree()
    const result = await update(double, { pageId: 'draft', slug: 'Coming Soon' })
    expect(result).toEqual(expect.objectContaining({ ok: true, entries: {}, impact: { published: false, readdresses: false } }))
    expect(double.read(`${HOST}/screens/draft`)?.['slug']).toBe('coming-soon')
    expect(double.read(HOST)?.['screens']).toEqual({ company: 'company', about: 'company/about', pricing: 'pricing' })
  })

  it('re-addresses a published page and its live descendants, leaving publishedAt alone and drafts unrouted', async () => {
    const double = tree()
    const result = await update(double, { pageId: 'company', slug: 'about-us' })
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        entries: { company: 'about-us', about: 'about-us/about' },
        livePaths: expect.arrayContaining(['/company', '/about-us', '/company/about', '/about-us/about']),
        impact: { published: true, readdresses: true },
      }),
    )
    expect(double.read(HOST)?.['screens']).toEqual({ company: 'about-us', about: 'about-us/about', pricing: 'pricing' })
    expect(double.read(`${HOST}/screens/about`)?.['publishedAt']).toBe('then')
    expect(double.read(`${HOST}/screens/company`)).not.toHaveProperty('publishedAt')
    expect(double.read(HOST)?.['screens']).not.toHaveProperty('careers')
    expect(activity(double)).toEqual([])
  })

  it('refuses the whole change, writing nothing, when any changed address is taken or reserved', async () => {
    const taken = tree()
    expect(await update(taken, { pageId: 'company', slug: 'pricing', details: { displayName: 'X' } })).toEqual(
      expect.objectContaining({ ok: false, status: 409, code: 'address_taken', field: 'slug' }),
    )
    expect(taken.writes).toEqual([])

    // The page's own address is free; its live child's new one is reserved.
    const reserved = site(
      {
        docs: { kind: 'page', slug: 'docs' },
        search: { kind: 'page', slug: 'search', parentId: 'docs' },
      },
      { screens: { docs: 'docs', search: 'docs/search' } },
    )
    const refused = await update(reserved, { pageId: 'search', parentId: null })
    expect(refused).toEqual(expect.objectContaining({ ok: false, status: 400, field: 'parentId' }))
    expect(reserved.writes).toEqual([])

    for (const [slug, error] of [
      ['a/b', expect.stringContaining('/')],
      ['', 'Enter a slug ("/" for the home page)'],
    ] as const) {
      const double = tree()
      expect(await update(double, { pageId: 'draft', slug })).toEqual(expect.objectContaining({ ok: false, status: 400, field: 'slug', error }))
      expect(double.writes).toEqual([])
    }
  })

  it('moves and reorders as the Pages hub does', async () => {
    const double = tree()
    // Into a folder at the same level: no address changes.
    expect(await update(double, { pageId: 'pricing', parentId: 'team' })).toEqual(
      expect.objectContaining({ ok: true, entries: {}, impact: { published: true, readdresses: false } }),
    )
    expect(double.read(`${HOST}/screens/pricing`)).toEqual(expect.objectContaining({ parentId: 'team', order: 0 }))
    // A reorder where it is.
    expect(await update(double, { pageId: 'team', index: 0 })).toEqual(expect.objectContaining({ ok: true, entries: {} }))
    expect(double.read(`${HOST}/screens/team`)?.['order']).toBe(0)
    expect(double.read(`${HOST}/screens/company`)?.['order']).toBe(1)
    // Out from under its parent: a live address follows.
    expect(await update(double, { pageId: 'about', parentId: null, index: 0 })).toEqual(
      expect.objectContaining({ ok: true, entries: { about: 'about' } }),
    )
    expect(double.read(`${HOST}/screens/about`)).not.toHaveProperty('parentId')
  })

  it('refuses a move into the page’s own descendant, under what is not a page or folder, or that changes a live address within one level', async () => {
    const double = tree()
    expect(await update(double, { pageId: 'company', parentId: 'about' })).toEqual(
      expect.objectContaining({ ok: false, status: 400, field: 'parentId', error: 'A page cannot move inside itself' }),
    )
    for (const parentId of ['post', 'missing', 'newsletter', 'nothing', 'company-x']) {
      expect(await update(double, { pageId: 'draft', parentId })).toEqual(expect.objectContaining({ ok: false, status: 400, field: 'parentId' }))
    }
    // A page whose slug and published address disagree, moved into a folder at its own level.
    const glued = site(
      { team: { kind: 'group' }, alt: { kind: 'page', slug: 'alternativeswebflow' } },
      { screens: { alt: 'alternatives' } },
    )
    expect(await update(glued, { pageId: 'alt', parentId: 'team' })).toEqual(
      expect.objectContaining({ ok: false, status: 409, code: 'move_refused' }),
    )
    expect(double.writes).toEqual([])
    expect(glued.writes).toEqual([])
  })

  it('answers an email design, an entry template, an error page, a deleted page or no page as not found', async () => {
    const double = tree()
    for (const pageId of ['newsletter', 'post', 'missing', 'nothing']) {
      expect(await update(double, { pageId, details: { displayName: 'X' } })).toEqual({ ok: false, status: 404, error: 'That page was not found' })
    }
    expect(double.writes).toEqual([])
  })

  it('holds the write when the caller does not allow its impact, and writes nothing', async () => {
    const double = tree()
    const allow = jest.fn(() => false)
    expect(await update(double, { pageId: 'company', slug: 'us', allow })).toEqual({
      ok: false,
      held: true,
      impact: { published: true, readdresses: true },
    })
    expect(allow).toHaveBeenCalledWith({ published: true, readdresses: true })
    expect(double.writes).toEqual([])
  })
})
