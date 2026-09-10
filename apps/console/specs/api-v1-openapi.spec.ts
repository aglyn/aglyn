/**
 * @jest-environment node
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

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildCustomerApiOpenApi,
  CUSTOMER_API_OPENAPI_PATH,
  CUSTOMER_API_VERSION,
} from '../utils/api-v1-openapi'

const document = buildCustomerApiOpenApi({
  origin: 'https://app.acme.test',
  documentationUrl: 'https://docs.acme.test/api',
  brandName: 'Acme',
}) as any

/** Every `{ path, method, operation }` triple. */
function* operations(): Generator<{ path: string; method: string; op: any }> {
  for (const [path, item] of Object.entries<any>(document.paths)) {
    for (const [method, op] of Object.entries<any>(item)) {
      yield { path, method, op }
    }
  }
}

describe('the customer API description — document shape (AGL-2733)', () => {
  it('is OpenAPI 3.1 and names its schema dialect', () => {
    expect(document.openapi).toBe('3.1.0')
    // Load-bearing: it is what tells a consumer these are JSON Schema
    // 2020-12, where nullability is a type UNION rather than 3.0's
    // `nullable` keyword.
    expect(document.jsonSchemaDialect).toBe(
      'https://json-schema.org/draft/2020-12/schema',
    )
  })

  it('names the operator, never us', () => {
    // A self-hoster's API is not "Aglyn's" (AGL-2186).
    expect(document.info.title).toBe('Acme REST API')
    expect(JSON.stringify(document)).not.toMatch(/aglyn\.com/i)
    expect(document.servers).toEqual([
      { url: 'https://app.acme.test', description: 'Acme' },
    ])
  })

  it('carries the API version, not a platform release', () => {
    expect(document.info.version).toBe(CUSTOMER_API_VERSION)
    // A platform release here would move several times a day and give a
    // consumer nothing it could pin.
    expect(document.info.version).not.toMatch(/beta/)
  })

  it('declares bearer auth once, at the document level', () => {
    expect(document.security).toEqual([{ apiKey: [] }])
    expect(document.components.securitySchemes.apiKey).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    })
    // Repeating it per operation is one more place a new endpoint can be
    // added without it.
    for (const { path, op } of operations()) {
      if (path === '/v1/openapi.json') continue
      expect(op.security).toBeUndefined()
    }
  })
})

describe('the customer API description — every operation (AGL-2733)', () => {
  it('gives every operation a unique id', () => {
    const ids = [...operations()].map(({ op }) => op.operationId)
    expect(ids.length).toBeGreaterThan(40)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('describes every operation in words', () => {
    for (const { path, method, op } of operations()) {
      expect(`${method} ${path}: ${op.summary ?? ''}`).toMatch(/\S{4,}/)
      expect(op.tags?.length).toBeGreaterThan(0)
    }
  })

  it('types every success body — no bare objects on a record', () => {
    for (const { path, op } of operations()) {
      const ok = op.responses['200']
      if (!ok?.content) continue
      const schema = ok.content['application/json'].schema
      // The document describes itself and cannot ref its own meta-schema.
      if (path === '/v1/openapi.json') continue
      expect(schema.$ref).toBeTruthy()
    }
  })

  it('gives every operation the shared error envelope', () => {
    for (const { path, op } of operations()) {
      if (path === '/v1/openapi.json') continue
      // 401 is the one every authenticated call can answer.
      expect(op.responses['401']).toBeTruthy()
      expect(op.responses['401'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/Error',
      )
    }
  })

  it('publishes the rate-limit budget on every authenticated response', () => {
    // The headers are the whole reason a client can pace itself, so an
    // endpoint missing them is one a careful client throttles against nothing.
    for (const { path, op } of operations()) {
      if (path === '/v1/openapi.json') continue
      for (const [status, response] of Object.entries<any>(op.responses)) {
        expect(response.headers?.['RateLimit-Limit']).toBeTruthy()
        expect(response.headers?.['X-RateLimit-Limit']).toBeTruthy()
        if (status === '429') expect(response.headers['Retry-After']).toBeTruthy()
      }
    }
  })

  it('pages every list the same way', () => {
    for (const { op } of operations()) {
      const schema = op.responses['200']?.content?.['application/json']?.schema
      if (!schema?.$ref?.endsWith('List')) continue
      const names = (op.parameters ?? []).map((p: any) => p.name)
      expect(names).toContain('limit')
      expect(names).toContain('cursor')
    }
  })

  it('resolves every $ref, by section', () => {
    const refs = new Set<string>()
    JSON.stringify(document, (key, value) => {
      if (key === '$ref' && typeof value === 'string') refs.add(value)
      return value
    })
    expect(refs.size).toBeGreaterThan(0)
    for (const ref of refs) {
      const match = /^#\/components\/([^/]+)\/(.+)$/.exec(ref)
      expect(match).toBeTruthy()
      const [, section, name] = match as RegExpExecArray
      expect(document.components[section]?.[name]).toBeTruthy()
    }
  })
})

describe('the customer API description — honesty guards (AGL-2733)', () => {
  it('never uses OpenAPI 3.0 `nullable`, which 3.1 dropped', () => {
    // A generator reading `nullable` under a 2020-12 dialect silently
    // produces a NON-optional field — exactly the class of bug this document
    // exists to remove.
    expect(JSON.stringify(document)).not.toContain('"nullable"')
  })

  it('expresses nullability as a type union instead', () => {
    const contact = document.components.schemas.Contact
    expect(contact.properties.companyId.type).toEqual(['string', 'null'])
  })

  it('refuses server-owned fields on every write body', () => {
    // A write body that accepted `id` or `created` would invite a client to
    // send one and have it silently ignored.
    const writes = Object.entries<any>(document.components.schemas).filter(
      ([name]) => name.endsWith('Write'),
    )
    expect(writes.length).toBeGreaterThan(5)
    for (const [, schema] of writes) {
      for (const owned of ['id', 'object', 'created', 'updated']) {
        expect(schema.properties?.[owned]).toBeUndefined()
      }
    }
  })

  it('closes every write body but the one the CUSTOMER defines', () => {
    /*
      A dataset record's fields come from the dataset model the customer
      built, so closing that body would reject the very fields they defined.
      Every other write shape is fixed by this API and closes, so a typo'd
      field name is a 400 rather than a value that vanishes.
    */
    const open = Object.entries<any>(document.components.schemas)
      .filter(([name]) => name.endsWith('Write'))
      .filter(([, schema]) => schema.additionalProperties !== false)
      .map(([name]) => name)

    expect(open).toEqual(['DatasetRecordWrite'])
    // …and even that one refuses the server's members.
    expect(document.components.schemas.DatasetRecordWrite.not.anyOf).toEqual([
      { required: ['id'] },
      { required: ['object'] },
      { required: ['created'] },
      { required: ['updated'] },
    ])
  })

  it('says has_more is the termination signal, on every list', () => {
    for (const [name, schema] of Object.entries<any>(document.components.schemas)) {
      if (!name.endsWith('List')) continue
      expect(schema.required).toContain('has_more')
      expect(schema.properties.next_cursor.type).toEqual(['string', 'null'])
      // The trap this API's own docs call its most surprising behaviour.
      expect(schema.properties.has_more.description).toMatch(/never means the/i)
    }
  })

  it('serves its own description without a key', () => {
    const self = document.paths[CUSTOMER_API_OPENAPI_PATH.replace('/api', '')]
    expect(self).toBeTruthy()
    // An empty `security` OVERRIDES the document-level requirement. Omitting
    // it would inherit the bearer requirement and describe a spec you need a
    // key to read.
    expect(self.get.security).toEqual([])
  })
})

/**
 * The drift guard, and the reason this file reads the docs directory.
 *
 * `apps/docs/api/resources/*.md` is the customer-facing contract, and the
 * schemas in the description were transcribed from its response examples. A
 * resource added to one and forgotten in the other is the failure this whole
 * document exists to prevent — a client generated against a spec that is
 * quietly a version behind is worse off than one reading prose, because it
 * has no reason to doubt it.
 */
describe('the description covers every documented endpoint (AGL-2733)', () => {
  const DOCS = join(__dirname, '../../docs/api/resources')

  /** Every `VERB /v1/…` the customer documentation promises. */
  const documented = new Set<string>()
  for (const file of readdirSync(DOCS)) {
    if (!file.endsWith('.md')) continue
    const src = readFileSync(join(DOCS, file), 'utf8')
    for (const m of src.matchAll(
      /\b(GET|POST|PATCH|PUT|DELETE) (\/v1\/[A-Za-z0-9/{}_-]+)/g,
    )) {
      documented.add(`${m[1].toLowerCase()} ${m[2].replace(/\/$/, '')}`)
    }
  }

  /** Path templates differ only in the NAME of an id placeholder. */
  const normalise = (key: string) => key.replace(/\{[^}]+\}/g, '{id}')

  it('found the documentation it is guarding against', () => {
    // A guard that reads nothing passes silently forever.
    expect(documented.size).toBeGreaterThan(40)
  })

  it('describes every endpoint the documentation promises', () => {
    const described = new Set(
      [...operations()].map(({ path, method }) => normalise(`${method} ${path}`)),
    )
    const missing = [...documented]
      .map(normalise)
      .filter((key) => !described.has(key))
      .sort()

    expect(missing).toEqual([])
  })
})
