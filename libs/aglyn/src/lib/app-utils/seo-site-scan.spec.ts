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
 * The SEO check reads a site the way its sitemap lists it: only public,
 * routed, live pages that are neither templates nor status pages; each on
 * its published version; linked through its pages and its shared layouts;
 * and its titles as the head renders them.
 */

import { HostScreenVisibility } from '../foundation/definitions/platform.types'
import { seoAudit } from './seo-audit'
import { scanSeoSite, seoAuditSiteOf, type SeoScanStore, type SeoSiteHost } from './seo-site-scan'

type Doc = Record<string, unknown>

/** An in-memory store keyed by slash path, holding what `select` and `get` read. */
function fakeStore(docs: Record<string, Doc>): SeoScanStore & { reads: string[] } {
  const reads: string[] = []
  const ref = (path: string) => ({
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => {
      reads.push(path)
      const data = docs[path]
      return { exists: Boolean(data), get: (field: string) => data?.[field] }
    },
  })
  const collection = (path: string) => {
    const query = (fields: readonly string[], max: number) => ({
      limit: (count: number) => query(fields, count),
      get: async () => {
        reads.push(`${path}?`)
        const prefix = `${path}/`
        const children = Object.keys(docs)
          .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
          .slice(0, max)
        return {
          docs: children.map((key) => {
            const data = Object.fromEntries(Object.entries(docs[key]).filter(([field]) => fields.includes(field)))
            return { id: key.slice(prefix.length), data: () => data, get: (field: string) => data[field], ref: ref(key) }
          }),
        }
      },
    })
    return { select: (...fields: string[]) => query(fields, Infinity), doc: (id: string) => ref(`${path}/${id}`) }
  }
  return { collection: (name: string) => collection(name), reads }
}

const page = (heading: string, extra: Doc = {}) => ({
  rootId: 'root',
  nodes: {
    root: { componentId: 'div', nodes: ['main'] },
    main: { componentId: 'section', props: { component: 'main' }, nodes: ['h', ...Object.keys(extra)] },
    h: { componentId: 'muiTypography', props: { variant: 'h1', children: heading }, nodes: [] as string[] },
    ...extra,
  },
})
const linkTo = (screenId: string) => ({ link: { componentId: 'link', props: { screenId }, nodes: [] as string[] } })

const host: SeoSiteHost = {
  displayName: 'Acme',
  screens: { home: '/', lamps: 'lamps', about: 'about', draft: 'draft', gone: 'gone', tpl: 'post', err: '404' },
  seo: { title: 'Acme Lamps', separator: '|', entity: { name: 'Acme' }, agent: {} },
}

const docs: Record<string, Doc> = {
  'hosts/h1/screens/home': { displayName: 'Home', versionId: 'v1', seo: { title: 'Brass desk lamps, made to order' } },
  'hosts/h1/screens/home/versions/v1': page('Brass desk lamps made to order', linkTo('lamps')),
  // Two pages on the title pattern: different titles once rendered.
  'hosts/h1/screens/lamps': { displayName: 'Lamps', versionId: 'v2', seo: { title: '{{page.name}} {{site.separator}} {{site.name}}' } },
  'hosts/h1/screens/lamps/versions/v2': page('Every lamp we make, by hand'),
  'hosts/h1/screens/about': { displayName: 'About', versionId: 'v3', seo: { title: '{{page.name}} {{site.separator}} {{site.name}}' } },
  'hosts/h1/screens/about/versions/v3': page('About the Acme workshop'),
  'hosts/h1/screens/draft': { displayName: 'Draft', versionId: 'v4', visibility: HostScreenVisibility.PRIVATE },
  'hosts/h1/screens/gone': { displayName: 'Gone', versionId: 'v5', deletedAt: 1 },
  'hosts/h1/screens/tpl': { displayName: 'Post template', versionId: 'v6' },
  'hosts/h1/screens/err': { displayName: 'Not found', versionId: 'v7' },
  'hosts/h1/layouts/main': { versionId: 'l1' },
  'hosts/h1/layouts/main/versions/l1': page('Acme', linkTo('about')),
}

describe('scanSeoSite', () => {
  it('reads only the pages a sitemap lists, sorted by path', async () => {
    const scan = await scanSeoSite(fakeStore(docs), 'h1', host, { templateScreenIds: ['tpl'] })
    expect(scan.pages.map((entry) => [entry.screenId, entry.path])).toEqual([
      ['home', '/'],
      ['about', '/about'],
      ['lamps', '/lamps'],
    ])
    expect(scan.skipped).toBe(0)
  })

  it('judges a title as the head renders it, so two pages on the title pattern are not duplicates', async () => {
    const scan = await scanSeoSite(fakeStore(docs), 'h1', host, { templateScreenIds: ['tpl'] })
    const lamps = scan.pages.find((entry) => entry.screenId === 'lamps')
    expect(lamps?.seo.title).toBe('Lamps | Acme Lamps')
    expect(lamps?.storedSeo.title).toBe('{{page.name}} {{site.separator}} {{site.name}}')
    const report = seoAudit(scan.pages, seoAuditSiteOf(host))
    const codes = report.pages.flatMap((entry) => entry.findings.map((finding) => finding.code))
    expect(codes).not.toContain('title-duplicate')
  })

  it('counts a link from another page or from a shared layout', async () => {
    const scan = await scanSeoSite(fakeStore(docs), 'h1', host, { templateScreenIds: ['tpl'] })
    expect(Object.fromEntries(scan.pages.map((entry) => [entry.screenId, entry.linkedFrom]))).toEqual({
      home: false,
      about: true,
      lamps: true,
    })
  })

  it('matches keyword lines to pages, and notes a line for a page it did not check', async () => {
    const scan = await scanSeoSite(fakeStore(docs), 'h1', host, {
      templateScreenIds: ['tpl'],
      keywords: '/lamps: dimmable\n/draft: secret',
    })
    expect(scan.pages.find((entry) => entry.screenId === 'lamps')?.keywords).toEqual(['dimmable'])
    expect(scan.notes).toEqual(['Keywords for /draft were not used: no checked page is published at that address.'])
  })

  it('reads a site with no routing map as nothing to check', async () => {
    const store = fakeStore({})
    const scan = await scanSeoSite(store, 'h1', {})
    expect(scan).toEqual({ pages: [], skipped: 0, notes: [] })
    expect(store.reads).toEqual(['hosts/h1/screens?', 'hosts/h1/layouts?'])
  })
})

describe('seoAuditSiteOf', () => {
  it('reads the switch, the entity and the agent guidance off the host', () => {
    expect(seoAuditSiteOf({ seo: { discourageSearchEngines: true } })).toEqual({
      discouraged: true,
      entity: {},
      agent: {},
    })
  })
})
