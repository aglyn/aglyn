/**
 * @jest-environment node
 */
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
 * A page's content over the platform's `core.page-content` contract
 * (AGL-4235), answered by the edit rung. Its promises, each held against what
 * the store holds after:
 *
 *  - A read is the whole page, complete, as the next edit will find it: the
 *    usable draft, otherwise the saved version, and `base` and `revision` say
 *    which.
 *  - An edit is held to the editor's own rules, strictly: what the rung would
 *    repair for a model is refused here and named by edit and member.
 *  - An edit lands in the page's draft only: the live pointer, the version
 *    document and the page document never move, and a refusal writes nothing.
 */

import { measureNodeMap, NODE_MAP_MAX_BYTES } from '@aglyn/aglyn/app-utils/measure-node-map'
import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type {
  PageContentEdit,
  PageContentEditInput,
  PageContentEditResult,
  PageContentRead,
  PageContentRefusal,
} from '@aglyn/aglyn/plugin-manager/plugin-page-content'
import { PAGE_CONTENT_MAX_EDITS, PAGE_CONTENT_MAX_INSERT_ELEMENTS } from '@aglyn/aglyn/plugin-manager/plugin-page-content'
import { aiDocumentElements, aiEditJobOutline } from '../model/ai-edit-job'
import { ASSIST_EDIT_WHOLE_MAX_NODES } from '../model/assist-edit'
import { ASSIST_EDIT_MAX_INSERT_NODES, ASSIST_EDIT_MAX_OPS } from './assist-edit'
import {
  AI_PAGE_CONTENT_API_ACTOR,
  aiPageContentRevision,
  createAiPageContentEditor,
  readAiPageContent,
} from './ai-page-content'

// ── A store the reads and the write's transaction run against ────────────

const docs = new Map<string, Record<string, unknown>>()

function snapshotOf(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').at(-1) as string,
    exists: data !== undefined,
    data: () => (data ? { ...data } : undefined),
    get: (field: string) =>
      field.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), data),
  }
}

function refOf(path: string): any {
  return { path, id: path.split('/').at(-1), get: async () => snapshotOf(path), collection: (name: string) => collectionOf(`${path}/${name}`) }
}

function collectionOf(path: string) {
  const listed = () => ({
    docs: [...docs.keys()]
      .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      .map((key) => snapshotOf(key)),
  })
  return { doc: (id: string) => refOf(`${path}/${id}`), select: () => ({ get: async () => listed() }) }
}

const firestore = {
  collection: (name: string) => collectionOf(name),
  runTransaction: async (run: (tx: unknown) => Promise<unknown>) => {
    const writes: Array<() => void> = []
    const tx = {
      get: async (ref: { path: string }) => snapshotOf(ref.path),
      create: (ref: { path: string }, data: Record<string, unknown>) => writes.push(() => docs.set(ref.path, data)),
      update: (ref: { path: string }, patch: Record<string, unknown>) =>
        writes.push(() => docs.set(ref.path, { ...docs.get(ref.path), ...patch })),
      set: (ref: { path: string }, data: Record<string, unknown>) => writes.push(() => docs.set(ref.path, data)),
    }
    const result = await run(tx)
    for (const write of writes) write()
    return result
  },
} as unknown as FirebaseFirestore.Firestore

// ── The site ──────────────────────────────────────────────────────────────

const ROOT = CANVAS_ROOT_ELEMENT_ID
const LONG_TEXT = 'Every tap, pipe and drain in the valley, fixed the same day. '.repeat(25).trim()

const PAGE_NODES: Record<string, Record<string, unknown>> = {
  [ROOT]: { $id: ROOT, componentId: 'div', parentId: ROOT, props: {}, nodes: ['hero', 'services'] },
  hero: { $id: 'hero', componentId: 'section', parentId: ROOT, name: 'Hero', props: { element: 'section' }, sx: { py: 16, '&:hover': { py: 18 } }, nodes: ['heroStack'] },
  heroStack: { $id: 'heroStack', componentId: 'muiStack', parentId: 'hero', props: { direction: 'column' }, nodes: ['heroTitle', 'heroCta', 'heroImage'] },
  heroTitle: { $id: 'heroTitle', componentId: 'muiTypography', parentId: 'heroStack', props: { variant: 'h1', children: 'Brightside Plumbing' }, nodes: [] },
  heroCta: {
    $id: 'heroCta',
    componentId: 'muiButton',
    parentId: 'heroStack',
    props: { children: 'Book a visit', className: 'cta' },
    interactions: [{ id: 'i1' }, { id: 'i2' }],
    nodes: [],
  },
  heroImage: { $id: 'heroImage', componentId: 'image', parentId: 'heroStack', props: { src: 'media:host-1/photo1' }, nodes: [] },
  services: { $id: 'services', componentId: 'section', parentId: ROOT, props: { element: 'section' }, nodes: ['servicesTitle', 'servicesBody'] },
  servicesTitle: { $id: 'servicesTitle', componentId: 'muiTypography', parentId: 'services', props: { variant: 'h2', children: 'What we fix' }, nodes: [] },
  servicesBody: {
    $id: 'servicesBody',
    componentId: 'muiTypography',
    parentId: 'services',
    props: { variant: 'body1', children: LONG_TEXT, html: '<p>Rich</p>' },
    nodes: [],
  },
}

const packed = (nodes: Record<string, unknown>) => Buffer.from(encodeStoredNodes(nodes) as Uint8Array)
const treeAt = (path: string) => decodeStoredNodes<Record<string, Record<string, any>>>(docs.get(path)?.['nodes']) as Record<string, Record<string, any>>

const HOST = 'hosts/host-1'
const SCREEN = `${HOST}/screens/home`
const VERSION = `${SCREEN}/versions/v-live`
const DRAFT = `${VERSION}/draft/current`
const SAVED_AT = { toMillis: () => 1_790_000_000_000 }
const SAVED_STAMP = 'ms:1790000000000'
const NOW = new Date('2026-11-19T15:00:00.000Z')
const MEDIA_SCOPES = ['host-1', 'org:org-1', 'org:org-1:host-1']

function seed(nodes: Record<string, unknown> = PAGE_NODES) {
  docs.clear()
  docs.set(HOST, { orgId: 'org-1', subdomain: 'brightside', screens: { home: '/', about: '/about' } })
  docs.set(SCREEN, { displayName: 'Home', versionId: 'v-live' })
  docs.set(`${HOST}/screens/about`, { displayName: 'About', versionId: 'v-a' })
  docs.set(`${HOST}/screens/folder`, { displayName: 'Folder', kind: 'group' })
  docs.set(`${HOST}/screens/welcome`, { displayName: 'Welcome email', kind: 'email', versionId: 'v-e' })
  docs.set(`${HOST}/screens/gone`, { displayName: 'Gone', versionId: 'v-g', deletedAt: NOW })
  docs.set(`${HOST}/screens/posts`, { displayName: 'Post template', kind: 'template', versionId: 'v-t' })
  docs.set(VERSION, { screenId: 'home', displayName: 'Initial version', nodes: packed(nodes), updatedAt: SAVED_AT })
}

function seedDraft(nodes: Record<string, unknown>, baseStamp = SAVED_STAMP) {
  docs.set(DRAFT, { nodes: packed(nodes), baseStamp, updatedByUid: 'uid-author', updatedAt: NOW })
}

const read = (input: { pageId?: string; elementId?: string; hostId?: string } = {}) =>
  readAiPageContent({ firestore, orgId: 'org-1', hostId: input.hostId ?? 'host-1', pageId: input.pageId ?? 'home', ...(input.elementId ? { elementId: input.elementId } : {}) })

const clearMirror = jest.fn(async () => undefined)
const editor = createAiPageContentEditor({ readDatasets: async () => [], clearMirror, now: () => NOW })
let editCount = 0

function edit(edits: PageContentEdit[], extra: Partial<PageContentEditInput> = {}) {
  editCount += 1
  return editor({
    firestore,
    orgId: 'org-1',
    hostId: 'host-1',
    pageId: 'home',
    edits,
    actor: { uid: null, label: 'API key Zapier' },
    editId: `edit-${editCount}`,
    mediaScopes: MEDIA_SCOPES,
    ...extra,
  })
}

const ok = <T extends { ok: true }>(result: T | PageContentRefusal): T => {
  if (result.ok === false) throw new Error(`refused: ${JSON.stringify(result)}`)
  return result
}

const refused = (result: PageContentEditResult | PageContentRead | PageContentRefusal): PageContentRefusal => {
  if (result.ok === false) return result
  throw new Error('expected a refusal')
}

/** Everything the store holds, to show a refusal wrote nothing. */
const everything = () => JSON.stringify([...docs.entries()])

beforeEach(() => {
  seed()
  clearMirror.mockClear()
})

// ── Reading ───────────────────────────────────────────────────────────────

describe('reading a page', () => {
  it('answers every element, complete and in the order the page reads', async () => {
    const page = ok(await read())
    expect(page.elements.map((element) => element.id)).toEqual([
      ROOT,
      'hero',
      'heroStack',
      'heroTitle',
      'heroCta',
      'heroImage',
      'services',
      'servicesTitle',
      'servicesBody',
    ])
    expect(page).toMatchObject({ pageId: 'home', versionId: 'v-live', base: 'saved', rootId: ROOT, total: 9 })
    const stack = page.elements.find((element) => element.id === 'heroStack')
    expect(stack).toMatchObject({ kind: 'muiStack', parentId: 'hero', children: ['heroTitle', 'heroCta', 'heroImage'] })
    // Text is never cut.
    expect(page.elements.find((element) => element.id === 'servicesBody')?.props['children']).toBe(LONG_TEXT)
    expect(LONG_TEXT.length).toBeGreaterThan(1_000)
  })

  it('reads a page past the outline’s caps whole, with every property', async () => {
    const wide: Record<string, Record<string, unknown>> = {
      [ROOT]: { $id: ROOT, componentId: 'div', props: {}, nodes: [] },
    }
    for (let index = 0; index < ASSIST_EDIT_WHOLE_MAX_NODES + 50; index += 1) {
      const id = `t${index}`
      ;(wide[ROOT]['nodes'] as string[]).push(id)
      wide[id] = { $id: id, componentId: 'muiTypography', parentId: ROOT, props: { variant: 'body1', children: `Line ${index}` }, nodes: [] }
    }
    // Twenty settings on one element, past the outline's sixteen.
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`setting${index}`, index]))
    wide['t0']['props'] = { ...(wide['t0']['props'] as object), ...many }
    seed(wide)
    const page = ok(await read())
    expect(page.total).toBe(ASSIST_EDIT_WHOLE_MAX_NODES + 51)
    expect(page.elements).toHaveLength(ASSIST_EDIT_WHOLE_MAX_NODES + 51)
    const first = page.elements[1]
    expect(Object.keys({ ...first.props, ...first.readOnly?.props }).length).toBe(22)
    // The capped outline is the same walk, cut where it always was.
    expect(aiEditJobOutline(wide)?.nodes).toHaveLength(ASSIST_EDIT_WHOLE_MAX_NODES)
    expect(aiEditJobOutline(wide)?.total).toBe(aiDocumentElements(wide)?.length)
  })

  it('reads one element and what is inside it, and refuses one that is not on the page', async () => {
    const branch = ok(await read({ elementId: 'heroStack' }))
    expect(branch.elements.map((element) => element.id)).toEqual(['heroStack', 'heroTitle', 'heroCta', 'heroImage'])
    expect(branch.total).toBe(9)
    expect(Object.keys(branch.kinds).sort()).toEqual(['image', 'muiButton', 'muiStack', 'muiTypography'])
    expect(refused(await read({ elementId: 'nope' }))).toMatchObject({ status: 404, code: 'element_not_found' })
  })

  it('says what each kind takes: its label, whether it holds others, and each setting’s role and limits', async () => {
    const page = ok(await read())
    expect(page.kinds['div']).toEqual({ label: 'Page', acceptsChildren: true, props: {} })
    expect(page.kinds['section']).toMatchObject({ label: 'Section', acceptsChildren: true })
    const text = page.kinds['muiTypography']
    expect(text).toMatchObject({ label: 'Typography', acceptsChildren: false })
    expect(text.props['children']).toEqual({ role: 'text', type: 'string', maxLength: 2_000 })
    expect(text.props['variant']?.values).toContain('h1')
    expect(page.kinds['image'].props['src']).toMatchObject({ role: 'media', type: 'string' })
    expect(page.kinds['image'].props['screenId']).toMatchObject({ role: 'screen' })
    expect(page.kinds['muiButton'].props['children']).toMatchObject({ role: 'text', maxLength: 40 })
  })

  it('shows what an edit cannot set as read-only, never as a setting', async () => {
    const page = ok(await read())
    const body = page.elements.find((element) => element.id === 'servicesBody')
    expect(body?.props).not.toHaveProperty('html')
    expect(body?.readOnly?.props).toEqual({ html: '<p>Rich</p>' })
    const cta = page.elements.find((element) => element.id === 'heroCta')
    expect(cta?.readOnly).toEqual({ props: { className: 'cta' }, interactions: 2 })
    const hero = page.elements.find((element) => element.id === 'hero')
    expect(hero?.style).toEqual({ py: 16 })
    expect(hero?.readOnly?.style).toEqual({ '&:hover': { py: 18 } })
  })

  it('reads the usable draft, the saved version otherwise, and says which', async () => {
    const saved = ok(await read())
    expect(saved.base).toBe('saved')
    seedDraft({ ...PAGE_NODES, heroTitle: { ...PAGE_NODES['heroTitle'], props: { variant: 'h1', children: 'Draft title' } } })
    const drafted = ok(await read())
    expect(drafted.base).toBe('draft')
    expect(drafted.elements.find((element) => element.id === 'heroTitle')?.props['children']).toBe('Draft title')
    expect(drafted.revision).not.toBe(saved.revision)
    // A draft the version was saved past is not offered, so it is not read.
    seedDraft({ ...PAGE_NODES }, 'ms:1')
    const stale = ok(await read())
    expect(stale.base).toBe('saved')
    expect(stale.revision).toBe(saved.revision)
  })

  it('reads only an ordinary page of the site', async () => {
    for (const pageId of ['folder', 'welcome', 'gone', 'posts', 'missing']) {
      expect({ pageId, refusal: refused(await read({ pageId })) }).toMatchObject({ pageId, refusal: { status: 404, code: 'page_not_found' } })
    }
    docs.set('hosts/other', { orgId: 'org-2' })
    expect(refused(await read({ hostId: 'other' }))).toMatchObject({ status: 404, code: 'page_not_found' })
  })
})

// ── Editing ───────────────────────────────────────────────────────────────

describe('editing a page’s draft', () => {
  it('applies every kind of edit, in order, to the draft, and nothing else moves', async () => {
    const before = { page: docs.get(SCREEN), version: docs.get(VERSION), host: docs.get(HOST) }
    const result = ok(
      await edit([
        { op: 'updateProps', elementId: 'heroTitle', props: { children: 'Friendly, fast plumbing' } },
        { op: 'updateStyle', elementId: 'hero', style: { py: 8, textAlign: { xs: 'center', md: 'left' } } },
        { op: 'rename', elementId: 'services', name: 'Services' },
        {
          op: 'insert',
          parentId: 'services',
          index: 1,
          element: {
            kind: 'muiStack',
            name: 'Cards',
            props: { direction: 'row' },
            children: [
              { kind: 'muiTypography', props: { variant: 'h3', children: 'Leaks' } },
              { kind: 'muiTypography', props: { variant: 'h3', children: 'Drains' } },
            ],
          },
        },
        { op: 'move', elementId: 'heroCta', parentId: 'services', index: 0 },
        { op: 'remove', elementId: 'heroImage' },
      ]),
    )
    expect(result).toMatchObject({ pageId: 'home', versionId: 'v-live', applied: 6 })
    const draft = treeAt(DRAFT)
    expect(draft['heroTitle']['props']).toEqual({ variant: 'h1', children: 'Friendly, fast plumbing' })
    expect(draft['hero']['sx']).toEqual({ py: 8, textAlign: { xs: 'center', md: 'left' }, '&:hover': { py: 18 } })
    expect(draft['services']['name']).toBe('Services')
    expect(draft['heroImage']).toBeUndefined()
    expect(draft['heroStack']['nodes']).toEqual(['heroTitle'])
    // The insert's ids, so a later call can name what it added.
    expect(result.created).toHaveLength(1)
    const [created] = result.created
    expect(created.index).toBe(3)
    expect(created.ids).toHaveLength(3)
    expect(created.ids[0]).toBe(created.id)
    expect(draft[created.id]).toMatchObject({ componentId: 'muiStack', name: 'Cards', nodes: created.ids.slice(1) })
    expect(draft[created.ids[2]]['props']).toMatchObject({ children: 'Drains' })
    expect(draft['services']['nodes']).toEqual(['heroCta', 'servicesTitle', created.id, 'servicesBody'])
    // Written as the Besigner writes a draft, attributed to the key.
    expect(docs.get(DRAFT)).toMatchObject({
      baseStamp: SAVED_STAMP,
      updatedByUid: AI_PAGE_CONTENT_API_ACTOR,
      updatedByLabel: 'API key Zapier',
      updatedByEmail: null,
      updatedAt: NOW,
    })
    // The live pointer, the version and the page are as they were.
    expect({ page: docs.get(SCREEN), version: docs.get(VERSION), host: docs.get(HOST) }).toEqual(before)
    expect(clearMirror).toHaveBeenCalledWith({ orgId: 'org-1', hostId: 'host-1', kind: 'screen', id: 'home', versionId: 'v-live' })
    // The revision answered is the one a read now finds.
    const after = ok(await read())
    expect(after).toMatchObject({ base: 'draft', revision: result.revision })
  })

  it('attributes an edit to the person a connected app acts for', async () => {
    ok(await edit([{ op: 'rename', elementId: 'hero', name: 'Top' }], { actor: { uid: 'uid-7', label: 'Connected app Cursor' } }))
    expect(docs.get(DRAFT)).toMatchObject({ updatedByUid: 'uid-7', updatedByLabel: 'Connected app Cursor' })
  })

  it('builds on the usable draft, and replaces a stale one as the Assist does', async () => {
    seedDraft({ ...PAGE_NODES, heroTitle: { ...PAGE_NODES['heroTitle'], props: { variant: 'h1', children: 'Draft title' } } })
    ok(await edit([{ op: 'rename', elementId: 'hero', name: 'Top' }]))
    expect(treeAt(DRAFT)['heroTitle']['props']['children']).toBe('Draft title')
    expect(treeAt(DRAFT)['hero']['name']).toBe('Top')

    seed()
    seedDraft({ ...PAGE_NODES, heroTitle: { ...PAGE_NODES['heroTitle'], props: { variant: 'h1', children: 'Old draft' } } }, 'ms:1')
    ok(await edit([{ op: 'rename', elementId: 'hero', name: 'Top' }]))
    expect(treeAt(DRAFT)['heroTitle']['props']['children']).toBe('Brightside Plumbing')
    expect(docs.get(DRAFT)?.['baseStamp']).toBe(SAVED_STAMP)
  })

  it('refuses when the revision sent is not the base’s, and saves when it is', async () => {
    const page = ok(await read())
    const before = everything()
    expect(refused(await edit([{ op: 'rename', elementId: 'hero', name: 'Top' }], { ifRevision: 's_not-it' }))).toMatchObject({
      status: 409,
      code: 'stale',
      fields: { ifRevision: expect.stringContaining(page.revision) },
    })
    expect(everything()).toBe(before)
    const saved = ok(await edit([{ op: 'rename', elementId: 'hero', name: 'Top' }], { ifRevision: page.revision }))
    expect(saved.revision).not.toBe(page.revision)
    // The old revision no longer matches the draft it made.
    expect(refused(await edit([{ op: 'rename', elementId: 'hero', name: 'Again' }], { ifRevision: page.revision }))).toMatchObject({ status: 409 })
  })

  it('reads the revision off the tree as stored', () => {
    const bytes = packed(PAGE_NODES)
    expect(aiPageContentRevision('saved', 'v', bytes)).toBe(aiPageContentRevision('saved', 'v', Buffer.from(bytes)))
    expect(aiPageContentRevision('saved', 'v', bytes)).not.toBe(aiPageContentRevision('draft', 'v', bytes))
    expect(aiPageContentRevision('saved', 'v', { b: 1, a: 2 })).toBe(aiPageContentRevision('saved', 'v', { a: 2, b: 1 }))
  })
})

describe('the editor’s rules, held strictly', () => {
  async function refusedEdit(edits: PageContentEdit[] | unknown[]): Promise<PageContentRefusal> {
    const before = everything()
    const result = refused(await edit(edits as PageContentEdit[]))
    // Nothing is written on any refusal.
    expect(everything()).toBe(before)
    expect(clearMirror).not.toHaveBeenCalled()
    return result
  }

  it('names a property the element does not take', async () => {
    const result = await refusedEdit([{ op: 'updateProps', elementId: 'heroTitle', props: { colour: 'red', children: 'Fine' } }])
    expect(result).toMatchObject({ status: 422, code: 'edit_refused' })
    expect(result.fields).toEqual({ 'edits[0].props.colour': 'is not a property of Typography' })
  })

  it('names text over its limit, rather than cutting it', async () => {
    const result = await refusedEdit([{ op: 'updateProps', elementId: 'heroCta', props: { children: 'B'.repeat(41) } }])
    expect(result.fields).toEqual({ 'edits[0].props.children': 'is longer than 40 characters' })
  })

  it('names a value that is not already its type, rather than coercing it', async () => {
    const result = await refusedEdit([{ op: 'updateProps', elementId: 'heroImage', props: { lightbox: 'true' } }])
    expect(result.fields).toEqual({ 'edits[0].props.lightbox': 'is not a boolean' })
    const choice = await refusedEdit([{ op: 'updateProps', elementId: 'heroTitle', props: { variant: 'H1' } }])
    expect(choice.fields?.['edits[0].props.variant']).toMatch(/spelled "H1"/)
  })

  it('names a style the element does not take', async () => {
    const result = await refusedEdit([{ op: 'updateStyle', elementId: 'hero', style: { cursor: 'pointer', py: 4 } }])
    expect(result.fields).toEqual({ 'edits[0].style.cursor': 'is not an allowed style' })
  })

  it('names an element that is not on the page, and the root', async () => {
    const result = await refusedEdit([
      { op: 'rename', elementId: 'nope', name: 'X' },
      { op: 'remove', elementId: ROOT },
      { op: 'updateStyle', elementId: ROOT, style: { py: 2 } },
      { op: 'insert', parentId: 'ghost', element: { kind: 'muiTypography', props: { children: 'Hi' } } },
    ])
    expect(result.fields).toEqual({
      'edits[0].elementId': 'is not an element of this page',
      'edits[1].elementId': expect.stringContaining('root'),
      'edits[2].elementId': expect.stringContaining('root'),
      'edits[3].parentId': 'is not an element of this page',
    })
  })

  it('names an element an earlier edit removes', async () => {
    const result = await refusedEdit([
      { op: 'remove', elementId: 'heroStack' },
      { op: 'rename', elementId: 'heroTitle', name: 'Gone' },
    ])
    expect(result.fields).toEqual({ 'edits[1].elementId': 'is inside an element an earlier edit removes' })
  })

  it('refuses to add or move into an element that cannot hold others', async () => {
    const insert = await refusedEdit([{ op: 'insert', parentId: 'heroCta', element: { kind: 'muiTypography', props: { children: 'Hi' } } }])
    expect(Object.keys(insert.fields ?? {})).toEqual(['edits[0].element'])
    expect(insert.fields?.['edits[0].element']).toMatch(/cannot hold other elements/)
    const move = await refusedEdit([{ op: 'move', elementId: 'heroTitle', parentId: 'heroCta', index: 0 }])
    expect(move.fields).toEqual({ 'edits[0].parentId': 'that element cannot be placed there' })
    const inside = await refusedEdit([{ op: 'move', elementId: 'hero', parentId: 'heroStack', index: 0 }])
    expect(inside.fields).toEqual({ 'edits[0].parentId': 'is inside the element being moved' })
  })

  it('names a problem inside an inserted element by its place in the request', async () => {
    const result = await refusedEdit([
      {
        op: 'insert',
        parentId: 'services',
        element: {
          kind: 'muiStack',
          children: [{ kind: 'muiTypography', props: { children: 'Fine' } }, { kind: 'muiButton', props: { children: 'X'.repeat(50) } }],
        },
      },
    ])
    expect(result.fields).toEqual({ 'edits[0].element.children[1].props.children': 'is longer than 40 characters' })
    const kind = await refusedEdit([{ op: 'insert', parentId: 'services', element: { kind: 'marquee' } }])
    expect(kind.fields).toEqual({ 'edits[0].element.kind': 'is not a kind of element a page takes' })
  })

  it('refuses rich text, class names and handlers by name', async () => {
    const result = await refusedEdit([{ op: 'updateProps', elementId: 'servicesBody', props: { html: '<b>x</b>', onClick: 'x' } }])
    expect(Object.keys(result.fields ?? {}).sort()).toEqual(['edits[0].props.html', 'edits[0].props.onClick'])
  })

  it('holds the limits the contract states', () => {
    expect([ASSIST_EDIT_MAX_OPS, ASSIST_EDIT_MAX_INSERT_NODES]).toEqual([PAGE_CONTENT_MAX_EDITS, PAGE_CONTENT_MAX_INSERT_ELEMENTS])
  })

  it('takes 1 to 20 edits, and up to 40 elements in one insert', async () => {
    const many = Array.from({ length: 21 }, (): PageContentEdit => ({ op: 'rename', elementId: 'hero', name: 'Top' }))
    expect((await refusedEdit(many)).fields).toEqual({ edits: expect.stringContaining('1 to 20') })
    expect((await refusedEdit([])).status).toBe(422)
    const children = Array.from({ length: 40 }, () => ({ kind: 'muiTypography', props: { children: 'Hi' } }))
    const big = await refusedEdit([{ op: 'insert', parentId: 'services', element: { kind: 'muiStack', children } }])
    expect(big.fields).toEqual({ 'edits[0].element': 'adds 41 elements; one insert adds at most 40' })
  })

  it('offers no search fields, component saves or interactions', async () => {
    for (const op of ['setSeo', 'saveAsComponent', 'addInteraction']) {
      const result = await refusedEdit([{ op, elementId: 'hero' }])
      expect({ op, fields: result.fields }).toEqual({ op, fields: { 'edits[0].op': expect.stringContaining('is not an edit') } })
    }
  })

  it('takes a picture from the site’s or the workspace’s library, or an https address, and no other library', async () => {
    const other = await refusedEdit([{ op: 'updateProps', elementId: 'heroImage', props: { src: 'media:org:org-2/theirs' } }])
    expect(other.fields).toEqual({ 'edits[0].props.src': expect.stringContaining('media reference') })
    const otherSite = await refusedEdit([{ op: 'updateProps', elementId: 'heroImage', props: { src: 'media:host-9/theirs' } }])
    expect(Object.keys(otherSite.fields ?? {})).toEqual(['edits[0].props.src'])
    ok(await edit([{ op: 'updateProps', elementId: 'heroImage', props: { src: 'media:org:org-1/ours' } }]))
    expect(treeAt(DRAFT)['heroImage']['props']['src']).toBe('media:org:org-1/ours')
    ok(await edit([{ op: 'updateProps', elementId: 'heroImage', props: { src: 'https://images.example.com/a.jpg' } }]))
  })

  it('links only to a page of this site', async () => {
    const result = await refusedEdit([{ op: 'updateProps', elementId: 'heroImage', props: { screenId: 'folder' } }])
    expect(result.fields).toEqual({ 'edits[0].props.screenId': 'names a page this site does not have' })
    ok(await edit([{ op: 'updateProps', elementId: 'heroImage', props: { screenId: 'about' } }]))
  })

  it('refuses a change that would make the page too large to save', async () => {
    const nodes: Record<string, Record<string, unknown>> = { [ROOT]: { $id: ROOT, componentId: 'div', props: {}, nodes: [] } }
    const text = 'x'.repeat(1_990)
    let index = 0
    while (measureNodeMap(nodes).bytes < NODE_MAP_MAX_BYTES - 1_500) {
      const id = `t${index}`
      index += 1
      ;(nodes[ROOT]['nodes'] as string[]).push(id)
      nodes[id] = { $id: id, componentId: 'muiTypography', parentId: ROOT, props: { variant: 'body1', children: text }, nodes: [] }
    }
    seed(nodes)
    const before = everything()
    const result = refused(await edit([{ op: 'insert', parentId: ROOT, element: { kind: 'muiTypography', props: { children: text } } }]))
    expect(result).toMatchObject({ status: 413, code: 'page_too_large' })
    expect(everything()).toBe(before)
  })
})
