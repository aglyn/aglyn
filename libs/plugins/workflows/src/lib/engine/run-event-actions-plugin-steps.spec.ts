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
 * A STEP ANOTHER PLUGIN RUNS, run by the engine (AGL-3080).
 *
 * A step that writes another plugin's records is handed to the executor that
 * plugin registered (`plugin-server-steps`); the engine keeps the guard, the
 * order, the history and the nesting cap. Pinned here against the real engine
 * and a Firestore double, with a stand-in plugin's executor:
 *
 *  1. the executor gets the site, the plan document, the automation, the
 *     event, the payload and the step exactly as stored;
 *  2. its detail is the step's line in the run history, and its refusal — or
 *     its throw — is the step's failure, after which the run goes on;
 *  3. a step whose guard is unmet never reaches it;
 *  4. an event it earns is raised one level deeper, so the actions listening
 *     for it run — and a chain that keeps earning stops at the nesting cap;
 *  5. a step a plugin DECLARED, whose executor never registered, fails with
 *     the reason rather than reading as done.
 */

const HOST_ID = 'site-1'
const ORG_ID = 'org-1'

/** Every document, by full path. */
let store: Record<string, Record<string, any>> = {}
let mockDeclared: unknown = []

jest.mock('@aglyn/aglyn/plugin-manager/first-party-plugins.generated', () => {
  const actual = jest.requireActual('@aglyn/aglyn/plugin-manager/first-party-plugins.generated')
  return {
    __esModule: true,
    ...actual,
    get PLUGIN_SERVER_STEPS_DECLARED() {
      return mockDeclared
    },
  }
})

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

const readField = (data: Record<string, any>, field: string) =>
  field.split('.').reduce<any>((value, key) => value?.[key], data)

const snapshotOf = (path: string) => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  exists: store[path] !== undefined,
  data: () => store[path],
  get: (field: string) => (store[path] ? readField(store[path], field) : undefined),
  ref: docRef(path),
})

function docRef(path: string): any {
  return {
    id: path.slice(path.lastIndexOf('/') + 1),
    path,
    get: async () => snapshotOf(path),
    set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
      const next = { ...(options?.merge ? (store[path] ?? {}) : {}) }
      for (const [key, value] of Object.entries(data)) {
        next[key] =
          value && typeof value === 'object' && '__increment' in value
            ? Number(next[key] ?? 0) + value.__increment
            : value
      }
      store[path] = next
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

/** The documents directly under a collection path. */
const childrenOf = (path: string) =>
  Object.keys(store).filter(
    (key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
  )

function collectionRef(path: string): any {
  const query = (matchers: ((data: Record<string, any>) => boolean)[]): any => ({
    where: (field: string, _op: string, value: unknown) =>
      query([...matchers, (data) => readField(data, field) === value]),
    orderBy: () => query(matchers),
    limit: () => query(matchers),
    get: async () => {
      const docs = childrenOf(path)
        .filter((key) => matchers.every((matcher) => matcher(store[key])))
        .map((key) => snapshotOf(key))
      return { docs, empty: docs.length === 0 }
    },
  })
  return {
    ...query([]),
    doc: (id: string) => docRef(`${path}/${id}`),
    add: async (data: Record<string, any>) => {
      const id = `auto-${Object.keys(store).length + 1}`
      store[`${path}/${id}`] = { ...data }
      return docRef(`${path}/${id}`)
    },
  }
}

const firestoreHandle: any = {
  collection: (name: string) => collectionRef(name),
  // The run meter's one write and its seed (AGL-3472).
  batch: () => {
    const writes: Array<() => Promise<void>> = []
    return {
      set: (ref: any, data: any, options?: { merge?: boolean }) => {
        writes.push(() => ref.set(data, options))
      },
      commit: async () => {
        for (const write of writes) await write()
      },
    }
  },
  runTransaction: async (body: (transaction: any) => Promise<any>) =>
    await body({
      get: async (ref: any) => await ref.get(),
      getAll: async (...refs: any[]) =>
        await Promise.all(refs.map((ref) => ref.get())),
      set: (ref: any, data: any, options?: { merge?: boolean }) => {
        void ref.set(data, options)
      },
    }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestoreHandle }) },
  getOrgForHost: async () => ({ orgId: ORG_ID, org: { plan: 'business' } }),
}))

import {
  registerServerStepExecutor,
  resetServerStepExecutorsForTests,
  type ServerStepRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-server-steps'
import { resetPluginDeclarationsRepairForTests } from '@aglyn/aglyn/plugin-manager/plugin-declarations-repair'
import { ACTION_MAX_EVENT_DEPTH } from '../model/workflows'
import { runEventActions } from './run-event-actions'

/** What each run wrote to the site's history, oldest first. */
const history = () =>
  childrenOf(`hosts/${HOST_ID}/activity`).map((key) => store[key])

const seedAction = (id: string, event: string, steps: Record<string, unknown>[]) => {
  store[`hosts/${HOST_ID}/actions/${id}`] = {
    name: `Action ${id}`,
    enabled: true,
    trigger: { event },
    steps,
  }
}

let requests: ServerStepRequest[] = []

beforeEach(() => {
  store = {}
  mockDeclared = []
  requests = []
  resetServerStepExecutorsForTests()
  resetPluginDeclarationsRepairForTests()
})

afterAll(() => {
  resetServerStepExecutorsForTests()
})

describe('a step another plugin runs', () => {
  it('hands the executor the site, the plan, the automation, the event, the payload and the step', async () => {
    registerServerStepExecutor(
      ['stampVisitor'],
      async (request) => {
        requests.push(request)
        return { detail: 'gold' }
      },
      { pluginId: 'stamps' },
    )
    seedAction('act-1', 'quoteRequested', [{ type: 'stampVisitor', stamp: 'gold' }])
    await runEventActions(HOST_ID, 'quoteRequested', { plan: 'pro' })
    expect(requests).toEqual([
      {
        hostId: HOST_ID,
        org: { plan: 'business' },
        orgId: ORG_ID,
        run: { kind: 'action', id: 'act-1', name: 'Action act-1' },
        event: 'quoteRequested',
        payload: { plan: 'pro' },
        step: { type: 'stampVisitor', stamp: 'gold' },
      },
    ])
    expect(history()).toEqual([
      expect.objectContaining({ result: 'succeeded', summary: 'stampVisitor gold' }),
    ])
  })

  it('records a refusal as the step failing, and runs the next step', async () => {
    registerServerStepExecutor(['stampVisitor'], async () => ({ error: 'no stamp left' }), {
      pluginId: 'stamps',
    })
    seedAction('act-1', 'quoteRequested', [
      { type: 'stampVisitor' },
      { type: 'siteAlert', message: 'Thanks' },
    ])
    const alerts = await runEventActions(HOST_ID, 'quoteRequested', {})
    expect(alerts).toEqual([{ message: 'Thanks', severity: 'info' }])
    expect(history()).toEqual([
      expect.objectContaining({
        result: 'failed',
        action: 'Action ran on quoteRequested with errors: no stamp left',
        summary: 'showed an alert',
      }),
    ])
  })

  it('records a throw the same way', async () => {
    registerServerStepExecutor(
      ['stampVisitor'],
      async () => {
        throw new Error('stamp store unreachable')
      },
      { pluginId: 'stamps' },
    )
    seedAction('act-1', 'quoteRequested', [{ type: 'stampVisitor' }])
    await runEventActions(HOST_ID, 'quoteRequested', {})
    expect(history()).toEqual([
      expect.objectContaining({
        result: 'failed',
        action: 'Action ran on quoteRequested with errors: stamp store unreachable',
      }),
    ])
  })

  it('never reaches the executor when the step’s guard is unmet', async () => {
    const run = jest.fn(async () => ({}))
    registerServerStepExecutor(['stampVisitor'], run, { pluginId: 'stamps' })
    seedAction('act-1', 'quoteRequested', [
      {
        type: 'stampVisitor',
        when: { conditions: [{ field: 'plan', op: 'equals', value: 'enterprise' }] },
      },
    ])
    await runEventActions(HOST_ID, 'quoteRequested', { plan: 'pro' })
    expect(run).not.toHaveBeenCalled()
    expect(history()).toEqual([expect.objectContaining({ result: 'succeeded', summary: 'Ran' })])
  })

  it('raises the event a step earned one level deeper, so its listeners run', async () => {
    registerServerStepExecutor(
      ['stampVisitor'],
      async (request) => {
        requests.push(request)
        return { emit: { event: 'visitorStamped', payload: { stamp: 'gold' } } }
      },
      { pluginId: 'stamps' },
    )
    seedAction('act-1', 'quoteRequested', [{ type: 'stampVisitor' }])
    seedAction('act-2', 'visitorStamped', [{ type: 'siteAlert', message: 'Stamped' }])
    const alerts = await runEventActions(HOST_ID, 'quoteRequested', {})
    expect(alerts).toEqual([{ message: 'Stamped', severity: 'info' }])
    expect(history().map((row) => row.trigger).sort()).toEqual(['quoteRequested', 'visitorStamped'])
  })

  it('stops a chain of earned events at the nesting cap', async () => {
    registerServerStepExecutor(
      ['stampVisitor'],
      async (request) => {
        requests.push(request)
        return { emit: { event: 'quoteRequested', payload: {} } }
      },
      { pluginId: 'stamps' },
    )
    seedAction('act-1', 'quoteRequested', [{ type: 'stampVisitor' }])
    await runEventActions(HOST_ID, 'quoteRequested', {})
    expect(requests).toHaveLength(ACTION_MAX_EVENT_DEPTH + 1)
  })

  it('fails a declared step whose plugin never registered its executor, with the reason', async () => {
    mockDeclared = [{ pluginId: 'stamps', type: 'stampVisitor' }]
    seedAction('act-1', 'quoteRequested', [{ type: 'stampVisitor' }])
    await runEventActions(HOST_ID, 'quoteRequested', {})
    expect(history()).toEqual([
      expect.objectContaining({
        result: 'failed',
        action:
          'Action ran on quoteRequested with errors: the "stampVisitor" step did not run: ' +
          'the plugin that runs it ("stamps") is not loaded on this server',
      }),
    ])
  })

  it('reads a step nobody declares or runs as done, as an unknown step always has', async () => {
    seedAction('act-1', 'quoteRequested', [{ type: 'stampVisitor' }])
    await runEventActions(HOST_ID, 'quoteRequested', {})
    expect(history()).toEqual([
      expect.objectContaining({ result: 'succeeded', summary: 'stampVisitor' }),
    ])
  })
})
