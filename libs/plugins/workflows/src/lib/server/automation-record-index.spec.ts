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
 *
 * @jest-environment node
 */

/**
 * The workflows plugin's workflow, webhook and action indexes (AGL-3080):
 * what another surface — an AI job, the "Used by" scan — reads of a site's
 * automations. Live records only, with the facts the module's docblock lists
 * and never a webhook's URL or secret, and a `truncated` that is a fact
 * rather than a guess.
 */

type Doc = Record<string, unknown>
let mockDocs: Record<string, Doc> = {}

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => {
  const query = (prefix: string, max = Infinity): any => ({
    limit: (count: number) => query(prefix, count),
    get: async () => {
      const docs = Object.entries(mockDocs)
        .filter(([path]) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'))
        .slice(0, max)
        .map(([path, data]) => ({ id: path.split('/').pop(), data: () => data }))
      return { docs, size: docs.length }
    },
  })
  const ref = (path: string): any => ({
    collection: (name: string) => ({ ...query(`${path}/${name}`), doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    get: async () => ({
      id: path.split('/').pop(),
      exists: path in mockDocs,
      data: () => mockDocs[path],
    }),
  })
  return {
    firebaseAdmin: {
      app: () => ({ firestore: () => ({ collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }) }) }),
    },
  }
})

import { actionRecordIndex, webhookRecordIndex, workflowRecordIndex } from './automation-record-index'

const STEPS = [{ functionId: 'fn-1', functionName: 'rateFor', args: ['qty'], resultName: 'rate' }]

beforeEach(() => {
  mockDocs = {
    'hosts/h1/workflows/quote': {
      name: 'Quote calculator',
      steps: STEPS,
      returnValue: 'rate',
      trigger: { event: 'formSubmission' },
    },
    'hosts/h1/workflows/bare': { name: 'Bare', steps: 'not a list' },
    'hosts/h1/workflows/gone': { name: 'Old', deletedAt: 5 },
    'hosts/h1/workflows/unnamed': { name: '  ', steps: [] },
    'hosts/h1/webhooks/zap': {
      name: 'Zapier',
      direction: 'outbound',
      url: 'https://hooks.example.com/abc',
      secret: 's3cret',
    },
    'hosts/h1/webhooks/off': { name: 'Stripe in', direction: 'inbound', enabled: false },
    'hosts/h1/webhooks/gone': { name: 'Old', direction: 'outbound', deletedAt: 1 },
    'hosts/h1/actions/welcome': { name: 'Welcome', trigger: { event: 'lead' }, steps: [{ type: 'sendEmail' }] },
    'hosts/h1/actions/nameless': { trigger: { event: 'elementClick' }, steps: [], enabled: false },
    'hosts/h1/actions/gone': { name: 'Deleted', deletedAt: 9 },
  }
})

describe('the workflow index', () => {
  it('reads one live workflow with the facts it documents', async () => {
    await expect(workflowRecordIndex.get({ hostId: 'h1', id: 'quote' })).resolves.toEqual({
      id: 'quote',
      name: 'Quote calculator',
      facts: { steps: STEPS, returnValue: 'rate', trigger: { event: 'formSubmission' } },
    })
    await expect(workflowRecordIndex.get({ hostId: 'h1', id: 'bare' })).resolves.toEqual({
      id: 'bare',
      name: 'Bare',
      facts: { steps: [], returnValue: null, trigger: null },
    })
  })

  it('answers nothing for a deleted, an unnamed or a missing workflow, or with no site', async () => {
    await expect(workflowRecordIndex.get({ hostId: 'h1', id: 'gone' })).resolves.toBeNull()
    await expect(workflowRecordIndex.get({ hostId: 'h1', id: 'unnamed' })).resolves.toBeNull()
    await expect(workflowRecordIndex.get({ hostId: 'h1', id: 'nope' })).resolves.toBeNull()
    await expect(workflowRecordIndex.get({ orgId: 'o1', id: 'quote' })).resolves.toBeNull()
  })

  it('lists live, named workflows only, and says when the site holds more', async () => {
    const all = await workflowRecordIndex.list({ hostId: 'h1', limit: 10 })
    expect(all.records.map((record) => record.id)).toEqual(['quote', 'bare'])
    expect(all.truncated).toBe(false)
    expect((await workflowRecordIndex.list({ hostId: 'h1', limit: 1 })).truncated).toBe(true)
    expect(await workflowRecordIndex.list({ orgId: 'o1', limit: 10 })).toEqual({ records: [], truncated: false })
  })
})

describe('the webhook index', () => {
  it('shares the direction and whether it is on, and never the URL or the secret', async () => {
    const { records } = await webhookRecordIndex.list({ hostId: 'h1', limit: 10 })
    expect(records).toEqual([
      { id: 'zap', name: 'Zapier', facts: { direction: 'outbound', enabled: true } },
      { id: 'off', name: 'Stripe in', facts: { direction: 'inbound', enabled: false } },
    ])
    expect(JSON.stringify(records)).not.toMatch(/hooks\.example|s3cret/)
    await expect(webhookRecordIndex.get({ hostId: 'h1', id: 'gone' })).resolves.toBeNull()
  })
})

describe('the action index', () => {
  it('reads an action with its trigger, steps and switch, naming an unnamed one by its id', async () => {
    await expect(actionRecordIndex.get({ hostId: 'h1', id: 'welcome' })).resolves.toEqual({
      id: 'welcome',
      name: 'Welcome',
      facts: { trigger: { event: 'lead' }, steps: [{ type: 'sendEmail' }], enabled: true },
    })
    await expect(actionRecordIndex.get({ hostId: 'h1', id: 'nameless' })).resolves.toEqual({
      id: 'nameless',
      name: 'nameless',
      facts: { trigger: { event: 'elementClick' }, steps: [], enabled: false },
    })
    await expect(actionRecordIndex.get({ hostId: 'h1', id: 'gone' })).resolves.toBeNull()
  })
})
