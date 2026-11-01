/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * The site inventory reader (AGL-2935): scoped before it reads, capped per
 * kind, projections only, and nothing listed that would render nothing.
 *
 * The host index and the dataset narrowing are stubbed at their seams; the
 * Firestore double applies filters, projections and limits the way the
 * reader relies on, and records every read so the cap and the projection
 * are asserted on what was ASKED for, not only on what came back.
 */

const mockResolveOrgIdForHost = jest.fn()

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: (...args: unknown[]) => mockResolveOrgIdForHost(...args),
  // An org-scoped ref narrowed to the documents this site may see.
  scopedToHost: (
    ref: { where: (field: string, op: string, value: unknown) => unknown },
    hostId: string,
  ) => ref.where('visibleTo', 'array-contains-any', [hostId]),
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => {
      throw new Error('the reader reads through the handle it was given')
    },
  },
}))

import { describeTheme } from '@aglyn/aglyn/app-utils/site-theme'
import {
  AI_SITE_INVENTORY_LISTED_PER_KIND,
  AI_SITE_INVENTORY_MAX_PER_KIND,
  AiInventoryScopeError,
} from '../model/ai-site-inventory'
import { removeStandInDatasetIndex, standInDatasetIndex } from '../testing/stand-in-dataset-index'
import { readSiteInventory } from './site-inventory'

let docs = new Map<string, Record<string, unknown>>()
const reads: Array<{ path: string; select: string[]; limit: number }> = []

type Filter = [field: string, op: string, value: unknown]

function makeFirestore() {
  const query = (
    path: string,
    filters: Filter[] = [],
    select: string[] | null = null,
    limit = Infinity,
  ) => ({
    where: (field: string, op: string, value: unknown) =>
      query(path, [...filters, [field, op, value]], select, limit),
    select: (...fields: string[]) => query(path, filters, fields, limit),
    limit: (count: number) => query(path, filters, select, count),
    get: async () => {
      reads.push({ path, select: select ?? [], limit })
      const keys = [...docs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .sort()
        .filter((key) =>
          filters.every(([field, op, value]) => {
            if (op !== 'array-contains-any') throw new Error(`unsupported operator ${op}`)
            const held = docs.get(key)?.[field]
            return Array.isArray(held) && (value as unknown[]).some((entry) => held.includes(entry))
          }),
        )
        .slice(0, limit)
      return {
        docs: keys.map((key) => ({
          id: key.split('/').pop() as string,
          data: () =>
            Object.fromEntries(
              Object.entries(docs.get(key) ?? {}).filter(
                ([field]) => !select || select.includes(field),
              ),
            ),
        })),
      }
    },
  })
  const doc = (path: string): Record<string, unknown> => ({
    collection: (name: string) => ({
      ...query(`${path}/${name}`),
      doc: (id: string) => doc(`${path}/${name}/${id}`),
    }),
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
  })
  return {
    collection: (name: string) => ({ ...query(name), doc: (id: string) => doc(`${name}/${id}`) }),
  }
}

const ORG = 'org-1'
const HOST = 'host-1'
const firestore = makeFirestore() as unknown as FirebaseFirestore.Firestore

/** The org's datasets, read only through the index the data plugin publishes (AGL-3080). */
const DATASETS = `orgs/${ORG}/datasets`
/** The site's record templates, which the index reads to say where a dataset's records have pages (AGL-3747). */
const RECORD_PAGES = `hosts/${HOST}/recordPages`
/** The reads this reader makes of the site's own collections. */
const ownReads = () => reads.filter((read) => read.path !== DATASETS && read.path !== RECORD_PAGES)

beforeEach(() => {
  docs = new Map()
  reads.length = 0
  mockResolveOrgIdForHost.mockReset().mockResolvedValue(ORG)
  standInDatasetIndex(firestore)
})

afterEach(() => removeStandInDatasetIndex())

describe('readSiteInventory — scope', () => {
  it('refuses a site the host index places in another workspace, or nowhere, before reading anything', async () => {
    mockResolveOrgIdForHost.mockResolvedValueOnce('org-other')
    await expect(readSiteInventory(ORG, HOST, { firestore })).rejects.toBeInstanceOf(
      AiInventoryScopeError,
    )
    mockResolveOrgIdForHost.mockResolvedValueOnce(null)
    await expect(readSiteInventory(ORG, HOST, { firestore })).rejects.toThrow(
      'host host-1 is not a site of the workspace that asked',
    )
    expect(mockResolveOrgIdForHost).toHaveBeenCalledWith(HOST)
    expect(reads).toEqual([])
  })
})

describe('readSiteInventory — the cap', () => {
  it('reads each kind as a projection, one row past the cap, and names the kinds the cap cut', async () => {
    for (let index = 0; index < 5; index += 1) {
      docs.set(`hosts/${HOST}/components/cmp-${index}`, {
        displayName: `Card ${index}`,
        rootId: 'root',
        props: [{ name: 'title', type: 'text' }],
        nodes: { root: 'NODE_MAP_MARKER' },
      })
    }
    for (let index = 0; index < 3; index += 1) {
      docs.set(`hosts/${HOST}/screens/scr-${index}`, { displayName: `Screen ${index}`, slug: `s${index}` })
    }
    const inventory = await readSiteInventory(ORG, HOST, { firestore, maxPerKind: 3 })
    expect(inventory.components.map((row) => row.id)).toEqual(['cmp-0', 'cmp-1', 'cmp-2'])
    expect(inventory.screens).toHaveLength(3)
    expect(inventory.truncated).toEqual(['components'])
    expect(ownReads().map((read) => read.path).sort()).toEqual(
      [
        `hosts/${HOST}/collections`,
        `hosts/${HOST}/components`,
        `hosts/${HOST}/forms`,
        `hosts/${HOST}/layouts`,
        `hosts/${HOST}/screens`,
        `hosts/${HOST}/templates`,
      ].sort(),
    )
    expect(ownReads().every((read) => read.limit === 4 && read.select.length > 0)).toBe(true)
    expect(reads.flatMap((read) => read.select)).not.toContain('nodes')
    expect(JSON.stringify(inventory)).not.toContain('NODE_MAP_MARKER')
  })

  it('never reads past the platform cap, whatever it is asked for', async () => {
    await readSiteInventory(ORG, HOST, { firestore, maxPerKind: 500 })
    expect(new Set(ownReads().map((read) => read.limit))).toEqual(
      new Set([AI_SITE_INVENTORY_MAX_PER_KIND + 1]),
    )
  })

  it('holds a wider window than the prompt lists, so a lookup has rows to find', async () => {
    // The two caps answer different questions (AGL-2937): what a prompt can
    // afford to carry on every attempt, and what a lookup can search. A window
    // no wider than the listing would make the lookup tool a formality.
    expect(AI_SITE_INVENTORY_MAX_PER_KIND).toBeGreaterThan(AI_SITE_INVENTORY_LISTED_PER_KIND)
    for (let index = 0; index < AI_SITE_INVENTORY_LISTED_PER_KIND + 5; index += 1) {
      docs.set(`hosts/${HOST}/components/cmp-${index}`, {
        displayName: `Card ${index}`,
        rootId: 'root',
        props: [],
      })
    }
    const inventory = await readSiteInventory(ORG, HOST, { firestore })
    expect(inventory.components).toHaveLength(AI_SITE_INVENTORY_LISTED_PER_KIND + 5)
    expect(inventory.truncated).toEqual([])
  })
})

describe('readSiteInventory — what is listed', () => {
  it('leaves out what renders nothing, is retired or is not a page, and narrows datasets to the site', async () => {
    docs.set(`hosts/${HOST}/components/cmp-live`, {
      displayName: 'Service card',
      versionId: 'v1',
      props: [
        { name: 'title', type: 'text', defaultValue: '[Service] in [town]' },
        { name: 'photo', type: 'image' },
        { name: 'price', type: 'text', defaultValue: 'From $90' },
        { name: '' },
      ],
    })
    docs.set(`hosts/${HOST}/components/cmp-deleted`, { displayName: 'Old', rootId: 'r', deletedAt: 1 })
    docs.set(`hosts/${HOST}/components/cmp-draft`, { displayName: 'Never published' })
    // An email block (AGL-3287): published, and still nothing a page can place.
    docs.set(`hosts/${HOST}/components/cmp-email`, {
      displayName: 'Email header',
      rootId: 'r',
      kind: 'email',
    })
    docs.set(`hosts/${HOST}/layouts/lay-site`, { displayName: 'Site', layoutId: 'lay-base' })
    docs.set(`hosts/${HOST}/templates/tpl-1`, { displayName: 'Service page' })
    docs.set(`hosts/${HOST}/forms/frm-live`, {
      slug: 'contact',
      fields: [{ fieldName: 'email' }, { fieldName: 'message' }],
    })
    docs.set(`hosts/${HOST}/forms/frm-archived`, { displayName: 'Old form', archivedAt: 1 })
    docs.set(`orgs/${ORG}/datasets/ds-team`, {
      displayName: 'Team',
      fields: ['name', 'role'],
      visibleTo: [`host:${HOST}`],
    })
    // A dataset whose records carry photos (AGL-3616): its Image field rides `text`.
    docs.set(`orgs/${ORG}/datasets/ds-work`, {
      displayName: 'Work',
      model: {
        order: ['title', 'image', 'slug'],
        fields: {
          title: { name: 'Title', type: 'text' },
          image: { name: 'Image', type: 'text', customType: 'image' },
          // A record page's address (AGL-3727): what a listing's card links by.
          slug: { name: 'Page address', type: 'text', customType: 'pageAddress' },
        },
      },
      visibleTo: [`host:${HOST}`],
    })
    docs.set(`orgs/${ORG}/datasets/ds-other`, {
      displayName: 'Elsewhere',
      fields: ['x'],
      visibleTo: ['host:host-2'],
    })
    docs.set(`hosts/${HOST}/collections/col-blog`, { name: 'Blog', slug: 'blog', kind: 'content' })
    docs.set(`hosts/${HOST}/collections/col-shop`, { name: 'Shop', slug: 'shop', kind: 'catalog' })
    docs.set(`hosts/${HOST}/screens/scr-home`, { displayName: 'Home', slug: '/', layoutId: 'lay-site' })
    docs.set(`hosts/${HOST}/screens/scr-entry`, { displayName: 'Post', slug: 'post', kind: 'template' })
    docs.set(`hosts/${HOST}/screens/scr-email`, { displayName: 'Welcome', kind: 'email' })

    expect(await readSiteInventory(ORG, HOST, { firestore })).toEqual({
      hostId: HOST,
      // The facts a default holds in square brackets travel with the row, for the member's note (AGL-3056).
      components: [
        {
          id: 'cmp-live',
          name: 'Service card',
          props: { title: 'text', photo: 'image', price: 'text' },
          bracketedDefaults: { title: ['[Service]', '[town]'] },
        },
      ],
      layouts: [{ id: 'lay-site', name: 'Site', parentId: 'lay-base' }],
      templates: [{ id: 'tpl-1', name: 'Service page', kind: 'page' }],
      forms: [{ id: 'frm-live', name: 'contact', fields: ['email', 'message'] }],
      // A v1 dataset's model is derived by the core reader, which names the fields for display.
      // Each is shared with this site alone, so it was made for it (AGL-3912).
      datasets: [
        { id: 'ds-team', name: 'Team', fields: ['Name', 'Role'], fieldIds: ['name', 'role'], siteOnly: true },
        {
          id: 'ds-work',
          name: 'Work',
          fields: ['Title', 'Image', 'Page address'],
          fieldIds: ['title', 'image', 'slug'],
          imageField: 'image',
          addressField: 'slug',
          siteOnly: true,
        },
      ],
      collections: [{ id: 'col-blog', name: 'Blog', slug: 'blog' }],
      screens: [
        { id: 'scr-entry', name: 'Post', slug: 'post', layoutId: null, template: true },
        { id: 'scr-home', name: 'Home', slug: '/', layoutId: 'lay-site', template: false },
      ],
      theme: null,
      truncated: [],
    })
  })

  /*
   * AGL-3747: a dataset whose record page was saved before the plan was made
   * gave the build no base to link its cards by — only a record template the
   * same plan made did (AGL-3727).
   */
  it('says where the site already serves a dataset’s records pages of their own, by the address its pages use (AGL-3747)', async () => {
    docs.set(`orgs/${ORG}/datasets/ds-team`, {
      displayName: 'Team',
      model: {
        order: ['name', 'handle', 'slug'],
        fields: {
          name: { name: 'Name', type: 'text' },
          handle: { name: 'Handle', type: 'text' },
          slug: { name: 'Page address', type: 'text', customType: 'pageAddress' },
        },
      },
      visibleTo: [`host:${HOST}`],
    })
    docs.set(`orgs/${ORG}/datasets/ds-work`, { displayName: 'Work', fields: ['title'], visibleTo: [`host:${HOST}`] })
    docs.set(`orgs/${ORG}/datasets/ds-gone`, { displayName: 'Gone', fields: ['title'], visibleTo: [`host:${HOST}`] })
    // Team's pages are served by its Handle, not the page-address field.
    docs.set(`${RECORD_PAGES}/scr-person`, { datasetId: 'ds-team', base: '/people/', slugField: 'handle' })
    // A binding whose address field the dataset no longer has links nothing.
    docs.set(`${RECORD_PAGES}/scr-gone`, { datasetId: 'ds-gone', base: 'gone', slugField: 'missing' })
    const { datasets } = await readSiteInventory(ORG, HOST, { firestore })
    expect(datasets).toEqual([
      {
        id: 'ds-gone',
        name: 'Gone',
        fields: ['Title'],
        fieldIds: ['title'],
        siteOnly: true,
      },
      {
        id: 'ds-team',
        name: 'Team',
        fields: ['Name', 'Handle', 'Page address'],
        fieldIds: ['name', 'handle', 'slug'],
        addressField: 'handle',
        recordBase: 'people',
        // The page those records are served by, which an edit to it reads (AGL-3616).
        recordScreenId: 'scr-person',
        siteOnly: true,
      },
      { id: 'ds-work', name: 'Work', fields: ['Title'], fieldIds: ['title'], siteOnly: true },
    ])
  })

  it('says a dataset was made for this site only where its scope names this site alone (AGL-3912)', async () => {
    docs.set(`orgs/${ORG}/datasets/ds-org`, { displayName: 'Coaches', fields: ['name'], visibleTo: ['org'] })
    docs.set(`orgs/${ORG}/datasets/ds-two`, { displayName: 'Classes', fields: ['name'], visibleTo: [`host:${HOST}`, 'host:host-2'] })
    docs.set(`orgs/${ORG}/datasets/ds-own`, { displayName: 'Menu', fields: ['name'], visibleTo: [`host:${HOST}`] })
    const { datasets } = await readSiteInventory(ORG, HOST, { firestore })
    expect(datasets.map((row) => [row.id, row.siteOnly])).toEqual([
      ['ds-org', undefined],
      ['ds-own', true],
      ['ds-two', undefined],
    ])
  })

  it('reduces the site’s theme to its summary, its light-scheme colors and its fonts', async () => {
    const theme = {
      colorSchemes: {
        light: { primary: { main: '#b33a3a' }, text: { primary: '#111111' } },
        dark: { primary: { main: '#ff8a80' } },
      },
      fonts: [{ family: 'Inter' }, { family: 'Inter' }, { family: 'Lora' }],
    }
    docs.set(`hosts/${HOST}`, { theme })
    const inventory = await readSiteInventory(ORG, HOST, { firestore })
    expect(inventory.theme).toEqual({
      summary: describeTheme(theme as never),
      colors: { 'primary.main': '#b33a3a', 'text.primary': '#111111' },
      fonts: ['Inter', 'Lora'],
    })
  })
})
