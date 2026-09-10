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
} from './agent-api-catalog'
import {
  API_VERSION,
  API_VERSION_HEADER,
  buildAgentOpenApi,
} from './agent-openapi'

const ORIGIN = 'https://acme.test'

/* eslint-disable @typescript-eslint/no-explicit-any */
const spec = (over: Record<string, unknown> = {}): any =>
  buildAgentOpenApi({ siteName: 'Acme', origin: ORIGIN, ...over } as any)

/** Every `{ path, method, operation }` triple in a document. */
function operations(document: any): Array<{ path: string; method: string; op: any }> {
  const found: Array<{ path: string; method: string; op: any }> = []
  for (const [path, item] of Object.entries<any>(document.paths)) {
    for (const [method, op] of Object.entries<any>(item)) {
      found.push({ path, method, op })
    }
  }
  return found
}

describe('buildAgentOpenApi — document shape', () => {
  it('declares OpenAPI 3.1 and the 2020-12 schema dialect', () => {
    // 3.1 is what makes the schemas below convertible to a function-calling
    // format without a lossy pass.
    const document = spec()
    expect(document.openapi).toBe('3.1.0')
    expect(document.jsonSchemaDialect).toBe(
      'https://json-schema.org/draft/2020-12/schema',
    )
  })

  it('names THIS site as the only server', () => {
    expect(spec().servers).toEqual([{ url: ORIGIN, description: 'Acme' }])
  })

  it('strips a trailing slash from the origin', () => {
    expect(spec({ origin: `${ORIGIN}/` }).servers[0].url).toBe(ORIGIN)
  })

  it('carries a title, the contract version, and the build separately', () => {
    const document = spec({ version: '1.2.3' })
    expect(document.info.title).toBe('Acme — public API')
    /*
      `info.version` is the CONTRACT (AGL-2722). It used to be the platform
      release, which moved several times a day — so a consumer reading it as
      "the shape I was built against" was tracking deploy noise and had
      nothing it could pin. The build keeps its own key, and its own purpose.
    */
    expect(document.info.version).toBe(API_VERSION)
    expect(document.info['x-aglyn-platform-version']).toBe('1.2.3')
  })

  it('bumps the contract version only deliberately', () => {
    // A guard on the promise, not on the string: if this fails, a removal or
    // a rename shipped and the version has to move with it.
    expect(API_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(spec({ version: '9.9.9' }).info.version).toBe(API_VERSION)
  })

  it('publishes contact and terms only when the site has them', () => {
    expect(spec().info.contact).toBeUndefined()
    expect(spec().info.termsOfService).toBeUndefined()
    const document = spec({
      contactEmail: 'hi@acme.test',
      termsOfServiceUrl: `${ORIGIN}/terms`,
    })
    expect(document.info.contact.email).toBe('hi@acme.test')
    expect(document.info.termsOfService).toBe(`${ORIGIN}/terms`)
  })
})

describe('buildAgentOpenApi — function-calling compatibility', () => {
  const document = spec({ collections: [{ slug: 'blog' }], hasSearch: true })

  it('gives every operation a unique operationId', () => {
    const ids = operations(document).map(({ op }) => op.operationId)
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every operation a summary and a description', () => {
    for (const { path, method, op } of operations(document)) {
      expect(`${method} ${path}: ${op.summary ?? ''}`).not.toMatch(/: $/)
      expect(`${method} ${path}: ${op.description ?? ''}`).not.toMatch(/: $/)
    }
  })

  it('types every parameter and describes it', () => {
    // Parameters may be inline or a `$ref` into `components.parameters`.
    // Resolving first is the point: a bare `$ref` is not an untyped
    // parameter, and judging it as one would push every shared parameter
    // back inline just to satisfy the check.
    const resolve = (parameter: any) => {
      const ref: string | undefined = parameter?.$ref
      if (!ref) return parameter
      const name = ref.replace('#/components/parameters/', '')
      return document.components.parameters[name]
    }
    for (const { op } of operations(document)) {
      for (const raw of op.parameters ?? []) {
        const parameter = resolve(raw)
        expect(parameter).toBeTruthy()
        expect(parameter.schema?.type).toBeTruthy()
        expect(parameter.description).toBeTruthy()
        expect(typeof parameter.required).toBe('boolean')
      }
    }
  })

  it('names a schema on every success response', () => {
    for (const { op } of operations(document)) {
      const ok = op.responses['200']
      if (!ok?.content) continue
      for (const media of Object.values<any>(ok.content)) {
        expect(media.schema).toBeTruthy()
      }
    }
  })

  it('states the version policy on every operation, not only in the prose', () => {
    /*
      A policy described in `info` and missing from the operations is not a
      policy — it is a paragraph. Every response has to name the version that
      served it, and every operation has to accept the pin.
    */
    const ops = [...operations(document)]
    expect(ops.length).toBeGreaterThan(0)
    for (const { op } of ops) {
      const accepts = (op.parameters ?? []).some(
        (parameter: any) =>
          parameter?.$ref === '#/components/parameters/ApiVersionRequest',
      )
      expect(accepts).toBe(true)

      for (const response of Object.values<any>(op.responses)) {
        expect(response.headers?.[API_VERSION_HEADER]).toBeTruthy()
        // The two headers a removal is announced on. Declared everywhere and
        // SENT only when true, so their absence carries the meaning the
        // description says it does.
        expect(response.headers?.Deprecation).toBeTruthy()
        expect(response.headers?.Sunset).toBeTruthy()
      }
    }
  })

  it('leaves an operation its own headers when the walk runs', () => {
    // The walk merges; it must not overwrite. An operation that deliberately
    // declares a header would otherwise lose it to a blanket policy.
    for (const { op } of operations(document)) {
      for (const response of Object.values<any>(op.responses)) {
        expect(Object.keys(response.headers).length).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('resolves every $ref it uses', () => {
    const refs = new Set<string>()
    JSON.stringify(document, (key, value) => {
      if (key === '$ref' && typeof value === 'string') refs.add(value)
      return value
    })
    expect(refs.size).toBeGreaterThan(0)
    for (const ref of refs) {
      // Resolve by SECTION rather than assuming every ref is a schema —
      // headers and parameters are referenced the same way, and a check that
      // only knew about schemas passed by looking up the wrong table and
      // finding undefined nowhere near the ref that was actually wrong.
      const match = /^#\/components\/([^/]+)\/(.+)$/.exec(ref)
      expect(match).toBeTruthy()
      const [, section, name] = match as RegExpExecArray
      expect(document.components[section]?.[name]).toBeTruthy()
    }
  })

  it('tags every operation with a declared tag', () => {
    const declared = new Set(document.tags.map((tag: any) => tag.name))
    for (const { op } of operations(document)) {
      expect(op.tags?.length).toBeGreaterThan(0)
      for (const tag of op.tags) expect(declared.has(tag)).toBe(true)
    }
  })
})

describe('buildAgentOpenApi — what it describes', () => {
  it('describes the discovery files every site serves', () => {
    const document = spec()
    for (const path of [
      '/openapi.json',
      '/llms.txt',
      '/robots.txt',
      '/sitemap.xml',
      '/manifest.webmanifest',
      '/{path}',
      '/api/host',
      '/api/screen',
      '/api/health',
    ]) {
      expect(document.paths[path]).toBeTruthy()
    }
  })

  it('is read-only — no operation is a write', () => {
    // Stated in the document too, so a reader who needs a write endpoint is
    // told where to look rather than concluding there is none.
    for (const { method } of operations(spec({ hasSearch: true }))) {
      expect(method).toBe('get')
    }
    expect(spec().info.description).toContain('Write endpoints are deliberately')
  })

  it('describes the markdown variant as a negotiable Accept header', () => {
    const page = spec().paths['/{path}'].get
    const accept = page.parameters.find((p: any) => p.name === 'Accept')
    expect(accept.in).toBe('header')
    expect(accept.schema.enum).toEqual(['text/html', 'text/markdown'])
    expect(page.responses['200'].content['text/markdown']).toBeTruthy()
    expect(page.responses['406']).toBeTruthy()
    expect(page.responses['200'].headers.Vary).toBeTruthy()
  })

  it('omits the feed operation on a site with no collections', () => {
    // An operation that 404s is the defect that makes a client distrust the
    // whole document.
    expect(spec().paths['/{collectionSlug}/rss.xml']).toBeUndefined()
  })

  it('constrains the feed slug to the collections this site actually has', () => {
    const document = spec({
      collections: [{ slug: 'blog', name: 'Blog' }, { slug: 'news' }],
    })
    const parameter = document.paths['/{collectionSlug}/rss.xml'].get.parameters[0]
    expect(parameter.schema.enum).toEqual(['blog', 'news'])
  })

  it('omits search unless the site serves it', () => {
    expect(spec().paths['/search']).toBeUndefined()
    expect(spec({ hasSearch: true }).paths['/search'].get.operationId).toBe(
      'searchSite',
    )
  })

  it('serializes to JSON without cycles or undefined leaves', () => {
    const json = JSON.stringify(spec({ collections: [{ slug: 'blog' }] }))
    expect(json).not.toContain('undefined')
    expect(JSON.parse(json).openapi).toBe('3.1.0')
  })
})

describe('buildAgentOpenApi — the API catalog (AGL-2750)', () => {
  it('documents the path `API_CATALOG_PATH` names', () => {
    /*
      The key is a LITERAL in the builder, not `[API_CATALOG_PATH]`, because
      `check:agent-readiness` parses the path keys out of the source to assert
      that the WAF admits every one of them — and a computed key is invisible
      to a regex. This test is what keeps the literal and the constant in step,
      and it is the whole reason the duplication is allowed to exist.
    */
    expect(Object.keys(spec().paths)).toContain(API_CATALOG_PATH)
  })

  it('serves it as a linkset rather than as bare JSON', () => {
    const operation = spec().paths[API_CATALOG_PATH].get
    expect(Object.keys(operation.responses['200'].content)).toEqual([
      API_CATALOG_MEDIA_TYPE,
    ])
  })

  it('describes the catalog rather than leaving it an untyped object', () => {
    const operation = spec().paths[API_CATALOG_PATH].get
    const ref = operation.responses['200'].content[API_CATALOG_MEDIA_TYPE].schema
    expect(ref.$ref).toBe('#/components/schemas/ApiCatalog')
    // A $ref nothing resolves is worse than no schema: a generator follows it.
    expect(spec().components.schemas.ApiCatalog).toBeDefined()
    expect(spec().components.schemas.CatalogLink).toBeDefined()
  })
})
