/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom.
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
 * AN AUTOMATION'S DATASET STEP, RUN BY THE ENGINE THROUGH THE DATA PLUGIN
 * (AGL-3080).
 *
 * The workflows engine runs an automation and the data plugin runs its dataset
 * steps; they meet at the platform's server-step seam and import nothing of
 * each other. Each plugin's spec holds its own half, against a stand-in for
 * the other. This one runs both REAL halves, the way the console boots them —
 * its own server-declarations manifest, then a page's dispatch through the
 * host-event listeners — over one Firestore double:
 *
 *  1. every step a plugin declares under `serverSteps` has that plugin's
 *     executor once the boot has run, and none before it;
 *  2. an append writes the record and the run history says `saved to Leads`;
 *  3. a refusal is the run's error, in the data plugin's words, and nothing is
 *     written.
 *
 * ⚑ It imports no plugin: an app may not depend on one.
 */

const HOST_ID = 'site-1'
const MOCK_ORG_ID = 'org-1'

/** Every document, by full path. */
let store: Record<string, Record<string, any>> = {}
/** The owning org's billing doc — the plan both halves read. */
let mockOrg: Record<string, any> = { plan: 'business' }

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
    delete: () => ({ __delete: true }),
  },
}))

const readField = (data: Record<string, any> | undefined, field: string) =>
  field.split('.').reduce<any>((value, key) => value?.[key], data)

const lastSegment = (path: string) => path.slice(path.lastIndexOf('/') + 1)

const snapshotOf = (path: string): any => ({
  id: lastSegment(path),
  exists: store[path] !== undefined,
  data: () => store[path],
  get: (field: string) => readField(store[path], field),
  ref: docRef(path),
})

function docRef(path: string): any {
  return {
    id: lastSegment(path),
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
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
    get parent() {
      return mockCollectionRef(path.slice(0, path.lastIndexOf('/')))
    },
  }
}

/** The documents directly under a collection path. */
const childrenOf = (path: string) =>
  Object.keys(store).filter(
    (key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
  )

function mockCollectionRef(path: string): any {
  const query = (matchers: ((data: Record<string, any>) => boolean)[]): any => ({
    where: (field: string, op: string, value: any) =>
      query([
        ...matchers,
        op === 'array-contains-any'
          ? (data) => {
              const held = readField(data, field)
              return Array.isArray(held) && value.some((token: unknown) => held.includes(token))
            }
          : (data) => readField(data, field) === value,
      ]),
    limit: () => query(matchers),
    select: () => query(matchers),
    get: async () => {
      const docs = childrenOf(path)
        .filter((key) => matchers.every((matcher) => matcher(store[key])))
        .map(snapshotOf)
      return { docs, empty: docs.length === 0, size: docs.length }
    },
    count: () => ({
      get: async () => ({ data: () => ({ count: childrenOf(path).length }) }),
    }),
  })
  return {
    ...query([]),
    id: lastSegment(path),
    path,
    doc: (id: string) => docRef(`${path}/${id}`),
    add: async (data: Record<string, any>) => {
      const id = `auto-${Object.keys(store).length + 1}`
      store[`${path}/${id}`] = { ...data }
      return docRef(`${path}/${id}`)
    },
    get parent() {
      const parentPath = path.slice(0, path.lastIndexOf('/'))
      return parentPath ? docRef(parentPath) : null
    },
  }
}

const mockFirestore: any = {
  collection: (name: string) => mockCollectionRef(name),
  /*
   * The run meter (AGL-3472) seeds the workspace's run counter in a
   * transaction and counts each run on the site's and the workspace's
   * counters in one batch — both over this same store, with their writes
   * applied at commit, as Firestore applies them.
   */
  runTransaction: async (body: (transaction: any) => Promise<unknown>) => {
    const writes: Array<() => Promise<void>> = []
    const result = await body({
      get: (ref: any) => ref.get(),
      getAll: (...refs: any[]) => Promise.all(refs.map((ref) => ref.get())),
      set: (ref: any, data: Record<string, any>, options?: { merge?: boolean }) => {
        writes.push(() => ref.set(data, options))
      },
      update: (ref: any, data: Record<string, any>) => {
        writes.push(() => ref.update(data))
      },
    })
    for (const write of writes) await write()
    return result
  },
  batch: () => {
    const writes: Array<() => Promise<void>> = []
    return {
      set: (ref: any, data: Record<string, any>, options?: { merge?: boolean }) => {
        writes.push(() => ref.set(data, options))
      },
      commit: async () => {
        for (const write of writes) await write()
      },
    }
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => mockFirestore }) },
  getOrgForHost: async () => ({ orgId: MOCK_ORG_ID, org: mockOrg }),
  resolveOrgIdForHost: async () => MOCK_ORG_ID,
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    mockCollectionRef(`orgs/${MOCK_ORG_ID}/${name}`),
  dataStorageRefusal: async () => null,
}))

import {
  declaredServerSteps,
  registeredServerStepExecutor,
} from '@aglyn/aglyn/plugin-manager/plugin-server-steps'
import { registerLivePageDropper } from '@aglyn/tenant-data-admin/server/live-page-drops'
import { dispatchHostAutomation } from '@aglyn/tenant-runtime/host-event-listeners'
import { registerPluginServerDeclarations } from '../constants/plugins.declarations.server.generated'

/** Each declared step's executor owner, read before the boot runs. */
let ownersBeforeBoot: Array<string | null>

beforeAll(async () => {
  ownersBeforeBoot = declaredServerSteps().map(
    (row) => registeredServerStepExecutor(row.type)?.pluginId ?? null,
  )
  await registerPluginServerDeclarations()
  // The tenant's in-process drop, stood in: nothing here renders a page.
  registerLivePageDropper(async () => true)
})

beforeEach(() => {
  store = {}
  mockOrg = { plan: 'business' }
  store[`hosts/${HOST_ID}`] = { orgId: MOCK_ORG_ID }
  store[`orgs/${MOCK_ORG_ID}/datasets/leads`] = {
    displayName: 'Leads',
    visibleTo: ['org'],
    fields: ['email', 'name'],
  }
  store[`hosts/${HOST_ID}/actions/capture`] = {
    name: 'Capture the lead',
    enabled: true,
    trigger: { event: 'elementClick', selector: '#join' },
    steps: [{ type: 'datasetAppend', datasetId: 'leads', datasetName: 'Leads' }],
  }
})

/** The rows the run history holds. */
const history = () => childrenOf(`hosts/${HOST_ID}/activity`).map((key) => store[key])

/** The records the Leads dataset holds. */
const leads = () =>
  childrenOf(`orgs/${MOCK_ORG_ID}/datasets/leads/records`).map((key) => store[key])

describe('the server steps, in this console', () => {
  it('THE CONTROL: before the boot runs, no declared step has an executor', () => {
    expect(declaredServerSteps().length).toBeGreaterThan(0)
    expect(ownersBeforeBoot).toEqual(declaredServerSteps().map(() => null))
  })

  it('runs every declared step through the plugin that declares it', () => {
    for (const row of declaredServerSteps()) {
      expect(registeredServerStepExecutor(row.type)?.pluginId).toBe(row.pluginId)
    }
  })
})

describe('a dataset step dispatched from a page', () => {
  it('writes the record through the data plugin, and the run says where', async () => {
    await dispatchHostAutomation(HOST_ID, 'capture', 'elementClick', {
      email: 'ada@example.com',
      name: 'Ada',
      phone: '555-0100',
    })
    expect(leads()).toEqual([
      expect.objectContaining({ values: { email: 'ada@example.com', name: 'Ada' } }),
    ])
    expect(history()).toEqual([
      expect.objectContaining({ result: 'succeeded', summary: 'saved to Leads' }),
    ])
  })

  it('records the data plugin’s refusal as the run’s error, and writes nothing', async () => {
    mockOrg = { plan: 'business', entitlements: { recordsPerDataset: 0 } }
    await dispatchHostAutomation(HOST_ID, 'capture', 'elementClick', {
      email: 'ada@example.com',
    })
    expect(leads()).toEqual([])
    expect(history()).toEqual([
      expect.objectContaining({
        result: 'failed',
        action: 'Action ran on elementClick with errors: dataset is full (0 records on this plan)',
      }),
    ])
  })
})
