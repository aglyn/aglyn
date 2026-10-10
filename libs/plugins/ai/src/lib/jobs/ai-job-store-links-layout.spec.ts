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
 * A store's links in the site's own layout, as a draft version that goes
 * live only with the build's publish (AGL-3676), against a Firestore double.
 */

import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import type { AiStoreLayoutLinks } from '../model/ai-layout-store-links'
import { AI_STORE_LINKS_SOURCE_FIELD, AI_STORE_LINKS_VERSION_NAME, writeAiStoreLinksLayoutDraft } from './ai-job-store-links-layout'
import { aiPublishGuidedSite } from './ai-site-publish'

const NOW = new Date('2026-10-10T12:00:00.000Z')
const docs = new Map<string, Record<string, unknown>>()

function snapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? data[field] : undefined),
  }
}

function docRef(path: string): Record<string, unknown> {
  return {
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshot(path),
    create: async (data: Record<string, unknown>) => {
      if (docs.has(path)) throw new Error(`6 ALREADY_EXISTS: ${path}`)
      docs.set(path, data)
    },
    delete: async () => void docs.delete(path),
  }
}

let autoId = 0
function collectionRef(path: string): Record<string, unknown> {
  return {
    doc: (id?: string) => docRef(`${path}/${id ?? `auto${++autoId}`}`),
    limit: () => ({ get: async () => ({ size: 1 }) }),
  }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  batch: () => {
    const writes: Array<() => void> = []
    return {
      set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) =>
        writes.push(() => docs.set(ref.path, { ...(options?.merge ? (docs.get(ref.path) ?? {}) : {}), ...data })),
      update: (ref: { path: string }, data: Record<string, unknown>) => writes.push(() => docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...data })),
      create: (ref: { path: string }, data: Record<string, unknown>) =>
        writes.push(() => {
          if (docs.has(ref.path)) throw new Error(`6 ALREADY_EXISTS: ${ref.path}`)
          docs.set(ref.path, data)
        }),
      commit: async () => {
        for (const write of writes) write()
      },
    }
  },
} as unknown as FirebaseFirestore.Firestore

const LAYOUT = {
  root: { $id: 'root', componentId: 'div', nodes: ['header', 'footer'] },
  header: { $id: 'header', componentId: 'muiAppBar', parentId: 'root', nodes: ['nav'] },
  nav: { $id: 'nav', componentId: 'muiStack', parentId: 'header', nodes: ['n1', 'n2'] },
  n1: { $id: 'n1', componentId: 'muiScreenLink', parentId: 'nav', props: { children: 'Shop', href: '/shop' }, nodes: [] },
  n2: { $id: 'n2', componentId: 'muiScreenLink', parentId: 'nav', props: { children: 'About', href: '/about' }, nodes: [] },
  footer: { $id: 'footer', componentId: 'section', parentId: 'root', props: { element: 'footer' }, nodes: ['list'] },
  list: { $id: 'list', componentId: 'muiStack', parentId: 'footer', nodes: ['f1', 'f2'] },
  f1: { $id: 'f1', componentId: 'muiScreenLink', parentId: 'list', props: { children: 'Shop', href: '/shop' }, nodes: [] },
  f2: { $id: 'f2', componentId: 'muiScreenLink', parentId: 'list', props: { children: 'About', href: '/about' }, nodes: [] },
}

const LINKS: AiStoreLayoutLinks = {
  header: [{ label: 'Account', href: '/account' }],
  cart: { label: 'Cart', href: '/cart' },
  footer: [
    { label: 'Your account', href: '/account' },
    { label: 'Terms of sale', href: '/terms' },
  ],
}

const packed = (nodes: unknown) => Buffer.from(encodeStoredNodes(nodes as never) as Uint8Array)
const nodesOf = (path: string) => decodeStoredNodes<Record<string, { props?: Record<string, unknown>; nodes?: string[] }>>(docs.get(path)?.['nodes'] as never)

function seed(nodes: unknown = LAYOUT) {
  docs.set('hosts/host-1', { subdomain: 'ember', screens: {} })
  docs.set('hosts/host-1/layouts/lay-site', { displayName: 'Site header and footer', versionId: 'v-live' })
  docs.set('hosts/host-1/layouts/lay-site/versions/v-live', { layoutId: 'lay-site', hostId: 'host-1', declared: { x: 1 }, nodes: packed(nodes) })
  docs.set('hosts/host-1/screens/build-1-store-account', { displayName: 'Your account', slug: 'account', versionId: 'va' })
  docs.set('hosts/host-1/screens/build-1-store-account/versions/va', { layoutId: 'lay-site' })
}

const draft = () =>
  writeAiStoreLinksLayoutDraft(firestore, {
    hostId: 'host-1',
    layoutId: 'lay-site',
    versionId: 'build-1-store-links',
    links: LINKS,
    screenPaths: {},
    uid: 'uid-1',
    aiJobId: 'build-1',
    now: NOW,
  })

beforeEach(() => docs.clear())

describe('the draft version of the site’s layout (AGL-3676)', () => {
  it('writes the links into a new version beside the live one, which stays live', async () => {
    seed()
    expect(await draft()).toEqual({ status: 'written', layoutId: 'lay-site', versionId: 'build-1-store-links', name: 'Site header and footer' })
    expect(docs.get('hosts/host-1/layouts/lay-site')?.['versionId']).toBe('v-live')
    const version = docs.get('hosts/host-1/layouts/lay-site/versions/build-1-store-links') as Record<string, unknown>
    expect(version).toMatchObject({
      layoutId: 'lay-site',
      declared: { x: 1 },
      displayName: AI_STORE_LINKS_VERSION_NAME,
      aiJobId: 'build-1',
      createdBy: 'uid-1',
      [AI_STORE_LINKS_SOURCE_FIELD]: 'v-live',
    })
    const nodes = nodesOf('hosts/host-1/layouts/lay-site/versions/build-1-store-links')
    expect(nodes?.['nav'].nodes).toEqual(['n1', 'n2', 'ai_store_header0_account', 'ai_store_header0_cart'])
    expect(nodes?.['list'].nodes).toEqual(['f1', 'f2', 'ai_store_footer_account', 'ai_store_footer_terms'])
    // Run again, it is the same draft.
    expect(await draft()).toMatchObject({ status: 'written', versionId: 'build-1-store-links' })
  })

  it('writes nothing where every link is there, and says where the layout has no list for them', async () => {
    seed()
    await draft()
    docs.set('hosts/host-1/layouts/lay-site/versions/v-live', { nodes: docs.get('hosts/host-1/layouts/lay-site/versions/build-1-store-links')?.['nodes'] })
    docs.delete('hosts/host-1/layouts/lay-site/versions/build-1-store-links')
    expect(await draft()).toEqual({ status: 'present', layoutId: 'lay-site' })
    seed({ root: { $id: 'root', componentId: 'div', nodes: [] } })
    expect(await draft()).toMatchObject({ status: 'unrecognized', versionId: null })
    expect(docs.has('hosts/host-1/layouts/lay-site/versions/build-1-store-links')).toBe(false)
  })
})

describe('the build’s publish puts the draft live (AGL-3676)', () => {
  const publish = () =>
    aiPublishGuidedSite(
      firestore,
      {
        job: { $id: 'build-1', orgId: 'org-1', hostId: 'host-1' },
        outputs: [{ resource: 'screen', id: 'build-1-store-account', hostId: 'host-1', label: 'Your account' }],
        now: NOW,
        storeLinks: { layoutId: 'lay-site', versionId: 'build-1-store-links', links: LINKS },
      },
      { sendSitePublished: (async () => ({ sent: true })) as never, dropCache: (async () => ({ complete: true })) as never },
    )

  it('makes the draft the live version while the live one is still the one it was made from', async () => {
    seed()
    await draft()
    await publish()
    expect(docs.get('hosts/host-1/layouts/lay-site')?.['versionId']).toBe('build-1-store-links')
  })

  it('adds the same links to the live version where the layout changed since the draft', async () => {
    seed()
    await draft()
    docs.set('hosts/host-1/layouts/lay-site', { displayName: 'Site header and footer', versionId: 'v-edited' })
    docs.set('hosts/host-1/layouts/lay-site/versions/v-edited', { nodes: packed(LAYOUT) })
    await publish()
    const live = docs.get('hosts/host-1/layouts/lay-site')?.['versionId'] as string
    expect(live).not.toBe('v-edited')
    expect(live).not.toBe('build-1-store-links')
    expect(nodesOf(`hosts/host-1/layouts/lay-site/versions/${live}`)?.['list'].nodes).toEqual([
      'f1',
      'f2',
      'ai_store_footer_account',
      'ai_store_footer_terms',
    ])
  })
})
