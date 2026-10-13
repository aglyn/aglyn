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
 * A guided site start publishes what it built (AGL-3596), against a Firestore
 * double that honors batches, dotted host updates, merges and deletes.
 *
 *  - every page goes live at its address, the home page takes `/` from an
 *    untouched starter, which goes to the trash, and `site_published` is
 *    sent once;
 *  - the pages' navigation entries land in the header of their layout, and
 *    its links to the retired starter follow the new home;
 *  - a page that cannot go live stays a draft with the sentence for why, and
 *    the others still publish.
 */

import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { FieldValue } from 'firebase-admin/firestore'
import type { AiJobOutput } from '../model/ai-jobs.types'
import {
  AI_SITE_PUBLISH_DELETED,
  aiJobPublishesSite,
  aiLayoutWithBlogEntry,
  aiLayoutWithNavigation,
  aiMergeSitePublish,
  aiPublishGuidedSite,
  aiRestoreGuidedBlogEntry,
  aiSiteUnwrittenBlogHrefs,
  aiSitePublishTakenCopy,
} from './ai-site-publish'

const NOW = new Date('2026-10-07T01:30:00.000Z')
const docs = new Map<string, Record<string, unknown>>()

const DELETE = FieldValue.delete()
const isDelete = (value: unknown) => value === DELETE || (value instanceof Object && value.constructor === DELETE.constructor && String(value) === String(DELETE))

function snapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) =>
      field.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), data),
  }
}

function apply(path: string, patch: Record<string, unknown>, mode: 'merge' | 'update' | 'set') {
  const current = mode === 'set' ? {} : { ...(docs.get(path) ?? {}) }
  if (mode === 'update' && !docs.has(path)) throw new Error(`5 NOT_FOUND: ${path}`)
  for (const [key, value] of Object.entries(patch)) {
    const parts = mode === 'update' ? key.split('.') : [key]
    let target = current as Record<string, unknown>
    for (const part of parts.slice(0, -1)) {
      target[part] = { ...((target[part] as Record<string, unknown>) ?? {}) }
      target = target[part] as Record<string, unknown>
    }
    const last = parts[parts.length - 1]
    if (isDelete(value)) delete target[last]
    else target[last] = value
  }
  docs.set(path, current)
}

let autoId = 0
function docRef(path: string): Record<string, unknown> {
  return {
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshot(path),
    delete: async () => void docs.delete(path),
  }
}
function collectionRef(path: string): Record<string, unknown> {
  const children = () =>
    [...docs.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
  return {
    doc: (id?: string) => docRef(`${path}/${id ?? `auto${++autoId}`}`),
    limit: (n: number) => ({ get: async () => ({ size: Math.min(n, children().length) }) }),
  }
}

let failCommit = false
const firestore = {
  collection: (name: string) => collectionRef(name),
  batch: () => {
    const writes: Array<() => void> = []
    return {
      set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) =>
        writes.push(() => apply(ref.path, data, options?.merge ? 'merge' : 'set')),
      update: (ref: { path: string }, data: Record<string, unknown>) => writes.push(() => apply(ref.path, data, 'update')),
      create: (ref: { path: string }, data: Record<string, unknown>) =>
        writes.push(() => {
          if (docs.has(ref.path)) throw new Error(`6 ALREADY_EXISTS: ${ref.path}`)
          docs.set(ref.path, data)
        }),
      commit: async () => {
        if (failCommit) throw new Error('14 UNAVAILABLE')
        for (const write of writes) write()
      },
    }
  },
} as unknown as FirebaseFirestore.Firestore

const STARTER_LAYOUT = {
  root: { $id: 'root', componentId: 'div', nodes: ['dl_header'] },
  dl_header: { $id: 'dl_header', componentId: 'muiAppBar', parentId: 'root', nodes: ['dl_toolbar'] },
  dl_toolbar: { $id: 'dl_toolbar', componentId: 'muiToolbar', parentId: 'dl_header', nodes: ['dl_brand', 'dl_search'] },
  dl_brand: { $id: 'dl_brand', componentId: 'muiScreenLink', parentId: 'dl_toolbar', props: { children: 'Hillside', screenId: 'scr-starter' }, nodes: [] },
  dl_search: { $id: 'dl_search', componentId: 'searchBox', parentId: 'dl_toolbar', nodes: [] },
}

/** A site born with the starter, and the two pages a guided start drafted over it. */
function seedSite(options: { starterVersions?: number } = {}) {
  docs.set('hosts/host-1', { subdomain: 'hillside', screens: { 'scr-starter': '/' }, defaultHomeScreenId: 'scr-starter' })
  docs.set('hosts/host-1/screens/scr-starter', { displayName: 'Home', slug: '/', versionId: 'v-s1', layoutId: 'lay-site', publishedAt: NOW })
  for (let index = 1; index <= (options.starterVersions ?? 1); index += 1) {
    docs.set(`hosts/host-1/screens/scr-starter/versions/v-s${index}`, { screenId: 'scr-starter' })
  }
  docs.set('hosts/host-1/layouts/lay-site', { displayName: 'Site header and footer', versionId: 'v-lay' })
  docs.set('hosts/host-1/layouts/lay-site/versions/v-lay', { layoutId: 'lay-site', nodes: Buffer.from(encodeStoredNodes(STARTER_LAYOUT as never) as Uint8Array) })
  docs.set('hosts/host-1/screens/drft-home', { displayName: 'Home', slug: '/', versionId: 'v-home' })
  docs.set('hosts/host-1/screens/drft-home/versions/v-home', { layoutId: 'lay-site', aiJobId: 'job-1' })
  docs.set('hosts/host-1/screens/drft-book', { displayName: 'Book Now', slug: 'book-now', versionId: 'v-book' })
  docs.set('hosts/host-1/screens/drft-book/versions/v-book', { layoutId: 'lay-site', aiJobId: 'job-1' })
}

const OUTPUTS: AiJobOutput[] = [
  { resource: 'seo', id: 'site:listing', hostId: 'host-1', label: 'Listing' },
  { resource: 'screen', id: 'drft-home', hostId: 'host-1', label: 'Home', proposal: { navigation: { label: 'Home', slug: '/' } } },
  { resource: 'screen', id: 'drft-book', hostId: 'host-1', label: 'Book Now', proposal: { navigation: { label: 'Book Now', slug: 'book-now' } } },
]
const JOB = { $id: 'job-1', orgId: 'org-1', hostId: 'host-1' }

const sendSitePublished = jest.fn(async () => ({ sent: true, synthesizedClientId: true }))
const dropCache = jest.fn(async () => ({ dropped: 1, skipped: 0, complete: true }))
const publish = (outputs: AiJobOutput[] = OUTPUTS) =>
  aiPublishGuidedSite(firestore, { job: JOB, outputs, now: NOW }, { sendSitePublished: sendSitePublished as never, dropCache })

beforeEach(() => {
  docs.clear()
  failCommit = false
  sendSitePublished.mockClear()
  dropCache.mockClear()
})

describe('which jobs publish', () => {
  it('a guided site start only', () => {
    expect(aiJobPublishesSite({ kind: 'site', inputs: { autoConfirm: true } })).toBe(true)
    expect(aiJobPublishesSite({ kind: 'site', inputs: {} })).toBe(false)
    expect(aiJobPublishesSite({ kind: 'page', inputs: { autoConfirm: true } })).toBe(false)
  })
})

describe('a guided start’s pages go live', () => {
  it('publishes every page, the home at `/` in place of the untouched starter, and reports site_published once', async () => {
    seedSite()
    const result = await publish()
    expect(result).toEqual({
      liveUrl: 'https://hillside.aglyn.app/',
      published: [
        { id: 'drft-home', label: 'Home', path: '/' },
        { id: 'drft-book', label: 'Book Now', path: '/book-now' },
      ],
      drafts: [],
    })
    const host = docs.get('hosts/host-1') as Record<string, unknown>
    expect(host['screens']).toEqual({ 'drft-home': '/', 'drft-book': 'book-now' })
    expect(host).not.toHaveProperty('defaultHomeScreenId')
    expect(docs.get('hosts/host-1/screens/drft-home')).toMatchObject({ publishedAt: NOW, slug: '/' })
    expect(docs.get('hosts/host-1/screens/drft-book')).toMatchObject({ publishedAt: NOW, slug: 'book-now' })
    // The untouched starter is in the trash, not a second "Home" in Pages.
    expect(docs.get('hosts/host-1/screens/scr-starter')).toMatchObject({ deletedAt: NOW })
    expect(docs.get('hosts/host-1/screens/scr-starter')).not.toHaveProperty('publishedAt')
    expect(sendSitePublished).toHaveBeenCalledTimes(1)
    expect(sendSitePublished).toHaveBeenCalledWith({ hostId: 'host-1', firstPublish: true })
    expect(dropCache).toHaveBeenCalledWith(expect.objectContaining({ hostIds: ['host-1'] }))
    // The cache drop happened, so the announce left nothing for the drain.
    expect([...docs.keys()].filter((key) => key.startsWith('publishOutbox/'))).toEqual([])
  })

  it('adds the pages’ entries to their layout’s header, as a new live version, and moves the home link', async () => {
    seedSite()
    await publish()
    const layout = docs.get('hosts/host-1/layouts/lay-site') as Record<string, unknown>
    expect(layout['versionId']).not.toBe('v-lay')
    const version = docs.get(`hosts/host-1/layouts/lay-site/versions/${layout['versionId']}`) as Record<string, unknown>
    expect(version).toMatchObject({ layoutId: 'lay-site', hostId: 'host-1', aiJobId: 'job-1' })
    const nodes = decodeStoredNodes<Record<string, { componentId?: string; props?: Record<string, unknown>; nodes?: string[] }>>(version['nodes'] as never) ?? {}
    expect(nodes['dl_brand'].props?.['screenId']).toBe('drft-home')
    const toolbar = nodes['dl_toolbar'].nodes ?? []
    expect(toolbar[0]).toBe('dl_brand')
    expect(toolbar[toolbar.length - 1]).toBe('dl_search')
    const added = toolbar.slice(1, -1).map((id) => nodes[id].props)
    // Home is already linked by the brand, now that it points at the new home.
    expect(added).toEqual([expect.objectContaining({ children: 'Book Now', screenId: 'drft-book' })])
    // The old version stays, as every layout publish keeps it.
    expect(docs.has('hosts/host-1/layouts/lay-site/versions/v-lay')).toBe(true)
  })

  it('keeps a starter its owner edited as their draft, off `/`', async () => {
    seedSite({ starterVersions: 2 })
    await publish()
    expect(docs.get('hosts/host-1/screens/scr-starter')).not.toHaveProperty('deletedAt')
    expect(docs.get('hosts/host-1/screens/scr-starter')).not.toHaveProperty('publishedAt')
  })
})

/*
 * Try again on a guided start (AGL-3730): org 1-cho3N4FW's retried Portfolio
 * page (beta.243) stayed a draft with no header entry. A retry publishes only
 * the pages it built, beside what the first publish put live: no home
 * address taken, no starter retired, no second site_published.
 */
describe('a retry puts the pages Try again built live beside the first publish (AGL-3730)', () => {
  const PORTFOLIO: AiJobOutput = {
    resource: 'screen',
    id: 'drft-portfolio',
    hostId: 'host-1',
    label: 'Portfolio',
    proposal: { navigation: { label: 'Portfolio', slug: 'portfolio' } },
  }
  const retry = (outputs: AiJobOutput[]) =>
    aiPublishGuidedSite(firestore, { job: JOB, outputs, now: NOW, retry: true }, { sendSitePublished: sendSitePublished as never, dropCache })

  it('publishes the retried page, adds its header entry, and sends no second site_published', async () => {
    seedSite()
    await publish()
    sendSitePublished.mockClear()
    docs.set('hosts/host-1/screens/drft-portfolio', { displayName: 'Portfolio', slug: 'portfolio', versionId: 'v-port' })
    docs.set('hosts/host-1/screens/drft-portfolio/versions/v-port', { layoutId: 'lay-site', aiJobId: 'job-1' })
    const result = await retry([PORTFOLIO])
    expect(result.published).toEqual([{ id: 'drft-portfolio', label: 'Portfolio', path: '/portfolio' }])
    expect(result.drafts).toEqual([])
    expect(docs.get('hosts/host-1/screens/drft-portfolio')).toMatchObject({ publishedAt: NOW })
    expect((docs.get('hosts/host-1') as Record<string, unknown>)['screens']).toEqual({
      'drft-home': '/',
      'drft-book': 'book-now',
      'drft-portfolio': 'portfolio',
    })
    expect(sendSitePublished).not.toHaveBeenCalled()
    const layout = docs.get('hosts/host-1/layouts/lay-site') as Record<string, unknown>
    const version = docs.get(`hosts/host-1/layouts/lay-site/versions/${layout['versionId']}`) as Record<string, unknown>
    const nodes = decodeStoredNodes<Record<string, { props?: Record<string, unknown>; nodes?: string[] }>>(version['nodes'] as never) ?? {}
    const labels = (nodes['dl_toolbar'].nodes ?? []).map((id) => nodes[id].props?.['children']).filter(Boolean)
    expect(labels).toEqual(['Hillside', 'Book Now', 'Portfolio'])
  })

  it('never takes `/` from the starter nor retires it: a retried home it holds stays a draft', async () => {
    seedSite()
    const result = await retry([OUTPUTS[1]])
    expect(result.published).toEqual([])
    expect(result.drafts).toEqual([{ id: 'drft-home', label: 'Home', reason: aiSitePublishTakenCopy('/') }])
    const host = docs.get('hosts/host-1') as Record<string, unknown>
    expect(host['screens']).toEqual({ 'scr-starter': '/' })
    expect(host['defaultHomeScreenId']).toBe('scr-starter')
    expect(docs.get('hosts/host-1/screens/scr-starter')).not.toHaveProperty('deletedAt')
    expect(sendSitePublished).not.toHaveBeenCalled()
  })

  it('merges the retry into the first record: published joined, drafts that went live dropped, newest reasons kept', () => {
    const first = {
      liveUrl: 'https://hillside.aglyn.app/',
      published: [{ id: 'drft-home', label: 'Home', path: '/' }],
      drafts: [
        { id: 'drft-book', label: 'Book Now', reason: 'It could not be published just now. Publish it from Pages.' },
        { id: 'drft-old', label: 'Old', reason: AI_SITE_PUBLISH_DELETED },
      ],
    }
    const retried = {
      liveUrl: null,
      published: [{ id: 'drft-book', label: 'Book Now', path: '/book-now' }],
      drafts: [{ id: 'drft-portfolio', label: 'Portfolio', reason: aiSitePublishTakenCopy('portfolio') }],
    }
    expect(aiMergeSitePublish(first, retried)).toEqual({
      liveUrl: 'https://hillside.aglyn.app/',
      published: [
        { id: 'drft-home', label: 'Home', path: '/' },
        { id: 'drft-book', label: 'Book Now', path: '/book-now' },
      ],
      drafts: [
        { id: 'drft-old', label: 'Old', reason: AI_SITE_PUBLISH_DELETED },
        { id: 'drft-portfolio', label: 'Portfolio', reason: aiSitePublishTakenCopy('portfolio') },
      ],
    })
  })
})

describe('a page that cannot go live stays a draft, and the rest still publish', () => {
  it('names the page and why, and never fails the publish for it', async () => {
    seedSite()
    docs.set('hosts/host-1', { ...docs.get('hosts/host-1'), screens: { 'scr-starter': '/', 'scr-owner': 'book-now' } })
    docs.set('hosts/host-1/screens/drft-gone', { displayName: 'Gone', slug: 'gone', deletedAt: NOW })
    const result = await publish([
      ...OUTPUTS,
      { resource: 'screen', id: 'drft-gone', hostId: 'host-1', label: 'Gone' },
    ])
    expect(result.published.map((page) => page.id)).toEqual(['drft-home'])
    expect(result.drafts).toEqual([
      { id: 'drft-book', label: 'Book Now', reason: aiSitePublishTakenCopy('book-now') },
      { id: 'drft-gone', label: 'Gone', reason: AI_SITE_PUBLISH_DELETED },
    ])
    expect((docs.get('hosts/host-1') as Record<string, unknown>)['screens']).toEqual({ 'drft-home': '/', 'scr-owner': 'book-now' })
    expect(sendSitePublished).toHaveBeenCalledTimes(1)
  })

  it('reports every page as a draft when the publish write itself fails, and sends nothing', async () => {
    seedSite()
    failCommit = true
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await publish()
    expect(result.published).toEqual([])
    expect(result.drafts.map((page) => page.id)).toEqual(['drft-home', 'drft-book'])
    expect(sendSitePublished).not.toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('aiLayoutWithNavigation', () => {
  /*
   * AGL-3747: the start's header entries went in through code of their own —
   * straight into the first Toolbar, beside the `nav` row rather than in it,
   * and never into the phone menu. They now go in through the navigation op's
   * `aiLayoutWithMenuChanges`, as Assist's menu changes do.
   */
  it('adds the entries the way the navigation op does: in the bar’s menu and the phone menu, after their items, like their neighbours (AGL-3747)', () => {
    const close = [{ trigger: 'click', action: 'closeDrawer' }]
    const link = (parentId: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
      componentId: 'muiScreenLink',
      pluginId: 'mui',
      parentId,
      props: { renderAs: 'link', color: 'inherit', ...props },
      sx: { textDecoration: 'none', fontWeight: 500 },
      nodes: [],
      ...extra,
    })
    const nodes = {
      root: { componentId: 'div', nodes: ['bar'] },
      bar: { componentId: 'muiAppBar', parentId: 'root', nodes: ['toolbar'] },
      toolbar: { componentId: 'muiToolbar', parentId: 'bar', nodes: ['ll-brand', 'nav', 'cta', 'drawer'] },
      'll-brand': link('toolbar', { children: 'Hillside', screenId: 'drft-home' }),
      nav: { componentId: 'muiStack', parentId: 'toolbar', props: { component: 'nav' }, nodes: ['n-home', 'n-about'] },
      'n-home': link('nav', { children: 'Home', screenId: 'drft-home' }),
      'n-about': link('nav', { children: 'About', screenId: 'drft-about' }),
      cta: { componentId: 'muiButton', parentId: 'toolbar', props: { children: 'Book' } },
      drawer: { componentId: 'muiDrawer', parentId: 'toolbar', nodes: ['menu'] },
      menu: { componentId: 'muiStack', parentId: 'drawer', props: { component: 'nav' }, nodes: ['m-home', 'm-about'] },
      'm-home': link('menu', { children: 'Home', screenId: 'drft-home' }, { interactions: close }),
      'm-about': link('menu', { children: 'About', screenId: 'drft-about' }, { interactions: close }),
    }
    const next = aiLayoutWithNavigation(nodes as never, {
      entries: [
        { screenId: 'drft-home', label: 'Home' },
        { screenId: 'drft-book', label: 'Book Now' },
        // An item of that name is already in the menu, linking elsewhere: not a second one.
        { screenId: 'drft-about-2', label: 'About' },
        { screenId: 'drft-gallery', label: 'Gallery' },
      ],
    }) as unknown as Record<string, { props?: Record<string, unknown>; nodes?: string[]; interactions?: unknown }>
    const labels = (id: string) => (next[id].nodes ?? []).map((child) => next[child].props?.['children'])
    expect(labels('nav')).toEqual(['Home', 'About', 'Book Now', 'Gallery'])
    expect(labels('menu')).toEqual(['Home', 'About', 'Book Now', 'Gallery'])
    // Nothing beside the menu: the brand, the call to action and the drawer stay where they were.
    expect(next['toolbar'].nodes).toEqual(['ll-brand', 'nav', 'cta', 'drawer'])
    const added = (next['menu'].nodes ?? []).slice(2).map((id) => next[id])
    expect(added.map((node) => node.props?.['screenId'])).toEqual(['drft-book', 'drft-gallery'])
    // A phone menu's link closes the menu when followed, as its neighbours do.
    expect(added.every((node) => JSON.stringify(node.interactions) === JSON.stringify(close))).toBe(true)
    expect((next['nav'].nodes ?? []).slice(2).every((id) => /^ai_nav_/.test(id))).toBe(true)
  })

  it('changes nothing when every entry is already linked and no home moved', () => {
    expect(aiLayoutWithNavigation(STARTER_LAYOUT as never, { entries: [{ screenId: 'scr-starter', label: 'Home' }] })).toBeNull()
  })

  it('takes out every link to a blog whose posts were not written — header, phone menu, footer — and keeps the rest (AGL-3660)', () => {
    const link = (parentId: string, props: Record<string, unknown>) => ({ componentId: 'muiScreenLink', pluginId: 'mui', parentId, props: { renderAs: 'link', ...props }, nodes: [] })
    const nodes = {
      root: { componentId: 'muiBox', nodes: ['bar', 'menu', 'footer'] },
      bar: { componentId: 'muiToolbar', nodes: ['home', 'blog', 'about'] },
      home: link('bar', { children: 'Home', screenId: 'scr-home' }),
      blog: link('bar', { children: 'Blog', href: '/blog' }),
      about: link('bar', { children: 'About', screenId: 'scr-about' }),
      menu: { componentId: 'muiStack', props: { component: 'nav' }, nodes: ['menuBlog', 'menuAbout'] },
      menuBlog: link('menu', { children: 'Blog', href: '/blog' }),
      menuAbout: link('menu', { children: 'About', screenId: 'scr-about' }),
      footer: { componentId: 'muiStack', nodes: ['footBlog', 'footSite'] },
      footBlog: link('footer', { children: 'Blog', href: '/blog' }),
      // A link the brief gave, which is no blog.
      footSite: link('footer', { children: 'Our shop', href: 'https://example.com/shop', target: '_blank' }),
    }
    const kept = aiLayoutWithNavigation(nodes as never, { entries: [], droppedHrefs: aiSiteUnwrittenBlogHrefs(true) }) as unknown as Record<string, { nodes?: string[] }>
    expect(Object.keys(kept).filter((id) => /blog/i.test(id))).toEqual([])
    expect([kept['bar'].nodes, kept['menu'].nodes, kept['footer'].nodes]).toEqual([['home', 'about'], ['menuAbout'], ['footSite']])
    // A blog that was written keeps its links, and so does a layout that has none.
    expect(aiSiteUnwrittenBlogHrefs(false)).toEqual([])
    expect(aiLayoutWithNavigation(nodes as never, { entries: [], droppedHrefs: aiSiteUnwrittenBlogHrefs(false) })).toBeNull()
    expect(aiLayoutWithNavigation(STARTER_LAYOUT as never, { entries: [], droppedHrefs: aiSiteUnwrittenBlogHrefs(true) })).toBeNull()
  })
})

/*
 * AGL-3747: a start whose posts part failed published with every link to the
 * blog taken out (AGL-3660); once Try again's posts are live, the header
 * links the blog again, through the navigation op's code.
 */
describe('the blog’s header entry, put back once Try again’s posts are live (AGL-3747)', () => {
  const BLOG = { label: 'Blog', href: '/blog' }
  const link = (parentId: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    componentId: 'muiScreenLink',
    pluginId: 'mui',
    parentId,
    props: { renderAs: 'link', color: 'inherit', ...props },
    nodes: [],
    ...extra,
  })
  const close = [{ trigger: 'click', action: 'closeDrawer' }]
  const frame = () => ({
    root: { componentId: 'div', nodes: ['bar', 'footer'] },
    bar: { componentId: 'muiAppBar', parentId: 'root', nodes: ['toolbar'] },
    toolbar: { componentId: 'muiToolbar', parentId: 'bar', nodes: ['ll-brand', 'nav', 'drawer'] },
    'll-brand': link('toolbar', { children: 'Clay Notes', screenId: 'drft-home' }),
    nav: { componentId: 'muiStack', parentId: 'toolbar', props: { component: 'nav' }, nodes: ['n-home', 'n-about', 'n-contact'] },
    'n-home': link('nav', { children: 'Home', screenId: 'drft-home' }),
    'n-about': link('nav', { children: 'About', screenId: 'drft-about' }),
    'n-contact': link('nav', { children: 'Contact', screenId: 'drft-contact' }),
    drawer: { componentId: 'muiDrawer', parentId: 'toolbar', nodes: ['menu'] },
    menu: { componentId: 'muiStack', parentId: 'drawer', props: { component: 'nav' }, nodes: ['m-home', 'm-about'] },
    'm-home': link('menu', { children: 'Home', screenId: 'drft-home' }, { interactions: close }),
    'm-about': link('menu', { children: 'About', screenId: 'drft-about' }, { interactions: close }),
    footer: { componentId: 'section', parentId: 'root', props: { element: 'footer' }, nodes: [] },
  })
  type Out = Record<string, { props?: Record<string, unknown>; nodes?: string[]; interactions?: unknown }>
  const labels = (nodes: Out, id: string) => (nodes[id].nodes ?? []).map((child) => nodes[child].props?.['children'])

  it('adds it second, after the home page’s item, to the bar’s menu and the phone menu', () => {
    const next = aiLayoutWithBlogEntry(frame() as never, { blog: BLOG, homeId: 'drft-home' }) as unknown as Out
    expect(labels(next, 'nav')).toEqual(['Home', 'Blog', 'About', 'Contact'])
    expect(labels(next, 'menu')).toEqual(['Home', 'Blog', 'About'])
    const blog = next[(next['menu'].nodes ?? [])[1]]
    expect(blog.props).toMatchObject({ children: 'Blog', href: '/blog' })
    expect(blog.props).not.toHaveProperty('screenId')
    expect(blog.interactions).toEqual(close)
  })

  it('goes last where no item opens the home page', () => {
    const next = aiLayoutWithBlogEntry(frame() as never, { blog: BLOG, homeId: 'drft-elsewhere' }) as unknown as Out
    // Home's item links the page by id, and `/` by address is not among them either.
    expect(labels(next, 'nav')).toEqual(['Home', 'About', 'Contact', 'Blog'])
  })

  it('changes nothing where a link already opens the blog, at any of its addresses', () => {
    const linked = { ...frame(), 'n-blog': link('nav', { children: 'Journal', href: '/journal' }) }
    linked.nav = { ...linked.nav, nodes: [...linked.nav.nodes, 'n-blog'] }
    expect(aiLayoutWithBlogEntry(linked as never, { blog: { label: 'Blog', href: '/journal' }, homeId: 'drft-home' })).toBeNull()
    const footer = { ...frame(), 'f-blog': link('footer', { children: 'Blog', href: '/blog' }) }
    expect(aiLayoutWithBlogEntry(footer as never, { blog: BLOG, homeId: 'drft-home' })).toBeNull()
  })

  it('writes it as a new live version of the pages’ layout, announces the change, and does it once', async () => {
    seedSite()
    const restore = () =>
      aiRestoreGuidedBlogEntry(firestore, { job: JOB, pageIds: ['drft-home', 'drft-book'], homeId: 'drft-home', blog: BLOG, now: NOW }, { dropCache })
    expect(await restore()).toBe(true)
    const layout = docs.get('hosts/host-1/layouts/lay-site') as Record<string, unknown>
    expect(layout['versionId']).not.toBe('v-lay')
    const version = docs.get(`hosts/host-1/layouts/lay-site/versions/${layout['versionId']}`) as Record<string, unknown>
    expect(version).toMatchObject({ layoutId: 'lay-site', hostId: 'host-1', aiJobId: 'job-1', displayName: 'Navigation for the blog' })
    const nodes = decodeStoredNodes<Out>(version['nodes'] as never) ?? {}
    // The starter's header: after the brand, before the search.
    const toolbar = nodes['dl_toolbar'].nodes ?? []
    expect(toolbar.map((id) => nodes[id].props?.['children'] ?? id)).toEqual(['Hillside', 'Blog', 'dl_search'])
    expect(dropCache).toHaveBeenCalledWith(expect.objectContaining({ hostIds: ['host-1'] }))
    expect([...docs.keys()].filter((key) => key.startsWith('publishOutbox/'))).toEqual([])
    // A later retry finds the blog linked, and writes nothing.
    expect(await restore()).toBe(false)
    expect((docs.get('hosts/host-1/layouts/lay-site') as Record<string, unknown>)['versionId']).toBe(layout['versionId'])
  })

  it('writes nothing where the pages share no one layout', async () => {
    seedSite()
    docs.set('hosts/host-1/screens/drft-book/versions/v-book', { layoutId: 'lay-other', aiJobId: 'job-1' })
    expect(await aiRestoreGuidedBlogEntry(firestore, { job: JOB, pageIds: ['drft-home', 'drft-book'], blog: BLOG, now: NOW }, { dropCache })).toBe(false)
    expect((docs.get('hosts/host-1/layouts/lay-site') as Record<string, unknown>)['versionId']).toBe('v-lay')
  })
})
