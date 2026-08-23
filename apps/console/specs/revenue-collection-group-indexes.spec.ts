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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every collection-group filter the revenue route runs must have a deployed
 * COLLECTION_GROUP index (AGL-2486).
 *
 * ## The bug this exists to prevent recurring
 *
 * `/admin/revenue` reported $0 for everything and raised two banners, and
 * BOTH traced to this. The storefront sweep ranged
 * `collectionGroup('orders')` on `createdAt`, and the unbilled-meter sweep
 * ranged `collectionGroup('usage')` on `month`. Neither field has a
 * COLLECTION_GROUP index, because Firestore's automatic single-field indexes
 * are COLLECTION scope only — a collection group gets no free ride, however
 * simple the filter. Both queries therefore answered FAILED_PRECONDITION on
 * every single request, forever, and both were wrapped in `.catch(() => null)`
 * so neither ever surfaced as an error.
 *
 * The orders one was the expensive half: an order carries BOTH a `createdAt`
 * server timestamp and a `createdAtMs` millisecond copy, and it is
 * `createdAtMs` that has the deployed COLLECTION_GROUP index (AGL-1793). So
 * the query was not missing an index — it was reading the wrong one of two
 * interchangeable fields, and "deploy the index" would have been the wrong
 * fix, adding a second index for a redundant field.
 *
 * ## Why this parses the ROUTE rather than listing fields by hand
 *
 * A hand-written list of expected indexes is a guard that passes for the
 * wrong reason the moment someone edits the query: it asserts what the config
 * says, not what the code asks for. This reads the queries out of the route
 * source and checks each against the config, so changing the queried field
 * back to `createdAt` fails this spec without anyone remembering to update it.
 */

const ROUTE_PATH = join(
  __dirname,
  '..',
  'app',
  'api',
  'admin',
  'revenue',
  'route.ts',
)
const INDEX_CONFIG_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'cloud',
  'firebase-firestore.indexes.json',
)

/**
 * Collection-group names the route names through a constant rather than a
 * literal. Resolved here so the parser does not have to evaluate imports.
 */
const CONSTANT_COLLECTION_GROUPS: Record<string, string> = {
  ORG_BILLING_SUBCOLLECTION: 'billing',
}

/** Source with comments removed, so prose about a field is never parsed as code. */
function sourceWithoutComments(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

interface CollectionGroupQuery {
  collectionGroup: string
  fields: string[]
}

/**
 * Every `collectionGroup(...)` in the route, with the fields it filters on.
 *
 * A chain is read from the `collectionGroup(` call up to the next one (or the
 * end), which is enough because the route never nests two in one expression.
 */
function collectionGroupQueries(source: string): CollectionGroupQuery[] {
  const out: CollectionGroupQuery[] = []
  const opener = /collectionGroup\(\s*(?:['"]([\w$]+)['"]|([\w$]+))\s*\)/g
  const starts: { name: string; end: number }[] = []
  for (const match of source.matchAll(opener)) {
    const literal = match[1]
    const identifier = match[2]
    const name = literal ?? CONSTANT_COLLECTION_GROUPS[identifier ?? '']
    // An unresolvable identifier must fail loudly rather than be skipped —
    // a silently ignored query is exactly the hole this spec closes.
    expect(name).toBeTruthy()
    starts.push({
      name: name as string,
      end: (match.index ?? 0) + match[0].length,
    })
  }
  starts.forEach((start) => {
    // Walk the CONTIGUOUS method chain hanging off this `collectionGroup(...)`
    // call, rather than slicing text up to some guessed terminator. A slice
    // swallows `.where` calls belonging to the next query — which it did,
    // attributing `platformRevenue`'s `paidAt` filter to the billing group.
    let cursor = start.end
    const fields: string[] = []
    for (;;) {
      const rest = source.slice(cursor)
      const step = rest.match(/^\s*\.(\w+)\(/)
      if (!step) break
      const openIndex = cursor + step[0].length - 1
      // Consume to the matching close paren so a nested call cannot end the
      // step early.
      let depth = 0
      let index = openIndex
      for (; index < source.length; index += 1) {
        if (source[index] === '(') depth += 1
        else if (source[index] === ')') {
          depth -= 1
          if (depth === 0) break
        }
      }
      if (index >= source.length) break
      if (step[1] === 'where') {
        const arg = source.slice(openIndex, index).match(/['"]([\w.]+)['"]/)
        if (arg) fields.push(arg[1])
      }
      cursor = index + 1
    }
    out.push({ collectionGroup: start.name, fields: [...new Set(fields)] })
  })
  return out
}

/** The COLLECTION_GROUP-scoped field paths the deployed config declares. */
function collectionGroupIndexedFields(): Set<string> {
  const config = JSON.parse(readFileSync(INDEX_CONFIG_PATH, 'utf8'))
  const out = new Set<string>()
  for (const override of config.fieldOverrides ?? []) {
    for (const index of override.indexes ?? []) {
      if (index.queryScope === 'COLLECTION_GROUP') {
        out.add(`${override.collectionGroup}.${override.fieldPath}`)
      }
    }
  }
  for (const index of config.indexes ?? []) {
    if (index.queryScope !== 'COLLECTION_GROUP') continue
    for (const field of index.fields ?? []) {
      out.add(`${index.collectionGroup}.${field.fieldPath}`)
    }
  }
  return out
}

describe('revenue route collection-group queries', () => {
  const source = sourceWithoutComments(ROUTE_PATH)
  const queries = collectionGroupQueries(source)

  it('finds the collection-group queries at all', () => {
    // Guards the PARSER. A regex that silently matched nothing would make
    // every assertion below vacuously true — the "green check that only
    // proves what it reads" failure.
    expect(queries.length).toBeGreaterThan(0)
    expect(queries.map((query) => query.collectionGroup)).toContain('orders')
  })

  it.each([
    ['orders', 'createdAtMs'],
    ['billing', undefined],
  ] as [string, string | undefined][])(
    'reads %s on the field the index config actually covers',
    (collectionGroup, expectedField) => {
      const query = queries.find(
        (candidate) => candidate.collectionGroup === collectionGroup,
      )
      expect(query).toBeDefined()
      if (expectedField === undefined) {
        // An UNFILTERED collection group needs no index, and that is the only
        // reason it is exempt — so the exemption is asserted, not assumed.
        expect(query?.fields).toEqual([])
        return
      }
      expect(query?.fields).toContain(expectedField)
    },
  )

  it('never filters a collection group on a field with no COLLECTION_GROUP index', () => {
    const indexed = collectionGroupIndexedFields()
    const missing: string[] = []
    for (const query of queries) {
      for (const field of query.fields) {
        const key = `${query.collectionGroup}.${field}`
        if (!indexed.has(key)) missing.push(key)
      }
    }
    expect(missing).toEqual([])
  })

  it('proves the guard can fail: an undeclared field is reported', () => {
    // The negative control. Without this, a parser that produced empty
    // `fields` for every query would pass the assertion above while checking
    // nothing at all.
    const indexed = collectionGroupIndexedFields()
    expect(indexed.has('orders.createdAtMs')).toBe(true)
    expect(indexed.has('orders.createdAt')).toBe(false)
    expect(indexed.has('usage.month')).toBe(false)
  })
})
