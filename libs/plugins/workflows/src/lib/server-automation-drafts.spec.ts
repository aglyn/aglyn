/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from there, and behind the license header the suite would run on jsdom.
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

/**
 * The automation draft writer (AGL-2919), against the real validator, the real
 * stored shape and the real entitlement table: only the Admin SDK is a double,
 * one that honors transactions, and the per-site cap is lowered so a site can
 * reach it in two documents.
 *
 *  - THE DOCUMENT is the one the Actions editor saves, OFF whatever the caller
 *    sent, holding each step's own fields and nothing else.
 *  - THE SCHEMA is the editor's validator; a placeholder passes it.
 *  - THE ROOM, THE ROLE AND THE PLAN are refused in the words a person reads
 *    elsewhere, before anything is written.
 *  - A WRITE ASKED AGAIN finds its draft rather than making a second.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({ __esModule: true, firebaseAdmin: {} }))

jest.mock('@aglyn/aglyn/app-utils/actions', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn/app-utils/actions'),
  ACTIONS_MAX_PER_HOST: 2,
}))

import { hostActionDocument } from '@aglyn/aglyn/app-utils/actions'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerWorkflowsConsoleApi } from './server-console'
import {
  AUTOMATION_DRAFT_LIMIT_REFUSAL,
  AUTOMATION_DRAFT_PLAN_REFUSAL,
  AUTOMATION_DRAFT_RESOURCE,
  AUTOMATION_DRAFT_ROLE_REFUSAL,
  automationDraftWriter,
  checkAutomationDraftContent,
  createAutomationDraftWriter,
  readAutomationDraftContent,
} from './server-automation-drafts'

const NOW = new Date('2026-09-16T20:00:00.000Z')

// ── Firestore double ─────────────────────────────────────────────────────

const store = new Map<string, Record<string, unknown>>()
let commits: string[] = []

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? data[field] : undefined),
  }
}

function collectionRef(path: string): Record<string, unknown> {
  const query = {
    kind: 'query',
    get: async () => ({
      docs: [...store.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .sort()
        .map(snapshotOf),
    }),
  }
  return { path, doc: (id: string) => docRef(`${path}/${id}`), select: () => query, get: query.get }
}

function docRef(path: string): Record<string, unknown> {
  return {
    kind: 'doc',
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
  }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (tx: unknown) => Promise<unknown>) => {
    const creates: Array<[string, Record<string, unknown>]> = []
    const result = await body({
      get: async (target: { kind: string; path: string; get: () => Promise<unknown> }) =>
        target.kind === 'query' ? target.get() : snapshotOf(target.path),
      create: (ref: { path: string }, data: Record<string, unknown>) => {
        creates.push([ref.path, data])
      },
    })
    for (const [path, data] of creates) {
      if (store.has(path)) throw new Error(`6 ALREADY_EXISTS: ${path}`)
      store.set(path, data)
      commits.push(path)
    }
    return result
  },
} as unknown as FirebaseFirestore.Firestore

const writer = createAutomationDraftWriter({ firestore: () => firestore })

// ── Fixtures ─────────────────────────────────────────────────────────────

const PAID = { plan: 'business' }
const FREE = { plan: 'free' }

/** An automation as a generator hands it over: placeholders, a stray key, and `enabled` asked for. */
const drafted = {
  name: '  Welcome   newsletter sign-ups ',
  enabled: true,
  trigger: {
    event: 'formSubmission',
    conditions: [{ field: 'formName', op: 'equals', value: 'Newsletter', note: 'not a field' }],
    combinator: 'and',
    publish: true,
  },
  steps: [
    { type: 'enrollList', listName: '[newsletter]', listId: null, color: 'red' },
    { type: 'setContactStage', lifecycleStage: 'lead' },
    {
      type: 'sendEmail',
      subject: 'Welcome aboard',
      body: 'Call us on [your phone number].',
      when: { conditions: [{ field: 'email', op: 'notEmpty' }] },
    },
  ],
}

function seedSite(roles: Record<string, string> = { 'uid-editor': 'editor', 'uid-author': 'author' }) {
  store.set('hosts/host-1', { orgId: 'org-1', memberRoles: roles })
}

const request = (patch: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  hostId: 'host-1',
  uid: 'uid-editor',
  org: PAID,
  now: NOW,
  id: 'job-1',
  name: 'Welcome newsletter sign-ups',
  content: { action: drafted },
  ...patch,
})

beforeEach(() => {
  store.clear()
  commits = []
  seedSite()
})

describe('what the writer stores', () => {
  it('reads each step’s own fields and nothing else, and names the automation', () => {
    const read = readAutomationDraftContent({ action: drafted })
    expect(read).toEqual({
      ok: true,
      action: {
        name: 'Welcome newsletter sign-ups',
        enabled: false,
        trigger: {
          event: 'formSubmission',
          conditions: [{ field: 'formName', op: 'equals', value: 'Newsletter' }],
          combinator: 'and',
        },
        steps: [
          { type: 'enrollList', listName: '[newsletter]' },
          { type: 'setContactStage', lifecycleStage: 'lead' },
          {
            type: 'sendEmail',
            subject: 'Welcome aboard',
            body: 'Call us on [your phone number].',
            when: { conditions: [{ field: 'email', op: 'notEmpty' }] },
          },
        ],
      },
    })
  })

  it('checks content with the editor’s validator, and reports what it holds', () => {
    expect(checkAutomationDraftContent({ action: drafted })).toEqual({
      ok: true,
      facts: { event: 'formSubmission', steps: 3, enabled: false, placeholders: 2 },
    })
    expect(
      checkAutomationDraftContent({ action: { ...drafted, steps: [{ type: 'sendEmail', subject: '', body: 'Hi' }] } }),
    ).toEqual({ ok: false, problems: ['Step 1: enter the subject'] })
    expect(checkAutomationDraftContent({ action: { ...drafted, steps: [{ type: 'teleport' }] } })).toEqual({
      ok: false,
      problems: ['Step 1: not a step the Actions editor offers', 'Add at least one step'],
    })
    expect(checkAutomationDraftContent({})).toEqual({ ok: false, problems: ['The draft holds no automation'] })
  })

  it('refuses an interaction on one element, which belongs to the page that holds it', () => {
    const interaction = {
      name: 'Menu',
      trigger: { event: 'elementClick', selector: '[data-aglyn="leaf:menu"]' },
      steps: [{ type: 'toggleMenu' }],
    }
    expect(checkAutomationDraftContent({ action: interaction })).toEqual({
      ok: false,
      problems: ['An interaction on one element is set up on that element, not as an automation'],
    })
  })

  it('writes the document the Actions editor saves, OFF, stamped with who and when', async () => {
    const write = await writer.write(request())
    expect(write).toEqual({
      ok: true,
      replayed: false,
      id: 'job-1',
      name: 'Welcome newsletter sign-ups',
      versionId: null,
      facts: { event: 'formSubmission', steps: 3, enabled: false, placeholders: 2 },
    })
    const read = readAutomationDraftContent({ action: drafted })
    if (read.ok === false) throw new Error('fixture does not read')
    expect(store.get('hosts/host-1/actions/job-1')).toEqual({
      ...hostActionDocument({ ...read.action, enabled: false, recipe: null }),
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'uid-editor',
    })
    expect(store.get('hosts/host-1/actions/job-1')?.['enabled']).toBe(false)
    expect(commits).toEqual(['hosts/host-1/actions/job-1'])
  })

  it('finds its draft when the same write is asked again, and writes nothing', async () => {
    await writer.write(request())
    commits = []
    const again = await writer.write(request({ name: 'Another name' }))
    expect(again).toEqual(
      expect.objectContaining({ ok: true, replayed: true, id: 'job-1', name: 'Welcome newsletter sign-ups' }),
    )
    expect(commits).toEqual([])
    expect(await writer.read({ hostId: 'host-1', id: 'job-1' })).toEqual({
      id: 'job-1',
      name: 'Welcome newsletter sign-ups',
      versionId: null,
      facts: { event: 'formSubmission', steps: 3, enabled: false, placeholders: 2 },
    })
    expect(await writer.read({ hostId: 'host-1', id: 'job-2' })).toBeNull()
  })
})

describe('who may, and where there is room', () => {
  it('refuses an unknown site, a member who may not write it, and a plan without automations', async () => {
    expect(await writer.write(request({ hostId: 'host-9' }))).toEqual({
      ok: false,
      status: 404,
      error: 'Unknown site',
    })
    expect(await writer.write(request({ uid: 'uid-stranger' }))).toEqual({
      ok: false,
      status: 403,
      error: AUTOMATION_DRAFT_ROLE_REFUSAL,
    })
    expect(await writer.write(request({ org: FREE }))).toEqual({
      ok: false,
      status: 403,
      error: AUTOMATION_DRAFT_PLAN_REFUSAL,
    })
    expect(commits).toEqual([])
    // The same answers before anything is spent.
    expect(await writer.refusal(request({ uid: 'uid-stranger' }))).toEqual({
      status: 403,
      error: AUTOMATION_DRAFT_ROLE_REFUSAL,
    })
    expect(await writer.refusal(request({ org: FREE }))).toEqual({
      status: 403,
      error: AUTOMATION_DRAFT_PLAN_REFUSAL,
    })
    expect(await writer.refusal(request())).toBeNull()
  })

  it('counts live actions against the cap, and a deleted one frees its slot', async () => {
    store.set('hosts/host-1/actions/a-1', { name: 'One', deletedAt: null })
    store.set('hosts/host-1/actions/a-2', { name: 'Two', deletedAt: NOW })
    expect(await writer.refusal(request())).toBeNull()
    store.set('hosts/host-1/actions/a-3', { name: 'Three' })
    expect(await writer.refusal(request())).toEqual({ status: 403, error: AUTOMATION_DRAFT_LIMIT_REFUSAL })
    expect(await writer.write(request())).toEqual({
      ok: false,
      status: 403,
      error: AUTOMATION_DRAFT_LIMIT_REFUSAL,
    })
    expect(store.has('hosts/host-1/actions/job-1')).toBe(false)
  })

  it('refuses content the validator refuses, before the transaction', async () => {
    const write = await writer.write(
      request({ content: { action: { ...drafted, trigger: { event: '' } } } }),
    )
    expect(write).toEqual({ ok: false, status: 400, error: 'Pick a trigger event' })
    expect(commits).toEqual([])
  })
})

describe('the console surface', () => {
  afterEach(() => resetPluginServicesForTests())

  it('registers the writer under the automation resource, owned by the workflows plugin', () => {
    registerWorkflowsConsoleApi()
    expect(pluginResourceDraftWriter(AUTOMATION_DRAFT_RESOURCE)).toEqual({
      pluginId: 'workflows',
      writer: automationDraftWriter,
    })
  })
})
