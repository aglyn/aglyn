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
import { siteLanguageCode } from '@aglyn/aglyn/app-utils/seo-locale'
import { AI_BUILD_PLAN_TOOL, aiBuildPlanToolFor, parseAiBuildPlan } from '../model/ai-build-plan'
import type { AiJobOutput } from '../model/ai-jobs.types'
import { aiSiteSeoProposalOf } from '../model/ai-site-start-seo'
import { defaultSiteSeo } from '@aglyn/aglyn/app-utils/default-site'
import { aiSiteSeoOutputs } from './ai-job-site-step'
import {
  AI_SITE_PUBLISH_DELETED,
  aiSiteLanguageUpdates,
  aiJobPublishesSite,
  aiLayoutWithBlogEntry,
  aiLayoutWithNavigation,
  aiMergeSitePublish,
  aiPageWithoutLinksTo,
  aiPublishGuidedSite,
  aiRestoreGuidedBlogEntry,
  aiSiteUnwrittenBlogHrefs,
  aiSitePublishTakenCopy,
  aiSiteShareImageOpen,
  aiSiteSharePhoto,
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
  // A draft's tree changed in place, as `updateAiDraftNodes` asks (AGL-3988).
  runTransaction: async (run: (tx: unknown) => Promise<unknown>) =>
    run({
      get: async (ref: { path: string }) => snapshot(ref.path),
      update: (ref: { path: string }, data: Record<string, unknown>) => apply(ref.path, data, 'update'),
    }),
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

describe('the site publishes in the language its brief was written in (AGL-3750)', () => {
  /** A site plan's answer, as the model sends it, read the way the plan step reads it. */
  const planned = (language: unknown) => {
    const parsed = parseAiBuildPlan({ reuse: [], create: [], screens: [], language })
    if (parsed.ok === false) throw new Error(parsed.error)
    return parsed
  }
  const publishIn = (language: string | undefined) =>
    aiPublishGuidedSite(
      firestore,
      { job: JOB, outputs: OUTPUTS, now: NOW, ...(language ? { language } : {}) },
      { sendSitePublished: sendSitePublished as never, dropCache },
    )

  it('offers the language field to a site plan only, the same bytes for every brief', () => {
    const site = aiBuildPlanToolFor('Un sitio web para una panadería en Madrid.', { language: true })
    const other = aiBuildPlanToolFor('A website for a bakery in Tulsa.', { language: true })
    expect(site.inputSchema['required']).toContain('language')
    expect(JSON.stringify(site)).toBe(JSON.stringify(other))
    const page = aiBuildPlanToolFor('Un sitio web para una panadería en Madrid.')
    expect(page).toBe(AI_BUILD_PLAN_TOOL)
    expect(page.inputSchema['properties']).not.toHaveProperty('language')
  })

  it('a Spanish brief: the plan says es, and the new site publishes in es', async () => {
    const { plan } = planned('es')
    expect(plan.language).toBe('es')
    seedSite()
    await publishIn(plan.language)
    expect(docs.get('hosts/host-1')).toMatchObject({ locales: ['es'], defaultLocale: 'es' })
    // `<html lang>` is on every page, so the whole site's cache goes.
    expect(dropCache).toHaveBeenCalledWith(expect.not.objectContaining({ paths: expect.anything() }))
  })

  it('an English brief leaves a new site as it is', async () => {
    const { plan } = planned('en')
    expect(plan.language).toBe('en')
    seedSite()
    await publishIn(plan.language)
    expect(docs.get('hosts/host-1')).not.toHaveProperty('locales')
    expect(docs.get('hosts/host-1')).not.toHaveProperty('defaultLocale')
  })

  it('a plan that says null, or no code at all, keeps the plan and the site’s language', async () => {
    expect(planned(null).plan).not.toHaveProperty('language')
    const invalid = planned('Spanish')
    expect(invalid.plan).not.toHaveProperty('language')
    expect(invalid.repairs).toEqual(['language "Spanish" is not a language code; ignored'])
    expect(planned('es-419').plan).not.toHaveProperty('language')
    seedSite()
    await publishIn('Spanish')
    expect(docs.get('hosts/host-1')).not.toHaveProperty('locales')
    expect(docs.get('hosts/host-1')).not.toHaveProperty('defaultLocale')
  })

  it('reads a code the way the Languages card stores it', () => {
    expect(siteLanguageCode('pt_br')).toBe('pt-BR')
    expect(siteLanguageCode('ZH-hant')).toBe('zh-Hant')
    expect(siteLanguageCode(' fr ')).toBe('fr')
    expect(siteLanguageCode('spa')).toBeNull()
    expect(siteLanguageCode(3)).toBeNull()
  })

  it('replaces a site’s one language, and never touches a multilingual site', async () => {
    expect(aiSiteLanguageUpdates({ locales: ['en'], defaultLocale: 'en' }, 'es')).toEqual({ locales: ['es'], defaultLocale: 'es' })
    expect(aiSiteLanguageUpdates({ locales: ['es'] }, 'es')).toBeNull()
    expect(aiSiteLanguageUpdates({ locales: ['en', 'fr'], defaultLocale: 'en' }, 'es')).toBeNull()
    expect(aiSiteLanguageUpdates({ locales: ['en', 'es'], defaultLocale: 'en' }, 'es')).toBeNull()
    seedSite()
    docs.set('hosts/host-1', { ...docs.get('hosts/host-1'), locales: ['en', 'fr'], defaultLocale: 'en' })
    await publishIn('es')
    expect(docs.get('hosts/host-1')).toMatchObject({ locales: ['en', 'fr'], defaultLocale: 'en' })
  })
})

/*
 * The beta.270 Sugar Hollow Photography start (AGL-3988): its Galleries page
 * was refused by its checks, and the published home page still linked it
 * from "See the galleries", from the "View all galleries" button under its
 * gallery band and from the header, all to a 404; its 404 page listed the
 * pages alphabetically.
 */
describe('a page the start did not build is linked from nowhere (AGL-3988)', () => {
  const LAYOUT = {
    root: { $id: 'root', componentId: 'div', nodes: ['h_bar'] },
    h_bar: { $id: 'h_bar', componentId: 'muiAppBar', parentId: 'root', nodes: ['h_nav'] },
    h_nav: { $id: 'h_nav', componentId: 'muiStack', parentId: 'h_bar', nodes: ['h_home', 'h_galleries', 'h_book'] },
    h_home: { $id: 'h_home', componentId: 'muiScreenLink', parentId: 'h_nav', props: { children: 'Home', screenId: 'drft-home' }, nodes: [] },
    h_galleries: { $id: 'h_galleries', componentId: 'muiScreenLink', parentId: 'h_nav', props: { children: 'Galleries', screenId: 'drft-galleries' }, nodes: [] },
    h_book: { $id: 'h_book', componentId: 'muiScreenLink', parentId: 'h_nav', props: { children: 'Book Now', screenId: 'drft-book' }, nodes: [] },
  }
  const HOME = {
    root: { $id: 'root', componentId: 'div', nodes: ['sec-0', 'sec-1'] },
    'sec-0': { $id: 'sec-0', componentId: 'section', parentId: 'root', nodes: ['hero_title', 'hero_buttons'] },
    hero_title: { $id: 'hero_title', componentId: 'muiTypography', parentId: 'sec-0', props: { children: 'Sugar Hollow Photography' }, nodes: [] },
    hero_buttons: { $id: 'hero_buttons', componentId: 'muiStack', parentId: 'sec-0', nodes: ['hero_book', 'hero_galleries'] },
    hero_book: { $id: 'hero_book', componentId: 'muiScreenLink', parentId: 'hero_buttons', props: { children: 'Book a session', screenId: 'drft-book' }, nodes: [] },
    hero_galleries: { $id: 'hero_galleries', componentId: 'muiScreenLink', parentId: 'hero_buttons', props: { children: 'See the galleries', screenId: 'drft-galleries' }, nodes: [] },
    'sec-1': { $id: 'sec-1', componentId: 'section', parentId: 'root', nodes: ['band_title', 'band_cover', 'band_more'] },
    band_title: { $id: 'band_title', componentId: 'muiTypography', parentId: 'sec-1', props: { children: 'Galleries by subject' }, nodes: [] },
    band_cover: { $id: 'band_cover', componentId: 'image', parentId: 'sec-1', props: { src: 'media:h/1', alt: 'A couple', screenId: 'drft-galleries' }, nodes: [] },
    band_more: { $id: 'band_more', componentId: 'muiStack', parentId: 'sec-1', nodes: ['band_all'] },
    band_all: { $id: 'band_all', componentId: 'muiScreenLink', parentId: 'band_more', props: { children: 'View all galleries', screenId: 'drft-galleries' }, nodes: [] },
  }
  const stored = (nodes: unknown) => Buffer.from(encodeStoredNodes(nodes as never) as Uint8Array)

  function seedSugarHollow() {
    seedSite()
    docs.set('hosts/host-1/layouts/lay-site/versions/v-lay', { layoutId: 'lay-site', nodes: stored(LAYOUT) })
    docs.set('hosts/host-1/screens/drft-home/versions/v-home', { layoutId: 'lay-site', aiJobId: 'job-1', nodes: stored(HOME) })
    // The refused page's draft is on the site, never live.
    docs.set('hosts/host-1/screens/drft-galleries', { displayName: 'Galleries', slug: 'galleries', versionId: 'v-gal' })
    // The owner already placed Book Now in Pages.
    docs.set('hosts/host-1/screens/drft-book', { ...docs.get('hosts/host-1/screens/drft-book'), order: 7 })
  }
  const publishSugarHollow = () =>
    aiPublishGuidedSite(
      firestore,
      { job: JOB, outputs: OUTPUTS, now: NOW, unbuiltScreenIds: ['drft-galleries'], siteOrder: ['drft-home', 'drft-galleries', 'drft-book'] },
      { sendSitePublished: sendSitePublished as never, dropCache },
    )
  const nodesAt = (path: string) => decodeStoredNodes<Record<string, { componentId?: string; props?: Record<string, unknown>; nodes?: string[] }>>(docs.get(path)?.['nodes'] as never) ?? {}

  it('takes every link to it out of the published pages, and the frames left holding none', async () => {
    seedSugarHollow()
    const result = await publishSugarHollow()
    expect(result.published.map((page) => page.id)).toEqual(['drft-home', 'drft-book'])
    const home = nodesAt('hosts/host-1/screens/drft-home/versions/v-home')
    const links = Object.values(home).filter((node) => node.props?.['screenId'] === 'drft-galleries')
    expect(links).toEqual([])
    // "See the galleries" goes; "Book a session" beside it stays.
    expect(home['hero_buttons']?.nodes).toEqual(['hero_book'])
    // "View all galleries" was all its row held: the row goes with it, never the band.
    expect(home['band_more']).toBeUndefined()
    expect(home['sec-1']?.nodes).toEqual(['band_title', 'band_cover'])
    // The cover keeps its place and its photo, and opens nothing.
    expect(home['band_cover']?.props).toEqual({ src: 'media:h/1', alt: 'A couple' })
  })

  it('takes it out of the header every page shares', async () => {
    seedSugarHollow()
    await publishSugarHollow()
    const layout = docs.get('hosts/host-1/layouts/lay-site') as Record<string, unknown>
    const live = nodesAt(`hosts/host-1/layouts/lay-site/versions/${String(layout['versionId'])}`)
    const header = live['h_nav']?.nodes ?? []
    expect(header.map((id) => live[id]?.props?.['children'])).toEqual(['Home', 'Book Now'])
  })

  it('places each page in Pages in the site’s order, where the owner has not, for the 404 page’s links', async () => {
    seedSugarHollow()
    await publishSugarHollow()
    expect(docs.get('hosts/host-1/screens/drft-home')).toMatchObject({ order: 0 })
    expect(docs.get('hosts/host-1/screens/drft-book')).toMatchObject({ order: 7 })
  })

  it('changes nothing on a page that links none', () => {
    expect(aiPageWithoutLinksTo(HOME as never, ['drft-unknown'])).toBeNull()
    expect(aiPageWithoutLinksTo(HOME as never, [])).toBeNull()
  })

  it('takes out a link to a page this publish leaves a draft, too', async () => {
    seedSugarHollow()
    // Book Now's address is taken by another live page, so it stays a draft.
    docs.set('hosts/host-1', { ...docs.get('hosts/host-1'), screens: { 'scr-starter': '/', 'scr-other': 'book-now' } })
    const result = await publishSugarHollow()
    expect(result.drafts.map((page) => page.id)).toEqual(['drft-book'])
    const home = nodesAt('hosts/host-1/screens/drft-home/versions/v-home')
    expect(Object.values(home).some((node) => node.props?.['screenId'] === 'drft-book')).toBe(false)
  })
})

/*
 * Who publishes the site (AGL-3979): the start's answers fill the host's
 * Setup -> SEO -> Entity and AI agents fields in the publish's own batch, only
 * where empty, and the announce asks for the whole site, since every page
 * carries the entity.
 */
describe('a guided start fills the site’s Entity and AI-agent fields (AGL-3979)', () => {
  const DETAILED = {
    ...JOB,
    inputs: {
      businessType: 'a family plumbing company',
      siteKind: 'trades',
      businessName: 'Pipeworks',
      city: 'Austin',
      phone: '(512) 555-0142',
      email: 'hello@pipeworks.co',
      hours: 'Mo-Fr 08:00-18:00',
      social: 'https://instagram.com/pipeworks',
    },
  }

  it('writes the business type, phone, email, hours, profiles and guidance, and announces the whole site', async () => {
    seedSite()
    docs.set('hosts/host-1', { ...docs.get('hosts/host-1'), seo: { title: 'Pipeworks', entity: { telephone: '(512) 555-9999' } } })
    dropCache.mockResolvedValueOnce({ dropped: 0, skipped: 0, complete: false })
    await aiPublishGuidedSite(firestore, { job: DETAILED, outputs: OUTPUTS, now: NOW }, { sendSitePublished: sendSitePublished as never, dropCache })
    const seo = (docs.get('hosts/host-1') as Record<string, Record<string, Record<string, unknown>>>)['seo']
    expect(seo['title']).toBe('Pipeworks')
    expect(seo['entity']).toMatchObject({
      name: 'Pipeworks',
      // The owner's own number is kept.
      telephone: '(512) 555-9999',
      email: 'hello@pipeworks.co',
      businessType: 'Plumber',
      areaServed: ['Austin'],
      openingHours: 'Mo-Fr 08:00-18:00',
      sameAs: ['https://instagram.com/pipeworks'],
    })
    expect(seo['entity']).toMatchObject({ contactType: 'customer support' })
    expect(seo['agent']).toMatchObject({ whenToUse: expect.stringContaining('Pipeworks'), howToUse: expect.stringContaining('hello@pipeworks.co') })
    // The Business details card's support email, which a form that cannot take a message names.
    expect((docs.get('hosts/host-1') as Record<string, unknown>)['business']).toEqual({ supportEmail: 'hello@pipeworks.co' })
    const outbox = [...docs.entries()].filter(([key]) => key.startsWith('publishOutbox/')).map(([, value]) => value)
    expect(outbox).toEqual([expect.objectContaining({ entireHost: true })])
  })

  it('a job with no inputs writes no Entity field', async () => {
    seedSite()
    await publish()
    expect((docs.get('hosts/host-1') as Record<string, unknown>)['seo']).toBeUndefined()
    expect((docs.get('hosts/host-1') as Record<string, unknown>)['business']).toBeUndefined()
  })

  it('names the site’s own logo as the Entity logo', async () => {
    seedSite()
    docs.set('hosts/host-1', { ...docs.get('hosts/host-1'), logoUrl: 'media:host-1/logo' })
    await aiPublishGuidedSite(firestore, { job: DETAILED, outputs: OUTPUTS, now: NOW }, { sendSitePublished: sendSitePublished as never, dropCache })
    const seo = (docs.get('hosts/host-1') as Record<string, Record<string, Record<string, unknown>>>)['seo']
    expect(seo['entity']['logo']).toBe('media:host-1/logo')
  })
})

/*
 * The site's own listing (AGL-3979): the publish writes the start's title and
 * description over the ones the site was created with, never over an owner's,
 * and the SEO section's offer of the start's listing stays for a site whose
 * owner changed theirs.
 */
describe('a guided start’s listing goes over the seeded default only (AGL-3979)', () => {
  const NAME = 'Hillside Dog Grooming'
  const STARTED = { ...JOB, inputs: { businessType: 'a neighborhood dog groomer', audience: 'busy dog owners', city: 'Austin', siteKind: 'business' } }
  const seedNamed = (seo: Record<string, unknown>) => {
    seedSite()
    docs.set('hosts/host-1', { ...docs.get('hosts/host-1'), displayName: NAME, seo })
  }
  const run = (retry = false) =>
    aiPublishGuidedSite(
      firestore,
      { job: STARTED as never, outputs: OUTPUTS, now: NOW, ...(retry ? { retry: true } : {}) },
      { sendSitePublished: sendSitePublished as never, dropCache },
    )
  const seoOf = () => (docs.get('hosts/host-1') as { seo: Record<string, unknown> }).seo
  /** The listing the job reports, as the SEO section offers it. */
  const reported = () => aiSiteSeoProposalOf(aiSiteSeoOutputs(STARTED as never, NAME))

  it('writes the start’s listing, with the site’s name, over the default the site was created with', async () => {
    seedNamed(defaultSiteSeo(NAME))
    dropCache.mockResolvedValueOnce({ dropped: 0, skipped: 0, complete: false })
    await run()
    const listing = reported()
    expect(seoOf()['title']).toBe(listing?.values['seo.title'])
    expect(seoOf()['title']).toMatch(/^Hillside Dog Grooming — /)
    expect(seoOf()['description']).toBe(listing?.values['seo.description'])
    // The sharing image the site was created with stays.
    expect(seoOf()['image']).toBe(defaultSiteSeo(NAME)['image'])
    const outbox = [...docs.entries()].filter(([key]) => key.startsWith('publishOutbox/')).map(([, value]) => value)
    expect(outbox).toEqual([expect.objectContaining({ entireHost: true })])
  })

  it('leaves a listing the owner changed as they wrote it, and the start’s is still offered', async () => {
    seedNamed({ ...defaultSiteSeo(NAME), title: 'Hillside Grooming | Austin dog spa', description: 'Gentle grooming for nervous dogs since 2009.' })
    await run()
    expect(seoOf()).toMatchObject({ title: 'Hillside Grooming | Austin dog spa', description: 'Gentle grooming for nervous dogs since 2009.' })
    const listing = reported()
    expect(listing).not.toBeNull()
    expect(listing?.values['seo.title']).not.toBe(seoOf()['title'])
  })

  it('is stable when Try again publishes again', async () => {
    seedNamed(defaultSiteSeo(NAME))
    await run()
    const first = { ...seoOf() }
    await run(true)
    expect(seoOf()['title']).toBe(first['title'])
    expect(seoOf()['description']).toBe(first['description'])
  })
})

/*
 * The beta.271 Laurel Fork start (AGL-3988) shared the office team the site
 * was created with on every link: nothing set the share image from what the
 * start built.
 */
describe('a guided start’s share image is its home hero’s photo (AGL-3988)', () => {
  const NAME = 'Laurel Fork Photography'
  const stored = (nodes: unknown) => Buffer.from(encodeStoredNodes(nodes as never) as Uint8Array)
  const image = (id: string, parentId: string, src: string, width: number, height: number, alt: string) => ({
    $id: id,
    componentId: 'image',
    parentId,
    props: { src, intrinsicWidth: width, intrinsicHeight: height, alt },
    nodes: [],
  })
  /** A home page: its hero's photo in its first section, a tall photo below. */
  const HOME = {
    '_@_': { $id: '_@_', componentId: 'div', nodes: ['sec-1', 'sec-2'] },
    'sec-1': { $id: 'sec-1', componentId: 'section', parentId: '_@_', nodes: ['frame-1'] },
    'frame-1': { $id: 'frame-1', componentId: 'muiBox', parentId: 'sec-1', nodes: ['hero'] },
    hero: image('hero', 'frame-1', 'media:host-1/couple01', 1280, 720, 'A couple at a wedding'),
    'sec-2': { $id: 'sec-2', componentId: 'section', parentId: '_@_', nodes: ['tall'] },
    tall: image('tall', 'sec-2', 'media:host-1/family01', 853, 1280, 'A family in the mountains'),
  }
  const seedShared = (seo: Record<string, unknown>, home: unknown = HOME) => {
    seedSite()
    docs.set('hosts/host-1', { ...docs.get('hosts/host-1'), displayName: NAME, seo })
    docs.set('hosts/host-1/screens/drft-home/versions/v-home', { layoutId: 'lay-site', aiJobId: 'job-1', nodes: stored(home) })
  }
  const seoOf = () => (docs.get('hosts/host-1') as { seo: Record<string, unknown> }).seo

  it('sets it over the starter the site was created with: the hero’s photo, its size and its words, for the whole site', async () => {
    seedShared(defaultSiteSeo(NAME))
    expect(aiSiteShareImageOpen(defaultSiteSeo(NAME))).toBe(true)
    dropCache.mockResolvedValueOnce({ dropped: 0, skipped: 0, complete: false })
    await publish()
    expect(seoOf()).toMatchObject({ image: 'media:host-1/couple01', imageWidth: 1280, imageHeight: 720, imageAlt: 'A couple at a wedding' })
    const outbox = [...docs.entries()].filter(([key]) => key.startsWith('publishOutbox/')).map(([, value]) => value)
    expect(outbox).toEqual([expect.objectContaining({ entireHost: true })])
  })

  it('takes the widest photo the pages show where the home page’s first section shows none', async () => {
    const noHero = { ...HOME, 'frame-1': { ...HOME['frame-1'], nodes: [] } }
    seedShared(defaultSiteSeo(NAME), noHero)
    docs.set('hosts/host-1/screens/drft-book/versions/v-book', {
      layoutId: 'lay-site',
      aiJobId: 'job-1',
      nodes: stored({
        '_@_': { $id: '_@_', componentId: 'div', nodes: ['sec-1'] },
        'sec-1': { $id: 'sec-1', componentId: 'section', parentId: '_@_', nodes: ['wide'] },
        wide: image('wide', 'sec-1', 'media:host-1/aisle01', 1280, 854, 'An aisle at a wedding'),
      }),
    })
    await publish()
    expect(seoOf()['image']).toBe('media:host-1/aisle01')
  })

  it('never replaces an image the owner picked, and changes nothing where the pages show no library photo', async () => {
    seedShared({ ...defaultSiteSeo(NAME), image: 'media:host-1/owner01', imageWidth: 1200, imageHeight: 630, imageAlt: 'Our studio' })
    await publish()
    expect(seoOf()).toMatchObject({ image: 'media:host-1/owner01', imageAlt: 'Our studio' })
    docs.clear()
    seedShared(defaultSiteSeo(NAME), { '_@_': { $id: '_@_', componentId: 'div', nodes: [] } })
    await publish()
    expect(seoOf()['image']).toBe(defaultSiteSeo(NAME)['image'])
    expect(aiSiteSharePhoto(null, [])).toBeNull()
  })
})
