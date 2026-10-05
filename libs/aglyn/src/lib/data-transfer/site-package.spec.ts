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

import { listPluginSiteExportCollections } from '../plugin-manager/plugin-site-export'
import { listDeclaredSiteBundleSections } from '../plugin-manager/plugin-site-bundle'
import { TRANSFER_PACKAGE_FORMAT, TRANSFER_PACKAGE_VERSION } from './package'
import {
  buildSitePackage,
  listSitePackageKinds,
  mergeSiteFields,
  PLATFORM_SITE_PACKAGE_KINDS,
  planSitePackageImport,
  readSitePackage,
  remapSiteReferences,
  resolveSitePackageImport,
  selectSitePackage,
  siteBundleItems,
  SitePackageDecisionError,
  siteItemDependencies,
  sitePackageItems,
  siteReferenceIndex,
  siteWritesToBundle,
  type SiteExistingItem,
  type SitePackage,
  type SitePackageContract,
  type SitePackageItem,
} from './site-package'

const CONTRACT: SitePackageContract = {
  settingsFields: ['displayName', 'notFoundScreenId'],
  themeFields: ['theme'],
  limits: { screens: 3 },
}

const NODES_WITH = (props: Record<string, unknown>, componentId = 'reusableInstance') => ({
  root: { $id: 'root', componentId: 'div', nodes: ['placed'] as string[] },
  placed: { $id: 'placed', componentId, nodes: [] as string[], props },
})

/** A small site: a layout, a component, two pages and a variable the pricing page binds. */
const SITE: SitePackageItem[] = [
  { kind: 'layout', id: 'layout-chrome', content: { displayName: 'Chrome' } },
  { kind: 'component', id: 'component-nav', content: { displayName: 'Nav' } },
  {
    kind: 'page',
    id: 'page-pricing',
    content: {
      displayName: 'Pricing',
      slug: 'pricing',
      route: '/plans/pricing',
      layoutId: 'layout-chrome',
      version: {
        $id: 'version-1',
        nodes: {
          ...NODES_WITH({ refId: 'component-nav' }),
          text: { $id: 'text', componentId: 'typography', props: { children: 'Email {{var:variable-support}}', href: 'screen:page-about' } },
        },
      },
    },
  },
  { kind: 'page', id: 'page-about', content: { displayName: 'About', slug: 'about', route: '/about' } },
  { kind: 'variable', id: 'variable-support', content: { name: 'supportEmail', value: 'help@example.com' } },
]

const hashOf = async (item: SitePackageItem) => `sha256:${JSON.stringify(item.content).length}-${item.id}`

async function packageOf(items: readonly SitePackageItem[], known: readonly SitePackageItem[] = []): Promise<SitePackage> {
  return buildSitePackage(items, { index: siteReferenceIndex([...items, ...known]) })
}

async function existingOf(items: readonly SitePackageItem[]): Promise<Array<SiteExistingItem & { content: Record<string, unknown> }>> {
  const pkg = await packageOf(items)
  return pkg.manifest.items.map((entry) => ({
    kind: entry.kind,
    id: entry.$id,
    ...(entry.slug ? { slug: entry.slug } : {}),
    ...(entry.name ? { name: entry.name } : {}),
    contentHash: entry.contentHash,
    content: pkg.items[`${entry.kind}/${entry.$id}`] as Record<string, unknown>,
  }))
}

let counter = 0
const newId = () => `fresh-id-${(counter += 1)}`

beforeEach(() => {
  counter = 0
})

describe('the kinds a site package carries', () => {
  it('lists the platform’s own, then every plugin declaration’s, with one owner each', () => {
    const kinds = listSitePackageKinds()
    expect(kinds.slice(0, PLATFORM_SITE_PACKAGE_KINDS.length)).toEqual(PLATFORM_SITE_PACKAGE_KINDS)
    const names = kinds.map((one) => one.kind)
    expect(new Set(names).size).toBe(names.length)
  })

  it('carries every declared collection and section as a kind (declared ⇔ listed)', () => {
    const kinds = new Map(listSitePackageKinds().map((one) => [one.kind, one]))
    for (const declared of listPluginSiteExportCollections()) {
      expect(kinds.get(declared.package.kind)?.bundleKey).toBe(declared.collection)
    }
    for (const declared of listDeclaredSiteBundleSections()) {
      expect(kinds.get(declared.package.kind)?.bundleKey).toBe(declared.key)
    }
  })

  it('includes the coverage a backup never carried: emails, forms, redirects, events, experiments, overlays, theme', () => {
    const names = listSitePackageKinds().map((one) => one.kind)
    for (const kind of ['emailTemplate', 'form', 'redirect', 'event', 'experiment', 'overlay', 'theme', 'savedTheme']) {
      expect([kind, names.includes(kind)]).toEqual([kind, true])
    }
  })
})

describe('a v1 backup read as items', () => {
  const BUNDLE = {
    format: 'aglyn-site-export',
    version: 1,
    host: {
      displayName: 'Acme',
      theme: { primary: '#123' },
      subdomain: 'acme',
      screens: { 'page-1': '/', 'page-gone': '/gone' },
    },
    screens: [
      { $id: 'page-1', displayName: 'Home', slug: '' },
      { $id: 'email-1', displayName: 'Welcome', kind: 'email' },
      { displayName: 'No id' },
      { $id: 'page-2', displayName: 'Over the cap' },
      { $id: 'page-3', displayName: 'Past it' },
    ],
    layouts: [{ $id: 'layout-1', displayName: 'Chrome' }],
  }

  it('makes the site’s fields two singletons, keeping only the contract’s fields', () => {
    const items = siteBundleItems(BUNDLE, CONTRACT)
    expect(items.find((one) => one.kind === 'settings')).toEqual({
      kind: 'settings',
      id: 'settings',
      content: { displayName: 'Acme' },
    })
    expect(items.find((one) => one.kind === 'theme')?.content).toEqual({ theme: { primary: '#123' } })
  })

  it('splits screens into pages and email designs, each carrying its own address', () => {
    const items = siteBundleItems(BUNDLE, CONTRACT)
    expect(items.find((one) => one.id === 'page-1')).toEqual({
      kind: 'page',
      id: 'page-1',
      content: { displayName: 'Home', slug: '', route: '/' },
    })
    expect(items.find((one) => one.id === 'email-1')?.kind).toBe('email')
  })

  it('caps an array where the restore caps it, skips a document with no id, and drops an address naming nothing', () => {
    const ids = siteBundleItems(BUNDLE, CONTRACT).map((one) => one.id)
    // Three screens read (the cap), one of them without an id.
    expect(ids).toEqual(['settings', 'theme', 'page-1', 'email-1', 'layout-1'])
    expect(ids).not.toContain('page-gone')
  })

  it('writes back as the same shape, the id last and the address in the routing map', () => {
    const shaped = siteWritesToBundle([
      { key: 'page/page-1', kind: 'page', sourceId: 'page-1', targetId: 'page-9', decision: 'create', content: { $id: 'elsewhere', displayName: 'Home', route: '/' } },
      { key: 'settings/settings', kind: 'settings', sourceId: 'settings', targetId: 'settings', decision: 'merge', content: { displayName: 'Acme' } },
    ])
    expect(shaped.bundle['screens']).toEqual([{ displayName: 'Home', $id: 'page-9' }])
    expect(shaped.hostPatch).toEqual({ displayName: 'Acme', screens: { 'page-9': '/' } })
  })
})

describe('what an item depends on', () => {
  const index = siteReferenceIndex(SITE)
  const deps = (id: string) =>
    siteItemDependencies(SITE.find((one) => one.id === id) as SitePackageItem, index).map((dep) => `${dep.kind}/${dep.id}`)

  it('follows typed fields, component placements, binding tokens and ids inside text', () => {
    expect(deps('page-pricing').sort()).toEqual(
      ['component/component-nav', 'layout/layout-chrome', 'page/page-about', 'variable/variable-support'].sort(),
    )
  })

  it('names a typed reference even when nothing holds the item, so it can be reported missing', () => {
    const lonely: SitePackageItem = { kind: 'page', id: 'page-x', content: { layoutId: 'layout-nowhere' } }
    expect(siteItemDependencies(lonely, siteReferenceIndex([lonely]))).toEqual([{ kind: 'layout', id: 'layout-nowhere' }])
  })

  it('follows a declared placement: a form node’s formId', () => {
    const page: SitePackageItem = {
      kind: 'page',
      id: 'page-contact',
      content: { version: { $id: 'v', nodes: NODES_WITH({ formId: 'form-contact' }, 'form') } },
    }
    expect(siteItemDependencies(page, siteReferenceIndex([page]))).toContainEqual({ kind: 'form', id: 'form-contact' })
  })

  it('never searches text for an id that is a word, nor names itself', () => {
    const items: SitePackageItem[] = [
      { kind: 'savedTheme', id: 'default', content: { name: 'Default' } },
      { kind: 'page', id: 'page-word', content: { displayName: 'the default page-word layout' } },
    ]
    expect(siteItemDependencies(items[1] as SitePackageItem, siteReferenceIndex(items))).toEqual([])
  })
})

describe('moving references', () => {
  const ids = new Map<string, string | null>([
    ['page-about', 'page-about-copy'],
    ['layout-gone', null],
    ['variable-gone', null],
  ])

  it('rewrites an exact id, a whole token inside text, a binding token and a map key', () => {
    expect(
      remapSiteReferences(
        {
          parentId: 'page-about',
          href: 'screen:page-about',
          text: 'Mail {{var:page-about}} now',
          variants: { 'page-about': { weight: 1 } },
        },
        ids,
      ),
    ).toEqual({
      parentId: 'page-about-copy',
      href: 'screen:page-about-copy',
      text: 'Mail {{var:page-about-copy}} now',
      variants: { 'page-about-copy': { weight: 1 } },
    })
  })

  it('drops a reference: null in a field, gone from a list, a map or a token, and an emptied string', () => {
    expect(
      remapSiteReferences(
        {
          layoutId: 'layout-gone',
          list: ['layout-gone', 'kept'],
          map: { 'layout-gone': 1, other: 2 },
          text: 'Hi {{var:variable-gone}}!',
          href: 'screen:layout-gone',
        },
        ids,
      ),
    ).toEqual({ layoutId: null, list: ['kept'], map: { other: 2 }, text: 'Hi !', href: '' })
  })

  it('leaves a value with nothing to move as the same object', () => {
    const value = { a: { b: ['c'] } }
    expect(remapSiteReferences(value, ids)).toBe(value)
  })

  it('moves a short id only where it is the whole value, never inside text', () => {
    const short = new Map([['home', 'home-2']])
    expect(remapSiteReferences({ parentId: 'home', text: 'Back home' }, short)).toEqual({
      parentId: 'home-2',
      text: 'Back home',
    })
  })
})

describe('the import plan', () => {
  it('says new, identical, differs or missingDependency, and proposes create or skip', async () => {
    const site = await existingOf(SITE.filter((one) => one.id !== 'variable-support'))
    const changed = SITE.map((one) =>
      one.id === 'page-about' ? { ...one, content: { ...one.content, displayName: 'About us' } } : one,
    )
    const incoming = await packageOf([
      ...changed,
      { kind: 'component', id: 'component-new', content: { displayName: 'Footer' } },
      { kind: 'page', id: 'page-orphan', content: { displayName: 'Orphan', slug: 'orphan', layoutId: 'layout-nowhere' } },
    ])
    const plan = planSitePackageImport(incoming, site)
    const by = (id: string) => plan.items.find((one) => one.id === id)
    expect(by('page-pricing')).toMatchObject({ status: 'identical', proposed: 'skip', needsChoice: false })
    expect(by('page-about')).toMatchObject({ status: 'differs', proposed: 'skip', needsChoice: true })
    expect(by('page-about')?.choices).toEqual(['replace', 'keepBoth', 'skip'])
    expect(by('component-new')).toMatchObject({ status: 'new', proposed: 'create' })
    expect(by('variable-support')).toMatchObject({ status: 'new', proposed: 'create' })
    expect(by('page-orphan')).toMatchObject({
      status: 'missingDependency',
      missing: [{ kind: 'layout', id: 'layout-nowhere' }],
    })
    expect(plan.counts).toEqual({ new: 2, identical: 3, differs: 1, missingDependency: 1 })
  })

  it('matches a new id by slug, then name, within its kind', async () => {
    const site = await existingOf([{ kind: 'page', id: 'site-about', content: { displayName: 'About', slug: 'about' } }])
    const incoming = await packageOf([{ kind: 'page', id: 'pkg-about', content: { displayName: 'About', slug: 'about', extra: 1 } }])
    expect(planSitePackageImport(incoming, site).items[0]).toMatchObject({
      status: 'differs',
      matchedBy: 'slug',
      existing: { id: 'site-about' },
    })
  })

  it('offers merge for settings and the theme, and never a copy of a singleton', async () => {
    const site = await existingOf([{ kind: 'settings', id: 'settings', content: { displayName: 'Old' } }])
    const incoming = await packageOf([{ kind: 'settings', id: 'settings', content: { displayName: 'New' } }])
    expect(planSitePackageImport(incoming, site).items[0]?.choices).toEqual(['replace', 'skip', 'merge'])
  })
})

describe('decisions into writes', () => {
  async function resolve(
    incomingItems: SitePackageItem[],
    siteItems: SitePackageItem[],
    input: Partial<Parameters<typeof resolveSitePackageImport>[0]> = {},
  ) {
    const existing = await existingOf(siteItems)
    const incoming = await packageOf(incomingItems, siteItems)
    const plan = planSitePackageImport(incoming, existing)
    return resolveSitePackageImport({ incoming, plan, mode: 'decide', existing, newId, ...input })
  }

  it('keeps both: a new id and slug, and every incoming reference rewritten to the copy', async () => {
    const changed = SITE.map((one) =>
      one.id === 'page-about' ? { ...one, content: { ...one.content, displayName: 'About us' } } : one,
    )
    const { writes, moved } = await resolve(changed, SITE, {
      decisions: { 'page/page-about': 'keepBoth', 'page/page-pricing': 'replace' },
    })
    const copy = writes.find((one) => one.key === 'page/page-about')
    expect(copy).toMatchObject({ targetId: 'fresh-id-1', decision: 'keepBoth' })
    expect(copy?.content).toMatchObject({ slug: 'about-copy', route: '/about-copy' })
    expect(moved).toEqual({ 'page/page-about': 'fresh-id-1' })
    const pricing = writes.find((one) => one.key === 'page/page-pricing')
    expect((pricing?.content['version'] as any).nodes.text.props.href).toBe('screen:fresh-id-1')
    expect(pricing?.existingKey).toBe('page/page-pricing')
  })

  it('replaces an item matched by slug under the site’s id, and points references at it', async () => {
    const site: SitePackageItem[] = [{ kind: 'page', id: 'site-about', content: { displayName: 'About', slug: 'about' } }]
    const incoming: SitePackageItem[] = [
      { kind: 'page', id: 'pkg-about', content: { displayName: 'About!', slug: 'about' } },
      { kind: 'page', id: 'pkg-home', content: { displayName: 'Home', slug: 'home', parentId: 'pkg-about' } },
    ]
    const { writes } = await resolve(incoming, site, { decisions: { 'page/pkg-about': 'replace' } })
    expect(writes.find((one) => one.key === 'page/pkg-about')?.targetId).toBe('site-about')
    expect(writes.find((one) => one.key === 'page/pkg-home')?.content['parentId']).toBe('site-about')
  })

  it('points references at the site’s item when a matched one is skipped', async () => {
    const site: SitePackageItem[] = [{ kind: 'layout', id: 'site-chrome', content: { displayName: 'Chrome' } }]
    const incoming: SitePackageItem[] = [
      { kind: 'layout', id: 'pkg-chrome', content: { displayName: 'Chrome', changed: true } },
      { kind: 'page', id: 'pkg-home', content: { displayName: 'Home', layoutId: 'pkg-chrome' } },
    ]
    const { writes, skipped } = await resolve(incoming, site)
    expect(skipped).toEqual(['layout/pkg-chrome'])
    expect(writes.find((one) => one.key === 'page/pkg-home')?.content['layoutId']).toBe('site-chrome')
  })

  it('answers each missing dependency: map to an existing item, drop it, or keep it with a warning', async () => {
    const site: SitePackageItem[] = [{ kind: 'layout', id: 'site-chrome', content: { displayName: 'Chrome' } }]
    const incoming: SitePackageItem[] = [
      { kind: 'page', id: 'a', content: { displayName: 'A', layoutId: 'layout-gone' } },
      { kind: 'page', id: 'b', content: { displayName: 'B', parentId: 'page-gone' } },
      { kind: 'page', id: 'c', content: { displayName: 'C', layoutId: 'layout-other' } },
    ]
    const { writes, warnings } = await resolve(incoming, site, {
      dependencyChoices: { 'layout/layout-gone': { mapTo: 'site-chrome' }, 'page/page-gone': 'drop' },
    })
    expect(writes.find((one) => one.key === 'page/a')?.content['layoutId']).toBe('site-chrome')
    expect(writes.find((one) => one.key === 'page/b')?.content['parentId']).toBeNull()
    expect(writes.find((one) => one.key === 'page/c')?.content['layoutId']).toBe('layout-other')
    expect(warnings.map((one) => one.code).sort()).toEqual(['danglingReference', 'droppedReference', 'mappedReference'])
  })

  it('imports a skipped new dependency from the package when asked', async () => {
    const incoming: SitePackageItem[] = [
      { kind: 'layout', id: 'pkg-chrome', content: { displayName: 'Chrome' } },
      { kind: 'page', id: 'pkg-home', content: { displayName: 'Home', layoutId: 'pkg-chrome' } },
    ]
    const { writes } = await resolve(incoming, [], {
      decisions: { 'layout/pkg-chrome': 'skip' },
      dependencyChoices: { 'layout/pkg-chrome': 'import' },
    })
    expect(writes.map((one) => one.key).sort()).toEqual(['layout/pkg-chrome', 'page/pkg-home'])
  })

  it('merges settings key by key, the site’s own values winning', async () => {
    const { writes } = await resolve(
      [{ kind: 'settings', id: 'settings', content: { displayName: 'New', seo: { title: 'T', image: 'i' } } }],
      [{ kind: 'settings', id: 'settings', content: { displayName: 'Old', seo: { title: 'Mine' } } }],
      { decisions: { 'settings/settings': 'merge' } },
    )
    expect(writes[0]?.content).toEqual({ displayName: 'Old', seo: { title: 'Mine', image: 'i' } })
    expect(mergeSiteFields(undefined, 1)).toBe(1)
  })

  it('merges the keys the person names their way, and the rest as a merge does', async () => {
    const { writes } = await resolve(
      [{ kind: 'settings', id: 'settings', content: { displayName: 'New', seo: { title: 'T' }, favicon: 'f' } }],
      [{ kind: 'settings', id: 'settings', content: { displayName: 'Old', seo: { title: 'Mine' }, locale: 'en' } }],
      {
        decisions: { 'settings/settings': 'merge' },
        mergeChoices: { 'settings/settings': { displayName: 'package', seo: 'site' } },
      },
    )
    expect(writes[0]?.content).toEqual({ displayName: 'New', seo: { title: 'Mine' }, locale: 'en', favicon: 'f' })
  })

  it('refuses key choices for an item that is not merged, or a choice that is neither side', async () => {
    const items: SitePackageItem[] = [{ kind: 'settings', id: 'settings', content: { displayName: 'New' } }]
    const site: SitePackageItem[] = [{ kind: 'settings', id: 'settings', content: { displayName: 'Old' } }]
    await expect(
      resolve(items, site, { mergeChoices: { 'settings/settings': { displayName: 'package' } } }),
    ).rejects.toThrow('settings/settings is not merged')
    await expect(
      resolve(items, site, {
        decisions: { 'settings/settings': 'merge' },
        mergeChoices: { 'settings/settings': { displayName: 'both' as never } },
      }),
    ).rejects.toThrow('cannot take "both"')
  })

  it('refuses a decision an item may not take, naming each', async () => {
    await expect(
      resolve([{ kind: 'settings', id: 'settings', content: { displayName: 'New' } }], [
        { kind: 'settings', id: 'settings', content: { displayName: 'Old' } },
      ], { decisions: { 'settings/settings': 'keepBoth', 'page/nowhere': 'create' } }),
    ).rejects.toBeInstanceOf(SitePackageDecisionError)
  })

  it('restores every item under its own id, whatever its slug matched', async () => {
    const site: SitePackageItem[] = [{ kind: 'page', id: 'site-about', content: { displayName: 'About', slug: 'about' } }]
    const { writes } = await resolve(
      [
        { kind: 'page', id: 'pkg-about', content: { displayName: 'About', slug: 'about' } },
        { kind: 'page', id: 'site-about', content: { displayName: 'About', slug: 'about', v: 2 } },
      ],
      site,
      { mode: 'restore' },
    )
    expect(writes.map((one) => [one.targetId, one.decision])).toEqual([
      ['pkg-about', 'create'],
      ['site-about', 'replace'],
    ])
  })

  it('leaves a stored file’s address alone when its media item is kept as a copy', async () => {
    const asset = { kind: 'media', id: 'media-abcdef12', content: { url: '/api/media/cdn/org:o/media-abcdef12', fileName: 'a.png', changed: 1 } }
    const { writes } = await resolve([asset], [{ ...asset, content: { ...asset.content, changed: 0 } }], {
      decisions: { 'media/media-abcdef12': 'keepBoth' },
    })
    expect(writes[0]).toMatchObject({ targetId: 'fresh-id-1', content: { url: '/api/media/cdn/org:o/media-abcdef12' } })
  })
})

describe('choosing what an export carries', () => {
  it('carries the chosen items, and with dependencies what they need', async () => {
    const pkg = await packageOf(SITE)
    expect(selectSitePackage(pkg, ['page/page-pricing'], false).manifest.items.map((one) => one.$id)).toEqual(['page-pricing'])
    expect(selectSitePackage(pkg, ['page/page-pricing'], true).manifest.items.map((one) => one.$id).sort()).toEqual(
      ['component-nav', 'layout-chrome', 'page-about', 'page-pricing', 'variable-support'].sort(),
    )
  })
})

describe('reading a package file', () => {
  it('reads the items, sets aside a kind this site does not read, and ignores an id inside content', async () => {
    const pkg = await buildSitePackage(
      [
        { kind: 'page', id: 'p', content: { $id: 'elsewhere', displayName: 'P' } },
        { kind: 'cellarBottle', id: 'b', content: { name: 'Port' } },
      ],
      { hash: hashOf },
    )
    const read = readSitePackage(JSON.parse(JSON.stringify(pkg)))
    expect(read).toEqual({
      ok: true,
      manifest: expect.objectContaining({ format: TRANSFER_PACKAGE_FORMAT, version: TRANSFER_PACKAGE_VERSION }),
      items: [{ kind: 'page', id: 'p', content: { displayName: 'P' } }],
      unknownKinds: ['cellarBottle'],
    })
    expect(sitePackageItems(pkg)).toHaveLength(2)
  })

  it('refuses a listed item with no content, and a singleton under another id', async () => {
    const pkg = await buildSitePackage([{ kind: 'theme', id: 'not-theme', content: {} }], { hash: hashOf })
    const file = JSON.parse(JSON.stringify(pkg))
    file.manifest.items.push({ kind: 'page', $id: 'gone', contentHash: 'sha256:x', deps: [] })
    const read = readSitePackage(file)
    expect(read.ok).toBe(false)
    expect(read.ok === false && read.problems).toEqual([
      'theme/not-theme is a theme item filed under an id other than "theme".',
      'page/gone is listed and its content is missing.',
    ])
  })

  it('keeps the later of two documents under one id, as a v1 restore left it', async () => {
    const pkg = await buildSitePackage(
      [
        { kind: 'page', id: 'p', content: { displayName: 'First' } },
        { kind: 'page', id: 'p', content: { displayName: 'Second' } },
      ],
      { hash: hashOf },
    )
    expect(pkg.manifest.items).toHaveLength(1)
    expect(pkg.items['page/p']).toEqual({ displayName: 'Second' })
  })
})
