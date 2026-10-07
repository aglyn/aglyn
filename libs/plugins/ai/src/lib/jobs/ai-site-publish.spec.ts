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
  aiLayoutWithNavigation,
  aiPublishGuidedSite,
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
  it('changes nothing when every entry is already linked and no home moved', () => {
    expect(aiLayoutWithNavigation(STARTER_LAYOUT as never, { entries: [{ screenId: 'scr-starter', label: 'Home' }] })).toBeNull()
  })
})
