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
  TRANSFER_EXPORT_PREFETCH_ROWS,
  TRANSFER_EXPORT_SELECTION_MAX,
  type TransferExportScope,
  type TransferFormat,
} from '@aglyn/aglyn/data-transfer'
import type {
  PluginTransferResource,
  ResolvedTransferResource,
  TransferReadOptions,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { readTransferPrefs, streamTransferExport } from './transfer-export'
import { TransferEngineError } from './transfer-jobs'

/**
 * The field-selectable export (AGL-3525) over a test-only `bottles`
 * resource: the chosen fields in the chosen order, each format, the scope
 * and the scope tokens handed to `readPage`, and the row count promised
 * before the first byte — by the resource, by reading ahead, or not at all.
 */

const BOTTLES = Array.from({ length: 7 }, (_unused, index) => ({
  id: `b${index}`,
  name: `Bottle, ${index}`,
  grapes: ['Merlot', 'Syrah'],
  meta: { cellar: index },
}))

const reads: TransferReadOptions[] = []
let countHook: ((options: TransferReadOptions) => number) | null = null
let pageSize = 3
let total = BOTTLES.length

function impl(): PluginTransferResource {
  return {
    fields: () => ({
      standard: [
        { id: 'name', label: 'Name', type: 'text' },
        { id: 'grapes', label: 'Grapes', type: 'tags' },
        { id: 'meta', label: 'Meta', type: 'json' },
      ],
    }),
    matchKeys: [{ fieldId: 'id', normalizer: 'aglynId' }],
    ...(countHook ? { count: async (_ctx, options) => (countHook as (options: TransferReadOptions) => number)(options) } : {}),
    readPage: async (_ctx, cursor, fieldIds, options) => {
      reads.push(options ?? {})
      const all = Array.from({ length: total }, (_unused, index) => BOTTLES[index % BOTTLES.length] as Record<string, unknown>)
      const chosen = options?.ids ? all.filter((row) => options.ids?.includes(String(row['id']))) : all
      const start = Number(cursor ?? 0)
      const rows = chosen.slice(start, start + pageSize).map((row) => Object.fromEntries(fieldIds.map((id) => [id, row[id]])))
      return { rows, next: start + pageSize < chosen.length ? String(start + pageSize) : null }
    },
    lookup: async () => ({ lookup: new Map(), records: new Map() }),
    apply: async () => ({ results: [], undo: [] }),
    revert: async () => ({ done: [], conflicts: [] }),
  }
}

const deps = () => ({
  now: () => Date.UTC(2026, 9, 5),
  resolveResource: async (): Promise<ResolvedTransferResource> => ({
    pluginId: 'cellar',
    key: 'bottles',
    label: 'Bottles',
    scope: 'org',
    kinds: ['records'],
    formats: ['csv', 'json', 'ndjson'],
    impl: impl(),
  }),
})

const run = (
  overrides: {
    fieldIds?: string[]
    scope?: TransferExportScope
    format?: TransferFormat
    bom?: boolean
    scopeTokens?: string[]
    headers?: Record<string, string>
  } = {},
) =>
  streamTransferExport(deps(), {
    orgId: 'org-1',
    actorUid: 'uid-1',
    resource: 'bottles',
    fieldIds: overrides.fieldIds ?? ['name', 'id', 'grapes'],
    scope: overrides.scope ?? { kind: 'all' },
    format: overrides.format ?? 'csv',
    bom: overrides.bom ?? false,
    ...(overrides.scopeTokens ? { scopeTokens: overrides.scopeTokens } : {}),
    ...(overrides.headers ? { headers: overrides.headers } : {}),
  })

// `Response.text()` drops a byte-order mark; the bytes keep it.
const text = async (stream: ReadableStream<Uint8Array>) =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(await new Response(stream).arrayBuffer())

beforeEach(() => {
  reads.length = 0
  countHook = null
  pageSize = 3
  total = BOTTLES.length
})

describe('the field-selectable export', () => {
  it('writes the chosen fields in the chosen order as CSV, labels first, lists joined, with a byte-order mark when asked', async () => {
    const file = await run({ bom: true })
    const body = await text(file.stream)
    expect(body.charCodeAt(0)).toBe(0xfeff)
    const lines = body.slice(1).split('\r\n')
    expect(lines[0]).toMatch(/^Name,.*ID,Grapes$/)
    expect(lines[1]).toBe('"Bottle, 0",b0,Merlot; Syrah')
    expect(lines.filter(Boolean)).toHaveLength(8)
    expect(file).toMatchObject({ rows: 7, fileName: 'bottles-2026-10-05.csv', contentType: 'text/csv', label: 'Bottles' })
  })

  it("writes a preset's column names in place of labels, for the chosen fields only and never twice", async () => {
    const file = await run({ headers: { name: 'Wine', id: 'wine', grapes: 7 as never, other: 'X' } })
    const lines = (await text(file.stream)).split('\r\n')
    // "wine" repeats "Wine" in another case, so the ID keeps its label; a non-text name is ignored.
    expect(lines[0]).toMatch(/^Wine,.*ID,Grapes$/)
  })

  it('writes JSON as one array and NDJSON as one object a line, keyed by field id', async () => {
    const json = await run({ fieldIds: ['id', 'meta'], format: 'json' })
    expect(JSON.parse(await text(json.stream))).toEqual(BOTTLES.map((row) => ({ id: row.id, meta: row.meta })))
    const ndjson = await run({ fieldIds: ['id'], format: 'ndjson' })
    expect((await text(ndjson.stream)).trim().split('\n').map((line) => JSON.parse(line))).toEqual(BOTTLES.map((row) => ({ id: row.id })))
  })

  it('reads the selection, the filter and a collaborator’s scope tokens through readPage', async () => {
    const selected = await run({ scope: { kind: 'selection', ids: ['b2', 'b4', 'b2'] }, scopeTokens: ['host:h1'] })
    expect((await text(selected.stream)).split('\r\n').filter(Boolean)).toHaveLength(3)
    expect(reads[0]).toMatchObject({ ids: ['b2', 'b4'], scopeTokens: ['host:h1'] })
    await run({ scope: { kind: 'filter', filter: { stage: 'open' } } })
    expect(reads.at(-1)).toMatchObject({ filter: { stage: 'open' } })
    expect(reads.at(-1)).not.toHaveProperty('scopeTokens')
  })

  it('promises the resource’s own count, and no count for a file past the read-ahead it cannot count', async () => {
    countHook = (options) => (options.ids ? options.ids.length : 7)
    const counted = await run()
    expect(counted.rows).toBe(7)
    expect(reads).toHaveLength(0)
    await text(counted.stream)

    countHook = null
    pageSize = 1000
    total = TRANSFER_EXPORT_PREFETCH_ROWS + 1
    const large = await run({ fieldIds: ['id'] })
    expect(large.rows).toBeNull()
    expect((await text(large.stream)).split('\r\n').filter(Boolean)).toHaveLength(total + 1)
  })

  it('refuses a field the catalog no longer has, an empty or oversized selection, and a format the resource does not write', async () => {
    const refused = async (promise: Promise<unknown>) => {
      try {
        await promise
      } catch (error) {
        if (error instanceof TransferEngineError) return error
        throw error
      }
      throw new Error('expected a refusal')
    }
    expect(await refused(run({ fieldIds: ['name', 'gone'] }))).toMatchObject({ code: 'invalid', details: { unknown: ['gone'] } })
    expect(await refused(run({ scope: { kind: 'selection', ids: [] } }))).toMatchObject({ code: 'invalid' })
    const many = Array.from({ length: TRANSFER_EXPORT_SELECTION_MAX + 1 }, (_unused, index) => `b${index}`)
    expect(await refused(run({ scope: { kind: 'selection', ids: many } }))).toMatchObject({ code: 'tooLarge', status: 413 })
    expect(await refused(run({ format: 'xml' as TransferFormat }))).toMatchObject({ code: 'unsupportedFormat', status: 415 })
  })
})

describe('remembered choices', () => {
  it('reads a person’s prefs for a resource, dropping what is not the right shape', async () => {
    const stored = {
      presets: [{ id: 'p1', label: 'Mine', fieldIds: ['id', 3] }, { label: 'no id' }],
      export: { presetId: 'p1', fieldIds: ['id'], format: 'csv', bom: true, scope: 'nope' },
    }
    const firestore = {
      collection: (name: string) => ({
        doc: (uid: string) => ({
          collection: (sub: string) => ({
            doc: (key: string) => ({
              get: async () => ({
                exists: name === 'users' && uid === 'uid-1' && sub === 'transferPrefs' && key === 'bottles',
                data: () => stored,
              }),
            }),
          }),
        }),
      }),
    } as unknown as FirebaseFirestore.Firestore
    expect(await readTransferPrefs(firestore, 'uid-1', 'bottles')).toEqual({
      presets: [{ id: 'p1', label: 'Mine', fieldIds: ['id'] }],
      export: { presetId: 'p1', fieldIds: ['id'], format: 'csv', bom: true, scope: 'all' },
    })
    expect(await readTransferPrefs(firestore, 'uid-2', 'bottles')).toEqual({ presets: [] })
  })
})
