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

import {
  API_CATALOG_MEDIA_TYPE,
  API_CATALOG_PATH,
  type CatalogApi,
  buildAgentApiCatalog,
} from './agent-api-catalog'

const ORIGIN = 'https://acme.test'

/* eslint-disable @typescript-eslint/no-explicit-any */
const SITE = {
  url: `${ORIGIN}/`,
  title: 'Acme',
  specUrl: `${ORIGIN}/openapi.json`,
  docsUrl: `${ORIGIN}/llms.txt`,
  docsType: 'text/markdown',
  statusUrl: `${ORIGIN}/api/health`,
}
const PLATFORM = {
  url: 'https://app.example.test/api/v1',
  title: 'Platform API',
  specUrl: 'https://app.example.test/api/v1/openapi.json',
  docsUrl: 'https://docs.example.test/api',
}

// Typed as the interface rather than inferred from the default: inference
// makes every optional field of `CatalogApi` mandatory at the call sites,
// which locks out the one shape this file most needs to pass — an API with
// nothing but an anchor.
const catalog = (apis: readonly CatalogApi[] = [SITE, PLATFORM]): any =>
  buildAgentApiCatalog({ origin: ORIGIN, apis }) as any

const contextFor = (document: any, anchor: string): any =>
  document.linkset.find((entry: any) => entry.anchor === anchor)

describe('buildAgentApiCatalog — RFC 9727 / RFC 9264 shape', () => {
  it('anchors the membership list at the catalog itself, not at the site', () => {
    // The distinction is the reason a catalog is not just a list of URLs: this
    // object says "these are MY APIs", and it is the catalog making the claim.
    const [first] = catalog().linkset
    expect(first.anchor).toBe(`${ORIGIN}${API_CATALOG_PATH}`)
    expect(first.item.map((link: any) => link.href)).toEqual([
      SITE.url,
      PLATFORM.url,
    ])
  })

  it('labels each member so a reader can tell the two APIs apart', () => {
    const [first] = catalog().linkset
    expect(first.item.map((link: any) => link.title)).toEqual([
      'Acme',
      'Platform API',
    ])
  })

  it("gives every API its own context, anchored at that API's root", () => {
    const document = catalog()
    expect(contextFor(document, SITE.url)).toBeDefined()
    expect(contextFor(document, PLATFORM.url)).toBeDefined()
    expect(document.linkset).toHaveLength(3)
  })

  it('publishes the OpenAPI description as `service-desc`, with its type', () => {
    const site = contextFor(catalog(), SITE.url)
    expect(site['service-desc']).toEqual([
      { href: `${ORIGIN}/openapi.json`, type: 'application/json' },
    ])
  })

  it('publishes documentation and health under their own relations', () => {
    const site = contextFor(catalog(), SITE.url)
    expect(site['service-doc']).toEqual([
      { href: `${ORIGIN}/llms.txt`, type: 'text/markdown' },
    ])
    expect(site['status']).toEqual([
      { href: `${ORIGIN}/api/health`, type: 'application/json' },
    ])
  })

  it('defaults the documentation type to HTML when none is declared', () => {
    const platform = contextFor(catalog(), PLATFORM.url)
    expect(platform['service-doc']).toEqual([
      { href: PLATFORM.docsUrl, type: 'text/html' },
    ])
  })

  it('omits a relation an API does not have, rather than emitting it empty', () => {
    // A `status` of `''` is a link an agent follows and a 404 it blames on us.
    const platform = contextFor(catalog(), PLATFORM.url)
    expect(platform['status']).toBeUndefined()
    expect(Object.keys(platform).sort()).toEqual([
      'anchor',
      'service-desc',
      'service-doc',
    ])
  })

  it('contributes no context at all for an API with nothing but an anchor', () => {
    const document = catalog([SITE, { url: 'https://bare.test', title: 'Bare' }])
    // Still listed as a member — we do know it exists — but nothing describes it.
    const [first] = document.linkset
    expect(first.item).toHaveLength(2)
    expect(contextFor(document, 'https://bare.test')).toBeUndefined()
    expect(document.linkset).toHaveLength(2)
  })

  it('normalizes a trailing slash on the origin', () => {
    const document = buildAgentApiCatalog({
      origin: `${ORIGIN}/`,
      apis: [SITE],
    }) as any
    expect(document.linkset[0].anchor).toBe(`${ORIGIN}${API_CATALOG_PATH}`)
  })

  it('survives JSON, which is the only form anyone receives it in', () => {
    const round = JSON.parse(JSON.stringify(catalog()))
    expect(round).toEqual(catalog())
    expect(JSON.stringify(catalog())).not.toContain('undefined')
  })

  it('requires the linkset media type, which is not `application/json`', () => {
    // RFC 9727 §3: a catalog MUST support `application/linkset+json`.
    expect(API_CATALOG_MEDIA_TYPE).toBe('application/linkset+json')
    expect(API_CATALOG_PATH).toBe('/.well-known/api-catalog')
  })
})
