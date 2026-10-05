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
  TRANSFER_API_ROUTES,
  createTransferPolicy,
  type PlannedTransferRow,
  type TransferJobRecord,
} from '@aglyn/aglyn/data-transfer'
import {
  TransferRequestError,
  createHttpTransferClient,
  splitTransferUpload,
  type HttpTransferClientOptions,
} from './transfer-http-client'

/**
 * The console's transfer client (AGL-3539) against a fetch double: what
 * each kit call sends to which route, and how each answer is turned into
 * what the kit renders.
 */

const JOB: TransferJobRecord = {
  id: 'job-1',
  resource: 'people',
  kind: 'records',
  direction: 'import',
  format: 'csv',
  status: 'draft',
  orgId: 'org-1',
  createdBy: 'uid-1',
  createdAt: 1,
  updatedAt: 1,
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

type Sent = { url: string; body: Record<string, unknown>; authorization: string | null }

function harness(
  answer: (sent: Sent, index: number) => { status?: number; body: unknown; raw?: string; headers?: Record<string, string> },
  options: { hostId?: string | null; partBytes?: number; savePrefs?: HttpTransferClientOptions['savePrefs'] } = {},
) {
  const sent: Sent[] = []
  const fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const entry: Sent = {
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')),
      authorization: (init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? null,
    }
    sent.push(entry)
    const { status = 200, body, raw, headers = {} } = answer(entry, sent.length - 1)
    // jsdom has no `Response`; the client reads only these members.
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => headers[name] ?? null },
      json: async () => copy(body),
      arrayBuffer: async () => new TextEncoder().encode(raw ?? '').buffer,
    } as unknown as Response
  }) as unknown as typeof globalThis.fetch
  const client = createHttpTransferClient({
    orgId: 'org-1',
    hostId: options.hostId === undefined ? 'host-1' : options.hostId,
    getIdToken: async () => 'token-1',
    fetch,
    ...(options.partBytes ? { partBytes: options.partBytes } : {}),
    ...(options.savePrefs ? { savePrefs: options.savePrefs } : {}),
  })
  return { client, sent }
}

const SETTINGS = { format: 'csv' as const, encoding: 'utf-8' as const, delimiter: ';' as const, headerRow: false }

describe('splitting an upload into parts', () => {
  it('keeps every part under the budget once JSON-encoded, and never splits a character', () => {
    const text = 'a"b\n'.repeat(10) + '😀é'.repeat(10)
    const parts = splitTransferUpload(text, 16)
    expect(parts.join('')).toBe(text)
    for (const part of parts) {
      expect(Buffer.byteLength(JSON.stringify(part), 'utf8') - 2).toBeLessThanOrEqual(16)
      expect(part).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/)
    }
    expect(parts.length).toBeGreaterThan(1)
  })

  it('sends a small file whole', () => {
    expect(splitTransferUpload('Name\nAda')).toEqual(['Name\nAda'])
  })
})

describe('the HTTP transfer client', () => {
  it('names the organization and the site, with the Bearer token, on every route', async () => {
    const { client, sent } = harness(() => ({
      body: { ok: true, resource: { key: 'people' }, fields: [], groups: [], matchKeys: [], locked: [], prefs: { presets: [] } },
    }))
    const info = await client.fields({ resource: 'people' })
    expect(sent[0]).toEqual({
      url: TRANSFER_API_ROUTES.fields,
      body: { orgId: 'org-1', resource: 'people', hostId: 'host-1' },
      authorization: 'Bearer token-1',
    })
    expect(info).not.toHaveProperty('ok')
    expect(info.prefs).toEqual({ presets: [] })
  })

  it('uploads a large file in parts, the read choices on the first and the job on the rest', async () => {
    const { client, sent } = harness(
      (_entry, index) => ({ body: { ok: true, job: JOB, complete: index === 2 } }),
      { hostId: null, partBytes: 10 },
    )
    const text = 'x'.repeat(25)
    const job = await client.upload({ resource: 'people', fileName: 'p.csv', text, bytes: 25, settings: SETTINGS })
    expect(job.id).toBe('job-1')
    expect(sent.map((entry) => [entry.body['part'], entry.body['parts'], entry.body['jobId']])).toEqual([
      [0, 3, undefined],
      [1, 3, 'job-1'],
      [2, 3, 'job-1'],
    ])
    expect(sent[0]?.body).toMatchObject({ delimiter: ';', headerRow: false, format: 'csv', hostId: null })
    expect(sent[1]?.body).not.toHaveProperty('delimiter')
    expect(sent.map((entry) => entry.body['content']).join('')).toBe(text)
  })

  it('reads an analysis in the kit’s terms, and sends the choices only with a mapping', async () => {
    const { client, sent } = harness(() => ({
      body: {
        ok: true,
        job: JOB,
        headers: ['Name'],
        rowCount: 1,
        samples: [['Ada']],
        catalog: { fields: [], groups: [] },
        match: { mapping: { 0: 'name' }, proposals: [], conflicts: [] },
        mappingProblems: {},
        matchKeys: [],
        lockedRules: [],
        picklists: [],
        matches: { keys: [], summary: { new: 1, matched: 0, ambiguous: 0, duplicateInFile: 0 }, rows: [] },
      },
    }))
    const bare = await client.analyze({ jobId: 'job-1', matchKeys: ['email'] })
    expect(sent[0]?.body).toEqual({ orgId: 'org-1', jobId: 'job-1' })
    expect(bare.sampleRows).toEqual([['Ada']])
    expect(bare.proposal.mapping).toEqual({ 0: 'name' })
    await client.analyze({ jobId: 'job-1', mapping: { 0: 'name' }, matchKeys: ['email'], dateOrders: { born: 'dmy' } })
    expect(sent[1]?.body).toEqual({
      orgId: 'org-1',
      jobId: 'job-1',
      mapping: { 0: 'name' },
      matchKeys: ['email'],
      dateOrders: { born: 'dmy' },
    })
  })

  it('plans without the locked rules, and says when the rows are a sample', async () => {
    const row = { index: 0, verdict: 'create', recordId: null, diff: [], heldBack: [], warnings: [], match: { kind: 'new' } }
    const { client, sent } = harness(() => ({
      body: {
        ok: true,
        job: { ...JOB, status: 'planned' },
        summary: { create: 300, update: 0, unchanged: 0, skip: 0, fail: 0, total: 300 },
        warnings: [],
        acknowledgementsRequired: [],
        matchSummary: { new: 300, matched: 0, ambiguous: 0, duplicateInFile: 0 },
        invariantFailures: [],
        invariantFailureCount: 0,
        picklistAdditions: {},
        rows: { rows: [row], offset: 0, next: 1 },
        sample: [row as PlannedTransferRow],
        conflicts: [],
        conflictCount: 0,
        ambiguous: [],
        recordLabels: {},
      },
    }))
    const policy = createTransferPolicy({ locked: [{ fieldId: 'email', forced: { mode: 'keepExisting' }, reason: 'Owned' }] })
    const dryRun = await client.plan({ jobId: 'job-1', mapping: { 0: 'name' }, policy, extras: { consent: true } })
    expect(sent[0]?.body).not.toHaveProperty('policy.locked')
    expect(sent[0]?.body).toMatchObject({ mapping: { 0: 'name' }, extras: { consent: true } })
    expect(dryRun.plan.rows).toHaveLength(1)
    expect(dryRun.plan.summary.total).toBe(300)
    expect(dryRun.rowsComplete).toBe(false)
  })

  it('applies one call at a time, and stops on a job that failed', async () => {
    const { client } = harness((_entry, index) => ({
      body: {
        ok: true,
        job:
          index === 0
            ? { ...JOB, status: 'applying' }
            : { ...JOB, status: 'failed', error: { code: 'applyFailed', message: 'Chunk 2 could not be written: gone' } },
        progress: { status: 'applying', chunk: 1, chunkCount: 2, rowsDone: 200, rowCount: 400, results: {} },
        done: false,
        results: [{ row: 0, outcome: 'created', recordId: 'r1' }],
      },
    }))
    const step = await client.apply({ jobId: 'job-1', acknowledged: [] })
    expect(step).toMatchObject({ rowsDone: 200, rowCount: 400, done: false, results: [{ row: 0, outcome: 'created' }] })
    await expect(client.apply({ jobId: 'job-1' })).rejects.toThrow('Chunk 2 could not be written: gone')
  })

  it('reads every result through status, and throws a refusal with its code', async () => {
    const { client, sent } = harness((entry) =>
      entry.body['include'] === 'results'
        ? {
            body: {
              ok: true,
              job: { ...JOB, status: 'applied', results: { created: 1, updated: 0, unchanged: 0, skipped: 0, failed: 0, total: 1 } },
              progress: {},
              undo: { available: true, expiresAt: 2, state: null },
              rows: [{ row: 0, outcome: 'created', recordId: 'r1' }],
            },
          }
        : { status: 409, body: { error: 'This import is applied.', code: 'state' } },
    )
    const results = await client.results({ jobId: 'job-1' })
    expect(sent[0]?.url).toBe(TRANSFER_API_ROUTES.status)
    expect(results.summary.created).toBe(1)
    expect(results.rows).toHaveLength(1)
    const refused = await client.status({ jobId: 'job-1' }).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(TransferRequestError)
    expect(refused).toMatchObject({ code: 'state', status: 409, message: 'This import is applied.' })
  })

  it('pages every undo conflict into the preview, and runs undo with the decisions', async () => {
    const conflict = (row: number) => ({ row, recordId: `r${row}`, action: 'updated', fields: ['name'], current: {}, restore: {} })
    const { client, sent } = harness((entry) => {
      if (entry.body['action'] === 'apply') {
        return { body: { ok: true, job: JOB, undo: { status: 'done', chunk: 1, counts: { restore: 2, delete: 0, conflict: 0, nothing: 0 } }, done: true } }
      }
      const first = entry.body['offset'] === 0
      return {
        body: {
          ok: true,
          job: JOB,
          counts: { restore: 2, delete: 0, conflict: 2, nothing: 0 },
          conflicts: [conflict(first ? 0 : 1)],
          offset: entry.body['offset'],
          next: first ? 1 : null,
          expiresAt: 2,
        },
      }
    })
    const preview = await client.undo({ jobId: 'job-1', mode: 'preview' })
    expect(preview.conflicts.map((entry) => entry.recordId)).toEqual(['r0', 'r1'])
    expect(preview.done).toBe(false)
    const run = await client.undo({ jobId: 'job-1', mode: 'apply', decisions: { r0: 'revert' } })
    expect(sent.at(-1)?.body).toMatchObject({ action: 'apply', decisions: { r0: 'revert' }, otherwise: 'keep' })
    expect(run).toMatchObject({ done: true, counts: { restore: 2 } })
  })

  it('downloads an export whole, keeping the byte-order mark, and refuses one shorter than promised', async () => {
    const csv = '\uFEFFName\r\nAda\r\nBo\r\n'
    const { client, sent } = harness((_entry, index) => ({
      body: null,
      raw: index === 0 ? csv : 'Name\r\nAda\r\n',
      headers: {
        'X-Aglyn-Export-Rows': '2',
        'Content-Disposition': 'attachment; filename="people-2026-10-05.csv"',
      },
    }))
    const choice = { resource: 'people', fieldIds: ['name'], scope: { kind: 'all' as const }, format: 'csv' as const, bom: true }
    const file = await client.export(choice)
    expect(sent[0]).toMatchObject({ url: TRANSFER_API_ROUTES.export, body: { orgId: 'org-1', hostId: 'host-1', ...choice } })
    expect(file.fileName).toBe('people-2026-10-05.csv')
    expect(file.rowCount).toBe(2)
    // Every byte sent, the three of the byte-order mark included.
    expect(file.body.size).toBe(new TextEncoder().encode(csv).length)
    await expect(client.export(choice)).rejects.toThrow('The export stopped after 1 of 2 rows. Try again.')
  })

  it('throws an export refusal with its code, and remembers choices only through the surface’s store', async () => {
    const { client } = harness(() => ({ status: 413, body: { error: 'Select at most 10,000 records.', code: 'tooLarge' } }))
    await expect(
      client.export({ resource: 'people', fieldIds: ['id'], scope: { kind: 'all' }, format: 'json', bom: false }),
    ).rejects.toMatchObject({ code: 'tooLarge', status: 413 })
    await expect(client.savePrefs({ resource: 'people', prefs: { presets: [] } })).rejects.toMatchObject({ code: 'unavailable' })
    const savePrefs = jest.fn(async () => ({ presets: [] }))
    const stored = harness(() => ({ body: null }), { savePrefs })
    await stored.client.savePrefs({ resource: 'people', prefs: { presets: [] } })
    expect(savePrefs).toHaveBeenCalledWith('people', { presets: [] })
  })
})
