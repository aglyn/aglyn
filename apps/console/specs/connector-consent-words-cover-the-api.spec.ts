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
 * What the consent screen says an app may do covers what it can actually do
 * (AGL-4225).
 *
 * The published API names no scope per operation, so "the right scope's
 * words describe this operation" cannot be read off the document. What CAN
 * be asserted mechanically, against the real document the tools come from:
 *
 *  - every resource an operation touches is NAMED — a read in the words of
 *    some read scope, a write in the words of some write scope;
 *  - every resource that can be deleted is named beside the word "delete";
 *  - the three verbs that are neither create, edit nor delete — convert,
 *    merge, publish — appear beside the resource they act on.
 *
 * So an operation added to a resource the words do not name, or a new kind of
 * act, fails here until the consent screen says it.
 */

import { API_SCOPES } from '@aglyn/tenant-data-admin/server/api-keys'
import { connectorScopeWords } from '@aglyn/tenant-data-admin/server/connector-oauth'
import { describeApiV1Resources } from '@aglyn/tenant-data-admin/server/api-v1-resources'
import { registerPluginServerDeclarations } from '../constants/plugins.declarations.server.generated'
import { buildCustomerApiOpenApi } from '../utils/api-v1-openapi'

interface Operation {
  method: string
  operationId: string
  noun: string
}

let operations: Operation[] = []
const readWords = API_SCOPES.filter((s) => s.endsWith(':read')).map((s) => connectorScopeWords(s).toLowerCase())
const writeWords = API_SCOPES.filter((s) => !s.endsWith(':read')).map((s) => connectorScopeWords(s).toLowerCase())

beforeAll(async () => {
  await registerPluginServerDeclarations()
  const document = buildCustomerApiOpenApi(
    { origin: 'https://app.example.com', documentationUrl: 'https://docs.example.com/api', brandName: 'Example' },
    await describeApiV1Resources(),
  ) as { paths: Record<string, Record<string, { operationId: string; tags?: string[] }>> }
  for (const item of Object.values(document.paths)) {
    for (const [method, op] of Object.entries(item)) {
      const tag = op.tags?.[0] ?? ''
      // The API describing itself — no customer data, no scope.
      if (tag === 'Service') continue
      operations.push({ method: method.toUpperCase(), operationId: op.operationId, noun: tag.toLowerCase() })
    }
  }
})

afterAll(() => {
  operations = []
})

describe('the consent words cover the API (AGL-4225)', () => {
  it('reads a document with every kind of operation in it', () => {
    expect(operations.length).toBeGreaterThan(60)
    expect(new Set(operations.map((op) => op.method))).toEqual(new Set(['GET', 'POST', 'PATCH', 'DELETE']))
  })

  it('names every resource a read touches in some "View" line', () => {
    const unnamed = operations
      .filter((op) => op.method === 'GET' && !readWords.some((words) => words.includes(op.noun)))
      .map((op) => op.operationId)
    expect(unnamed).toEqual([])
  })

  it('names every resource a write touches in some "make changes" line', () => {
    const unnamed = operations
      .filter((op) => op.method !== 'GET' && !writeWords.some((words) => words.includes(op.noun)))
      .map((op) => op.operationId)
    expect(unnamed).toEqual([])
  })

  it('says "delete" beside every resource that can be deleted', () => {
    const unsaid = operations
      .filter((op) => op.method === 'DELETE')
      .filter((op) => !writeWords.some((words) => words.includes(op.noun) && words.includes('delete')))
      .map((op) => op.operationId)
    expect(unsaid).toEqual([])
  })

  it('names convert, merge and publish beside what they act on', () => {
    const special = operations.filter((op) => /^(convert|merge|publish)/.test(op.operationId))
    expect(special.map((op) => op.operationId).sort()).toEqual(['convertLead', 'mergeContact', 'publishSite'])
    for (const op of special) {
      const verb = op.operationId.match(/^(convert|merge|publish)/)?.[1] as string
      expect({ op: op.operationId, said: writeWords.some((words) => words.includes(op.noun) && words.includes(verb)) }).toEqual({
        op: op.operationId,
        said: true,
      })
    }
  })
})
