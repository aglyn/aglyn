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
 * The memory client runs the whole job the way the engine will: upload,
 * analyze, plan, chunked apply behind the acknowledgements, results, and an
 * undo that asks about a record edited since. The wizard's specs drive the
 * same client, so what is pinned here is what they stand on.
 */

import { createTransferPolicy } from '@aglyn/aglyn/data-transfer'

import { PEOPLE_CSV, createPeopleClient } from '../fixtures/people'
import { detectTransferFileSettings } from './transfer-file'

const blobText = (blob: Blob): Promise<string> =>
  new Promise((resolve) => {
    const reader = new FileReader()
    // Decoded by hand: `readAsText` drops a byte-order mark, which is what is checked.
    reader.onload = () =>
      resolve(
        new TextDecoder('utf-8', { ignoreBOM: true }).decode(
          reader.result as ArrayBuffer,
        ),
      )
    reader.readAsArrayBuffer(blob)
  })

const MAPPING = {
  0: 'name',
  1: 'email',
  2: 'phone',
  3: 'joined',
  4: 'stage',
  5: 'team',
  6: 'score',
}

async function uploaded(client = createPeopleClient()) {
  const job = await client.upload({
    resource: 'people',
    fileName: 'people.csv',
    text: PEOPLE_CSV,
    bytes: PEOPLE_CSV.length,
    settings: detectTransferFileSettings('people.csv', PEOPLE_CSV),
  })
  return { client, job }
}

describe('createMemoryTransferClient', () => {
  it('proposes a field for every column, with the reason', async () => {
    const { client, job } = await uploaded()
    const analysis = await client.analyze({ jobId: job.id })
    expect(analysis.rowCount).toBe(4)
    expect(analysis.proposal.mapping).toEqual(MAPPING)
    expect(analysis.proposal.proposals[0]).toEqual(
      expect.objectContaining({ fieldId: 'name', reason: 'exactAlias' }),
    )
    expect(analysis.job.status).toBe('analyzed')
  })

  it('reads the values under a mapping: picklists, lookups, dates and matches', async () => {
    const { client, job } = await uploaded()
    const analysis = await client.analyze({ jobId: job.id, mapping: MAPPING })
    expect(
      analysis.picklists?.[0]?.unmatched.map((value) => value.value),
    ).toEqual(['Prospect'])
    expect(analysis.lookups?.[0]?.unresolved).toEqual([
      expect.objectContaining({
        value: 'Reseach',
        suggestions: [{ recordId: 'team-1', label: 'Research' }],
      }),
    ])
    expect(
      analysis.derivations?.find((summary) => summary.fieldId === 'joined')
        ?.ambiguousDates,
    ).toBe(1)
    expect(analysis.matches?.summary).toEqual({
      new: 1,
      matched: 2,
      ambiguous: 0,
      duplicateInFile: 1,
    })
  })

  it('finds an ambiguous match when the name is a key', async () => {
    const { client, job } = await (async () => {
      const text = 'Name\nSam Lee'
      const memory = createPeopleClient()
      const created = await memory.upload({
        resource: 'people',
        fileName: 'x.csv',
        text,
        bytes: text.length,
        settings: detectTransferFileSettings('x.csv', text),
      })
      return { client: memory, job: created }
    })()
    const analysis = await client.analyze({
      jobId: job.id,
      mapping: { 0: 'name' },
      matchKeys: ['name'],
    })
    expect(analysis.matches?.summary.ambiguous).toBe(1)
  })

  it('plans, refuses to apply without the acknowledgements, applies in chunks and undoes', async () => {
    const { client, job } = await uploaded(createPeopleClient({ chunkRows: 2 }))
    const choices = {
      mapping: MAPPING,
      dateOrders: { joined: 'mdy' as const },
      picklistChoices: {
        stage: { prospect: { action: 'leaveBlank' as const } },
      },
      lookupChoices: {
        team: { reseach: { action: 'mapTo' as const, recordId: 'team-1' } },
      },
      matchKeys: ['id', 'email'],
    }
    const policy = createTransferPolicy({
      fields: { phone: { mode: 'overwrite' } },
    })
    const planned = await client.plan({ jobId: job.id, ...choices, policy })
    expect(planned.plan.summary).toEqual({
      create: 1,
      update: 2,
      unchanged: 0,
      skip: 1,
      fail: 0,
      total: 4,
    })
    expect(
      planned.conflicts
        .find((conflict) => conflict.recordId === 'rec-1')
        ?.fields.map((field) => field.fieldId),
    ).toEqual(['phone', 'score'])
    expect(planned.plan.acknowledgementsRequired).toEqual(
      expect.arrayContaining([
        'unmatchedPicklist',
        'unresolvedLookup',
        'duplicateInFile',
        'overwriteNonBlank',
      ]),
    )

    await expect(
      client.apply({ jobId: job.id, acknowledged: [] }),
    ).rejects.toThrow(/acknowledged/)

    const first = await client.apply({
      jobId: job.id,
      acknowledged: planned.plan.acknowledgementsRequired,
    })
    expect(first).toEqual(
      expect.objectContaining({ rowsDone: 2, rowCount: 4, done: false }),
    )
    const second = await client.apply({
      jobId: job.id,
      acknowledged: planned.plan.acknowledgementsRequired,
    })
    expect(second.done).toBe(true)
    expect(second.job.status).toBe('applied')
    expect(client.records.get('rec-1')?.values['score']).toBe(50)
    expect(client.records.get('rec-2')?.values['team']).toBe('team-1')

    const results = await client.results({ jobId: job.id })
    expect(results.summary).toEqual({
      created: 1,
      updated: 2,
      unchanged: 0,
      skipped: 1,
      failed: 0,
      total: 4,
    })

    client.records.get('rec-2')!.values['team'] = 'team-9'
    const preview = await client.undo({ jobId: job.id, mode: 'preview' })
    expect(preview.conflicts.map((conflict) => conflict.recordId)).toEqual([
      'rec-2',
    ])
    await expect(
      client.undo({ jobId: job.id, mode: 'apply', decisions: {} }),
    ).rejects.toThrow(/edited since/)
    const undone = await client.undo({
      jobId: job.id,
      mode: 'apply',
      decisions: { 'rec-2': 'keep' },
    })
    expect(undone.done).toBe(true)
    expect(undone.job.status).toBe('undone')
    expect(client.records.get('rec-1')?.values['phone']).toBe('+1 555 0100')
    expect(client.records.get('rec-2')?.values['team']).toBe('team-9')
    expect([...client.records.keys()]).toEqual([
      'rec-1',
      'rec-2',
      'rec-3',
      'rec-4',
    ])
  })

  it('exports the chosen fields in the chosen order, with a byte-order mark when asked', async () => {
    const client = createPeopleClient()
    const file = await client.export({
      resource: 'people',
      fieldIds: ['email', 'id'],
      scope: { kind: 'selection', ids: ['rec-2'] },
      format: 'csv',
      bom: true,
    })
    expect(file.rowCount).toBe(1)
    expect(await blobText(file.body)).toBe(
      '﻿Email,Aglyn ID\r\ngrace@example.com,rec-2\r\n',
    )
  })
})
