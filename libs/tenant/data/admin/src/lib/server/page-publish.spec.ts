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

import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { NODE_MAP_MAX_BYTES } from '@aglyn/aglyn/app-utils/measure-node-map'
import { SERVER_TIMESTAMP, settingsFirestoreDouble } from '../testing/settings-firestore-double'
import { clearCoeditMirror } from './coedit-mirror'
import {
  commitPagePublish,
  commitPagePublishes,
  precheckPagePublish,
  precheckPagePublishes,
  readPagePublishBody,
  type PagePublishPlan,
} from './page-publish'

/*
 * AGL-4235: one page's draft goes live from the server, as the page editor's
 * Publish puts it live. Every case asserts what was STORED, not only what was
 * answered: a publish that answers `published` and writes nothing, or writes
 * the wrong thing, is the bug this exists to catch.
 */

const HOST = 'hosts/host-1'
const page = (id: string) => `${HOST}/screens/${id}`
const version = (id: string, v = 'v1') => `${page(id)}/versions/${v}`
const draft = (id: string, v = 'v1') => `${version(id, v)}/draft/current`

/** A version's `updatedAt`, and the stamp a draft taken against it carries. */
const SAVED = { seconds: 100, nanoseconds: 0 }
const SAVED_STAMP = 'ts:100.0'
const LATER = { seconds: 200, nanoseconds: 0 }

const ROOT = '_@_'
const tree = (text: string, extra: Record<string, unknown> = {}) => ({
  [ROOT]: { componentId: 'root', props: {}, nodes: ['t'], ...extra },
  t: { componentId: 'text', props: { text } },
})
const packed = (nodes: unknown) => Buffer.from(encodeStoredNodes(nodes) as Uint8Array)
const stored = (value: unknown) => decodeStoredNodes(value as never)

const ACTOR = { uid: 'api', email: null, apiKeyName: 'Zapier' }
const BASE = { hostId: 'host-1', orgId: 'org-1', org: {} }

function seed(extra: Record<string, Record<string, unknown>> = {}) {
  return settingsFirestoreDouble({
    [HOST]: { orgId: 'org-1', screens: { home: '/', about: 'about' } },
    [page('home')]: { displayName: 'Home', slug: '/', versionId: 'v1' },
    [page('about')]: { displayName: 'About', slug: 'about', versionId: 'v1', publishedAt: 'PUBLISHED-ONCE' },
    [version('about')]: { nodes: packed(tree('Old')), updatedAt: SAVED },
    ...extra,
  })
}

const withDraft = (id: string, nodes: unknown, baseStamp: string | null = SAVED_STAMP) => ({
  [draft(id)]: { nodes: packed(nodes), ...(baseStamp ? { baseStamp } : {}), updatedByUid: 'person-1' },
})

const deps = () => ({
  dropCache: jest.fn(async () => ({ dropped: 1, skipped: 0, complete: true })),
  clearMirror: jest.fn(async () => true),
})

async function publish(double: ReturnType<typeof seed>, pageId: string, d = deps()) {
  const plan = await precheckPagePublish(double.firestore, { ...BASE, pageId })
  if (plan.ok === false) return { plan, result: plan, deps: d }
  const result = await commitPagePublish(double.firestore, { ...BASE, pageId, actor: ACTOR }, plan, d)
  return { plan, result, deps: d }
}

describe('a live page with a usable draft (AGL-4235)', () => {
  it('replaces the version’s tree, deletes the draft, stages the outbox entry, and leaves the pointer and publishedAt alone', async () => {
    const double = seed(withDraft('about', tree('New')))
    const { result, deps: d } = await publish(double, 'about')

    expect(result).toEqual({ ok: true, pageId: 'about', path: '/about', status: 'published' })
    expect(stored(double.read(version('about'))?.['nodes'])).toEqual(tree('New'))
    expect(double.read(version('about'))?.['updatedAt']).toBe(SERVER_TIMESTAMP)
    expect(double.read(draft('about'))).toBeUndefined()
    // The live pointer and the first publish date: the editor moves neither.
    expect(double.read(page('about'))).toEqual({ displayName: 'About', slug: 'about', versionId: 'v1', publishedAt: 'PUBLISHED-ONCE' })
    expect(double.writes.some((write) => write.path === page('about'))).toBe(false)
    // The outbox entry named the live address, and was released once the drop completed.
    const outbox = double.writes.find((write) => write.path.startsWith('publishOutbox/') && write.op === 'set')
    expect(outbox?.data).toEqual({ hostId: 'host-1', paths: ['/about'], createdAt: expect.anything(), attempts: 0 })
    expect(d.dropCache).toHaveBeenCalledWith(expect.objectContaining({ hostIds: ['host-1'], paths: { 'host-1': ['/about'] } }))
    expect(double.outbox()).toEqual([])
    // The activity row the editor writes, attributed to the API key.
    const activity = [...double.docs.entries()].filter(([path]) => path.startsWith(`${HOST}/activity/`)).map(([, row]) => row)
    expect(activity).toEqual([
      expect.objectContaining({
        action: 'Published the screen',
        actorId: 'api',
        apiKeyName: 'Zapier',
        target: { type: 'screen', id: 'about', name: 'About', versionId: 'v1' },
      }),
    ])
    expect(d.clearMirror).toHaveBeenCalledWith({ orgId: 'org-1', hostId: 'host-1', docType: 'screen', docId: 'about', versionId: 'v1' })
  })

  it('keeps the outbox entry for the drain when the cache drop did not complete', async () => {
    const double = seed(withDraft('about', tree('New')))
    const d = { ...deps(), dropCache: jest.fn(async () => ({ dropped: 0, skipped: 1, complete: false })) }
    await publish(double, 'about', d)
    expect(double.outbox()).toHaveLength(1)
  })

  it('lifts the layout style overrides out of the tree and replaces them under the merge, as the editor’s save does', async () => {
    const double = seed({
      [version('about')]: { nodes: packed(tree('Old')), updatedAt: SAVED, layoutStyleOverrides: { lay: { n1: { color: 'red' } } } },
      ...withDraft('about', tree('New', { layoutStyleOverrides: { lay: { n2: { color: 'blue' } } } })),
    })
    const { result } = await publish(double, 'about')
    expect(result).toEqual(expect.objectContaining({ ok: true, status: 'published' }))
    expect(stored(double.read(version('about'))?.['nodes'])).toEqual(tree('New'))
    const write = double.writes.find((entry) => entry.path === version('about'))
    const overrides = write?.data?.['layoutStyleOverrides'] as Record<string, Record<string, unknown>>
    expect(overrides['lay']['n2']).toEqual({ color: 'blue' })
    // The override cleared in the draft is deleted, not left behind by the merge.
    expect((overrides['lay']['n1'] as { isEqual?: unknown }).isEqual).toEqual(expect.any(Function))
  })

  it('converts a typed variable name to its id token against the site’s variables, and leaves an unknown one as typed', async () => {
    const double = seed({
      ...withDraft('about', {
        [ROOT]: { componentId: 'root', props: {}, nodes: ['t'] },
        t: { componentId: 'text', props: { text: 'Call {{phone}} or {{unknown}}' } },
      }),
      [`${HOST}/variables/var1`]: { name: 'phone', value: '555' },
      [`${HOST}/variables/gone`]: { name: 'unknown', deletedAt: 'x' },
    })
    await publish(double, 'about')
    expect((stored(double.read(version('about'))?.['nodes']) as Record<string, { props: { text: string } }>)['t'].props.text).toBe(
      'Call {{var:var1}} or {{unknown}}',
    )
  })
})

describe('a live page with nothing to publish, or a draft that cannot be (AGL-4235)', () => {
  it('answers unchanged and writes nothing when there is no draft', async () => {
    const double = seed()
    const { result, deps: d } = await publish(double, 'about')
    expect(result).toEqual({ ok: true, pageId: 'about', path: '/about', status: 'unchanged' })
    expect(double.writes).toEqual([])
    expect(d.clearMirror).not.toHaveBeenCalled()
  })

  it('refuses a draft taken before the version’s last save, and writes nothing', async () => {
    const double = seed({ [version('about')]: { nodes: packed(tree('Old')), updatedAt: LATER }, ...withDraft('about', tree('New')) })
    const { result } = await publish(double, 'about')
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 409, code: 'stale_draft' }))
    expect(double.writes).toEqual([])
  })

  it('refuses a tree over the size a page can be saved at', async () => {
    const big = { [ROOT]: { componentId: 'root', props: {}, nodes: ['t'] }, t: { componentId: 'text', props: { text: 'x'.repeat(NODE_MAP_MAX_BYTES + 10) } } }
    const double = seed(withDraft('about', big))
    const { result } = await publish(double, 'about')
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 413, code: 'page_too_large' }))
    expect(double.writes).toEqual([])
  })

  it('refuses a page carrying a form on a site that switched Forms off', async () => {
    const withForm = { [ROOT]: { componentId: 'root', props: {}, nodes: ['f'] }, f: { componentId: 'form', props: {} } }
    const double = seed({
      [HOST]: { orgId: 'org-1', screens: { about: 'about' }, disabledPlugins: ['forms'] },
      ...withDraft('about', withForm),
    })
    const { result } = await publish(double, 'about')
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 409, code: 'forms_off_for_site' }))
    expect(double.writes).toEqual([])
    // The same page on a site that runs Forms publishes.
    const on = seed(withDraft('about', withForm))
    expect((await publish(on, 'about')).result).toEqual(expect.objectContaining({ ok: true, status: 'published' }))
  })

  it('refuses a draft that carries no layout style overrides over a version that stores some', async () => {
    const double = seed({
      [version('about')]: { nodes: packed(tree('Old')), updatedAt: SAVED, layoutStyleOverrides: { lay: { n1: { color: 'red' } } } },
      ...withDraft('about', tree('New')),
    })
    const { result } = await publish(double, 'about')
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 409, code: 'publish_from_editor' }))
    expect(double.writes).toEqual([])
  })

  it('refuses it too when the server editor wrote the draft, keeping the stored overrides untouched (AGL-4235)', async () => {
    // A draft an API or Assist edit wrote from the saved tree, stamped as
    // `writeAiEdit` stamps it: the editor's Publish from it would clear the
    // overrides, so neither keeping nor clearing them here is what it does.
    const overrides = { lay: { n1: { color: 'red' } } }
    const double = seed({
      [version('about')]: { nodes: packed(tree('Old')), updatedAt: SAVED, layoutStyleOverrides: overrides },
      [draft('about')]: { nodes: packed(tree('New')), baseStamp: SAVED_STAMP, updatedByUid: 'api', aiEditJobId: 'edit-1' },
    })
    const { result } = await publish(double, 'about')
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 409, code: 'publish_from_editor' }))
    expect(double.writes).toEqual([])
    expect(double.read(version('about'))?.['layoutStyleOverrides']).toEqual(overrides)
    expect(double.read(draft('about'))).toBeDefined()
  })

  it('publishes a server-written draft whose root carries the overrides, as one built on an editor draft does', async () => {
    const overrides = { lay: { n1: { color: 'red' } } }
    const double = seed({
      [version('about')]: { nodes: packed(tree('Old')), updatedAt: SAVED, layoutStyleOverrides: overrides },
      [draft('about')]: {
        nodes: packed(tree('New', { layoutStyleOverrides: overrides })),
        baseStamp: SAVED_STAMP,
        updatedByUid: 'api',
        aiEditJobId: 'edit-1',
      },
    })
    const { result } = await publish(double, 'about')
    expect(result).toEqual(expect.objectContaining({ ok: true, status: 'published' }))
    expect(stored(double.read(version('about'))?.['nodes'])).toEqual(tree('New'))
    const write = double.writes.find((entry) => entry.path === version('about'))
    expect(write?.data?.['layoutStyleOverrides']).toEqual(overrides)
  })

  it('publishes a draft with no overrides over a version that stores none', async () => {
    const double = seed({
      [draft('about')]: { nodes: packed(tree('New')), baseStamp: SAVED_STAMP, updatedByUid: 'api', aiEditJobId: 'edit-1' },
    })
    const { result } = await publish(double, 'about')
    expect(result).toEqual(expect.objectContaining({ ok: true, status: 'published' }))
    const write = double.writes.find((entry) => entry.path === version('about'))
    expect(write?.data).not.toHaveProperty('layoutStyleOverrides')
  })
})

describe('what is not a page that can be published (AGL-4235)', () => {
  it('refuses a pending scheduled publish', async () => {
    const double = seed({
      [page('about')]: { slug: 'about', versionId: 'v1', publishSchedule: { status: 'pending', action: 'publish', versionId: 'v2' } },
      ...withDraft('about', tree('New')),
    })
    const { result } = await publish(double, 'about')
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 409, code: 'scheduled_publish_pending' }))
    expect(double.writes).toEqual([])
  })

  it('refuses each kind that is not an ordinary page', async () => {
    for (const kind of ['email', 'template', 'error', 'group']) {
      const double = seed({ [page('about')]: { slug: 'about', versionId: 'v1', kind }, ...withDraft('about', tree('New')) })
      expect({ kind, result: (await publish(double, 'about')).result }).toEqual({
        kind,
        result: expect.objectContaining({ ok: false, status: 400, code: 'not_a_page' }),
      })
      expect(double.writes).toEqual([])
    }
  })

  it('answers 404 for a deleted page and for one that does not exist', async () => {
    const double = seed({ [page('about')]: { slug: 'about', versionId: 'v1', deletedAt: 'x' }, ...withDraft('about', tree('New')) })
    expect((await publish(double, 'about')).result).toEqual(expect.objectContaining({ ok: false, status: 404, code: 'page_not_found' }))
    expect((await publish(double, 'nope')).result).toEqual(expect.objectContaining({ ok: false, status: 404, code: 'page_not_found' }))
    expect(double.writes).toEqual([])
  })

  it('refuses a page with no version', async () => {
    const double = seed({ [page('about')]: { slug: 'about' } })
    expect((await publish(double, 'about')).result).toEqual(expect.objectContaining({ ok: false, status: 409, code: 'no_version' }))
  })
})

describe('a page with no address yet (AGL-4235)', () => {
  const unpublished = (extra: Record<string, Record<string, unknown>> = {}) =>
    seed({
      [page('team')]: { displayName: 'Team', slug: 'team', parentId: 'about', versionId: 'v1' },
      [version('team')]: { nodes: packed(tree('Empty')), updatedAt: SAVED },
      ...extra,
    })

  it('saves its draft into its version, then publishes its address with the live pages below it', async () => {
    const double = unpublished(withDraft('team', tree('Team page')))
    const { plan, result } = await publish(double, 'team')
    expect(plan).toEqual(expect.objectContaining({ ok: true, case: 'first', saveDraft: true, path: 'about/team', slug: 'team' }))
    expect(result).toEqual({ ok: true, pageId: 'team', path: '/about/team', status: 'published' })
    expect(stored(double.read(version('team'))?.['nodes'])).toEqual(tree('Team page'))
    expect(double.read(draft('team'))).toBeUndefined()
    expect((double.read(HOST)?.['screens'] as Record<string, string>)['team']).toBe('about/team')
    expect(double.read(page('team'))?.['publishedAt']).toBeDefined()
    expect(double.read(page('team'))?.['versionId']).toBe('v1')
    // The draft write and the route write are the only two: nothing else on the site moved.
    expect((double.read(HOST)?.['screens'] as Record<string, string>)['about']).toBe('about')
  })

  it('publishes the stored version’s address when there is no draft', async () => {
    const double = unpublished()
    const { result } = await publish(double, 'team')
    expect(result).toEqual({ ok: true, pageId: 'team', path: '/about/team', status: 'published' })
    expect(stored(double.read(version('team'))?.['nodes'])).toEqual(tree('Empty'))
  })

  it('refuses a page whose parent has no address, and writes nothing', async () => {
    const double = unpublished({ [page('about')]: { displayName: 'About', versionId: 'v1' }, ...withDraft('team', tree('Team page')) })
    expect((await publish(double, 'team')).result).toEqual(expect.objectContaining({ ok: false, status: 409, code: 'unpublished_ancestor' }))
    expect(double.writes).toEqual([])
  })

  it('refuses an address another page is published at, and writes nothing', async () => {
    const double = seed({
      [page('dupe')]: { slug: 'about', versionId: 'v1' },
      [version('dupe')]: { nodes: packed(tree('x')), updatedAt: SAVED },
      ...withDraft('dupe', tree('y')),
    })
    expect((await publish(double, 'dupe')).result).toEqual(expect.objectContaining({ ok: false, status: 409, code: 'address_taken' }))
    expect(double.writes).toEqual([])
  })

  it('refuses no slug, a path separator and a reserved address', async () => {
    for (const [slug, code] of [[undefined, 'no_slug'], ['a/b', 'slug_path_separator'], ['api', 'reserved_address']] as const) {
      const double = seed({
        [page('new')]: { ...(slug ? { slug } : {}), versionId: 'v1' },
        [version('new')]: { nodes: packed(tree('x')), updatedAt: SAVED },
      })
      expect({ slug, result: (await publish(double, 'new')).result }).toEqual({
        slug,
        result: expect.objectContaining({ ok: false, status: 400, code }),
      })
      expect(double.writes).toEqual([])
    }
  })
})

describe('the placeholder home page (AGL-4235)', () => {
  it('saves its draft and republishes its address through the route seam, so it is the owner’s home page from now on', async () => {
    const double = seed({
      [HOST]: { orgId: 'org-1', screens: { home: '/', about: 'about' }, defaultHomeScreenId: 'home' },
      [version('home')]: { nodes: packed(tree('Placeholder')), updatedAt: SAVED },
      ...withDraft('home', tree('Our home')),
    })
    const { plan, result } = await publish(double, 'home')
    expect(plan).toEqual(expect.objectContaining({ ok: true, case: 'placeholder', saveDraft: true, path: '/', slug: '/' }))
    expect(result).toEqual({ ok: true, pageId: 'home', path: '/', status: 'published' })
    expect(stored(double.read(version('home'))?.['nodes'])).toEqual(tree('Our home'))
    expect(double.read(HOST)?.['defaultHomeScreenId']).toBeUndefined()
    expect((double.read(HOST)?.['screens'] as Record<string, string>)['home']).toBe('/')
  })

  it('with no draft is unchanged, and keeps its placeholder marker', async () => {
    const double = seed({
      [HOST]: { orgId: 'org-1', screens: { home: '/' }, defaultHomeScreenId: 'home' },
      [version('home')]: { nodes: packed(tree('Placeholder')), updatedAt: SAVED },
    })
    expect((await publish(double, 'home')).result).toEqual({ ok: true, pageId: 'home', path: '/', status: 'unchanged' })
    expect(double.writes).toEqual([])
    expect(double.read(HOST)?.['defaultHomeScreenId']).toBe('home')
  })
})

describe('precheck and commit (AGL-4235)', () => {
  it('the precheck writes nothing, whatever it finds', async () => {
    const double = seed({
      ...withDraft('about', tree('New')),
      [page('team')]: { slug: 'team', parentId: 'about', versionId: 'v1' },
      [version('team')]: { nodes: packed(tree('x')), updatedAt: SAVED },
      ...withDraft('team', tree('y')),
    })
    for (const pageId of ['about', 'team', 'home', 'nope']) await precheckPagePublish(double.firestore, { ...BASE, pageId })
    expect(double.writes).toEqual([])
  })

  it('the commit re-validates: a draft that went stale after the precheck is refused and nothing is written', async () => {
    const double = seed(withDraft('about', tree('New')))
    const plan = (await precheckPagePublish(double.firestore, { ...BASE, pageId: 'about' })) as PagePublishPlan
    expect(plan.ok).toBe(true)
    // Someone saved the version meanwhile.
    double.docs.set(version('about'), { nodes: packed(tree('Saved by someone')), updatedAt: LATER })
    const result = await commitPagePublish(double.firestore, { ...BASE, pageId: 'about', actor: ACTOR }, plan, deps())
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 409, code: 'stale_draft' }))
    expect(double.writes).toEqual([])
    expect(stored(double.read(version('about'))?.['nodes'])).toEqual(tree('Saved by someone'))
  })

  it('the commit refuses a page that changed shape since the precheck', async () => {
    const double = seed()
    const plan = (await precheckPagePublish(double.firestore, { ...BASE, pageId: 'about' })) as PagePublishPlan
    expect(plan).toEqual(expect.objectContaining({ case: 'live', saveDraft: false }))
    double.docs.set(draft('about'), { nodes: packed(tree('A draft that appeared')), baseStamp: SAVED_STAMP })
    const result = await commitPagePublish(double.firestore, { ...BASE, pageId: 'about', actor: ACTOR }, plan, deps())
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 409, code: 'page_changed' }))
    expect(double.writes).toEqual([])
  })
})

describe('a list of pages (AGL-4235)', () => {
  it('refuses the whole list for one refused page, names every page, and writes nothing', async () => {
    const double = seed({
      ...withDraft('about', tree('New')),
      [page('home')]: { slug: '/', versionId: 'v1', kind: 'email' },
    })
    const checked = await precheckPagePublishes(double.firestore, { ...BASE, pageIds: ['about', 'home'] })
    expect(checked).toEqual({
      ok: false,
      status: 400,
      code: 'not_a_page',
      message: expect.any(String),
      pages: [
        { page: 'about', status: 'not_attempted' },
        { page: 'home', status: 'refused', code: 'not_a_page', message: expect.any(String) },
      ],
    })
    expect(double.writes).toEqual([])
  })

  it('refuses two new pages that would take the same address', async () => {
    const double = seed({
      [page('a')]: { slug: 'same', versionId: 'v1' },
      [version('a')]: { nodes: packed(tree('a')), updatedAt: SAVED },
      [page('b')]: { slug: 'same', versionId: 'v1' },
      [version('b')]: { nodes: packed(tree('b')), updatedAt: SAVED },
    })
    const checked = await precheckPagePublishes(double.firestore, { ...BASE, pageIds: ['a', 'b'] })
    expect(checked).toEqual(expect.objectContaining({ ok: false, status: 409, code: 'address_taken' }))
  })

  it('commits in order, and on a refusal says what went live and what did not', async () => {
    const double = seed({
      ...withDraft('about', tree('New')),
      [version('home')]: { nodes: packed(tree('Home')), updatedAt: SAVED },
      ...withDraft('home', tree('New home')),
    })
    const checked = await precheckPagePublishes(double.firestore, { ...BASE, pageIds: ['about', 'home'] })
    if (checked.ok === false) throw new Error('precheck refused')
    // The second page's version is saved after the precheck.
    double.docs.set(version('home'), { nodes: packed(tree('Saved')), updatedAt: LATER })
    const committed = await commitPagePublishes(double.firestore, { ...BASE, actor: ACTOR }, checked.plans, deps())
    expect(committed).toEqual(
      expect.objectContaining({
        ok: false,
        status: 409,
        code: 'stale_draft',
        promoted: [{ page: 'about', status: 'published', path: '/about' }],
        pages: [
          { page: 'about', status: 'published', path: '/about' },
          { page: 'home', status: 'refused', code: 'stale_draft', message: expect.any(String) },
        ],
      }),
    )
  })
})

describe('clearCoeditMirror (AGL-4235)', () => {
  it('removes the version’s room at the core path, and never throws', async () => {
    const removed: string[] = []
    const database = () => ({ ref: (path: string) => ({ remove: async () => void removed.push(path) }) })
    expect(await clearCoeditMirror({ orgId: 'o', hostId: 'h', docType: 'screen', docId: 's', versionId: 'v' }, { database })).toBe(true)
    expect(removed).toEqual(['coedit/o/h/screen/s/v/nodes'])
    const failing = () => ({ ref: () => ({ remove: async () => Promise.reject(new Error('down')) }) })
    expect(await clearCoeditMirror({ orgId: 'o', hostId: 'h', docType: 'screen', docId: 's' }, { database: failing })).toBe(false)
  })
})

describe('readPagePublishBody (AGL-4235)', () => {
  it('reads no body, an empty object and a body without pages as the refresh alone', () => {
    for (const raw of ['', '  ', '{}', '{"note":"x"}']) expect(readPagePublishBody(raw)).toEqual({ pages: null })
  })

  it('takes 1 to 25 distinct page ids and nothing beside them', () => {
    expect(readPagePublishBody('{"pages":["a","b"]}')).toEqual({ pages: ['a', 'b'] })
    expect(readPagePublishBody(JSON.stringify({ pages: Array.from({ length: 25 }, (_, n) => `p${n}`) }))).toEqual({
      pages: expect.any(Array),
    })
    for (const body of [{ pages: [] }, { pages: Array.from({ length: 26 }, (_, n) => `p${n}`) }, { pages: ['a', 'a'] }, { pages: 'a' }, { pages: [''] }, { pages: ['a/b'] }]) {
      expect({ body, read: readPagePublishBody(JSON.stringify(body)) }).toEqual({ body, read: { errors: { pages: expect.any(String) } } })
    }
    expect(readPagePublishBody('{"pages":["a"],"force":true}')).toEqual({ errors: { force: 'Not a member of a publish request' } })
    expect(readPagePublishBody('{nope')).toEqual({ errors: { body: 'Must be a JSON object' } })
    expect(readPagePublishBody('[]')).toEqual({ errors: { body: 'Must be a JSON object' } })
  })
})
