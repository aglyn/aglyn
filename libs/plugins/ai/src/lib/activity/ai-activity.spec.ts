/**
 * @jest-environment node
 */
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
 * The AI activity writers (AGL-2929): every helper lands ONE row of the
 * shape the feed reads — `actorId`, `actorEmail`, `action` from the shared
 * catalog, a `{ type, id, name }` target and a server `createdAt` — in the
 * log it belongs to, and never invents an actor. Driven through the REAL
 * `logOrgActivity` / `logHostActivity` against an in-memory store, so the
 * shape asserted is the shape stored, not the arguments a stub was handed.
 */

import {
  AI_ACTIVITY_ACTIONS,
  AI_ACTIVITY_ACTION_LABELS,
} from './ai-activity-actions'

interface Doc {
  [key: string]: unknown
}

const store = new Map<string, Doc>()
let mockAutoId = 0

const mockMakeDoc = (path: string): any => ({
  path,
  id: path.split('/').pop(),
  collection: (name: string) => mockMakeCollection(`${path}/${name}`),
  get: async () => ({
    exists: store.has(path),
    data: () => store.get(path),
    get: (field: string) => store.get(path)?.[field],
  }),
})

const mockMakeCollection = (prefix: string): any => ({
  doc: (id: string) => mockMakeDoc(`${prefix}/${id}`),
  add: async (data: Doc) => {
    const path = `${prefix}/auto-${(mockAutoId += 1)}`
    store.set(path, data)
    return mockMakeDoc(path)
  },
})

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => mockMakeCollection(name),
      }),
    }),
  },
}))
jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => '__server_timestamp__',
    delete: () => '__delete__',
  },
}))
jest.mock('@aglyn/tenant-data-admin/server/host-memberships', () => ({
  __esModule: true,
  deleteMemberHostProjections: async () => undefined,
  syncHostProjectionForMembers: async () => undefined,
  syncMemberHostProjections: async () => undefined,
}))
jest.mock('@aglyn/tenant-data-admin/server/auth-pools', () => ({
  __esModule: true,
  findUserByUidAcrossPools: async () => null,
}))
jest.mock('@aglyn/tenant-data-admin/server/update-existing', () => ({
  __esModule: true,
  updateExisting: async () => undefined,
}))
jest.mock('@aglyn/tenant-data-admin/server/workspace-domains', () => ({
  __esModule: true,
  attachWorkspaceDomain: async () => undefined,
}))

const {
  logAiAddonChanged,
  logAiAssistSection,
  logAiEditApplied,
  logAiJobCanceled,
  logAiJobCreated,
  logAiJobNeedsInput,
  logAiJobOutput,
  logAiOverageControl,
  logAiPermissionChanged,
} = require('./ai-activity') as typeof import('./ai-activity')

const ORG = 'org-1'
const HOST = 'host-1'
const PERSON = { uid: 'uid-1', email: 'ada@example.test' }
const NOBODY = { uid: null, email: null }

/** Rows in one log, in write order. */
const rowsIn = (prefix: string) =>
  [...store.entries()]
    .filter(([path]) => path.startsWith(`${prefix}/`))
    .map(([, row]) => row)
const orgRows = () => rowsIn(`orgs/${ORG}/activity`)
const hostRows = () => rowsIn(`hosts/${HOST}/activity`)

/** The five fields every row carries, with the actor the case named. */
const shaped = (actor: { uid: string | null; email: string | null }) => ({
  actorId: actor.uid,
  actorEmail: actor.email,
  createdAt: '__server_timestamp__',
})

beforeEach(() => {
  store.clear()
  mockAutoId = 0
})

describe('every code a writer stores has a label the viewers can render', () => {
  it('the catalog and the label map name the same actions', () => {
    for (const action of Object.values(AI_ACTIVITY_ACTIONS)) {
      expect(AI_ACTIVITY_ACTION_LABELS[action]).toEqual(expect.any(String))
    }
  })
})

describe('generation jobs (for AGL-2904)', () => {
  it('ai.job.created names the job, its kind, the brief length and the site', async () => {
    await logAiJobCreated(ORG, PERSON, {
      jobId: 'job-1',
      kind: 'screen',
      briefLength: 240,
      hostId: HOST,
      hostName: 'Acme',
    })
    expect(orgRows()).toEqual([
      {
        ...shaped(PERSON),
        action: 'ai.job.created',
        target: { type: 'aiJob', id: 'job-1', name: 'screen · 240-character brief · Acme' },
      },
    ])
    expect(hostRows()).toEqual([])
  })

  it('ai.job.output writes the org row and, for a host-scoped output, the site copy', async () => {
    await logAiJobOutput(ORG, PERSON, {
      jobId: 'job-1',
      hostId: HOST,
      resource: { type: 'screen', id: 'screen-1', name: 'Home', versionId: 'v-1' },
    })
    const target = { type: 'screen', id: 'screen-1', name: 'Home', versionId: 'v-1' }
    expect(orgRows()).toEqual([{ ...shaped(PERSON), action: 'ai.job.output', target }])
    expect(hostRows()).toEqual([{ ...shaped(PERSON), action: 'ai.job.output', target }])
  })

  it('an output with no site lands in the org feed only', async () => {
    await logAiJobOutput(ORG, PERSON, {
      jobId: 'job-1',
      resource: { type: 'component', id: 'component-1' },
    })
    expect(orgRows()).toHaveLength(1)
    expect(orgRows()[0]).toMatchObject({
      action: 'ai.job.output',
      target: { type: 'component', id: 'component-1' },
    })
    expect(hostRows()).toEqual([])
  })

  it('an actorless output is written to the org feed without a host copy — the host log has no anonymous actor', async () => {
    await logAiJobOutput(ORG, NOBODY, {
      jobId: 'job-1',
      hostId: HOST,
      resource: { type: 'screen', id: 'screen-1' },
    })
    expect(orgRows()).toEqual([
      expect.objectContaining({ actorId: null, actorEmail: null, action: 'ai.job.output' }),
    ])
    expect(hostRows()).toEqual([])
  })

  it('ai.job.canceled and ai.job.needs_input name the job, and needs_input says why', async () => {
    await logAiJobCanceled(ORG, PERSON, { jobId: 'job-1', kind: 'site' })
    await logAiJobNeedsInput(ORG, NOBODY, { jobId: 'job-1', kind: 'site', reason: 'cap' })
    expect(orgRows()).toEqual([
      {
        ...shaped(PERSON),
        action: 'ai.job.canceled',
        target: { type: 'aiJob', id: 'job-1', name: 'site' },
      },
      {
        ...shaped(NOBODY),
        action: 'ai.job.needs_input',
        target: {
          type: 'aiJob',
          id: 'job-1',
          name: 'site · the overage ceiling was reached',
        },
      },
    ])
  })

  it('never invents an actor: a null uid is stored as null, not as the last person', async () => {
    await logAiJobCanceled(ORG, NOBODY, { jobId: 'job-1' })
    expect(orgRows()[0]).toMatchObject({ actorId: null, actorEmail: null })
    expect(orgRows()[0].target).toEqual({ type: 'aiJob', id: 'job-1' })
  })
})

describe('besigner edits applied from a proposal (for AGL-2906)', () => {
  it('ai.edit.applied is a host row on the screen version, with the op counts in the name', async () => {
    await logAiEditApplied(HOST, PERSON, {
      type: 'screen',
      id: 'screen-1',
      name: 'Home',
      versionId: 'v-2',
      opCounts: { set: 3, insert: 1, remove: 0 },
    })
    expect(hostRows()).toEqual([
      {
        ...shaped(PERSON),
        action: 'ai.edit.applied',
        target: { type: 'screen', id: 'screen-1', name: 'Home · 3 set, 1 insert', versionId: 'v-2' },
      },
    ])
    expect(orgRows()).toEqual([])
  })

  it('names the document kind the edits landed on, and carries the counts alone when no name is known', async () => {
    await logAiEditApplied(HOST, PERSON, {
      type: 'component',
      id: 'component-1',
      versionId: 'v-3',
      opCounts: { restyle: 2 },
    })
    expect(hostRows()).toEqual([
      {
        ...shaped(PERSON),
        action: 'ai.edit.applied',
        target: { type: 'component', id: 'component-1', name: '2 restyle', versionId: 'v-3' },
      },
    ])
  })
})

describe('the assist door (for AGL-2927 and the section mode)', () => {
  it('ai.assist.section lands in the site feed when a site was named', async () => {
    await logAiAssistSection(PERSON, { orgId: ORG, hostId: HOST, nodeCount: 7 })
    expect(hostRows()).toEqual([
      {
        ...shaped(PERSON),
        action: 'ai.assist.section',
        target: { type: 'host', id: HOST, name: '7 elements' },
      },
    ])
    expect(orgRows()).toEqual([])
  })

  it('and in the org feed when none was', async () => {
    await logAiAssistSection(PERSON, { orgId: ORG, nodeCount: 1 })
    expect(orgRows()).toEqual([
      {
        ...shaped(PERSON),
        action: 'ai.assist.section',
        target: { type: 'org', name: '1 element' },
      },
    ])
  })
})

describe('the overage controls', () => {
  it('ai.overage.hardCap records the new state, and nothing when it did not move', async () => {
    await expect(
      logAiOverageControl(ORG, PERSON, { control: 'hardCap', before: false, after: true }),
    ).resolves.toBe(true)
    await expect(
      logAiOverageControl(ORG, PERSON, { control: 'hardCap', before: true, after: true }),
    ).resolves.toBe(false)
    expect(orgRows()).toEqual([
      {
        ...shaped(PERSON),
        action: 'ai.overage.hardCap',
        target: { type: 'org', name: 'On' },
      },
    ])
  })

  it('ai.overage.cap records the ceiling as money, and a clearing as Cleared', async () => {
    await logAiOverageControl(ORG, PERSON, { control: 'cap', before: null, after: 1250 })
    await logAiOverageControl(ORG, PERSON, { control: 'cap', before: 1250, after: null })
    await expect(
      logAiOverageControl(ORG, PERSON, { control: 'cap', before: null, after: null }),
    ).resolves.toBe(false)
    expect(orgRows().map((row) => row.target)).toEqual([
      { type: 'org', name: '$1,250' },
      { type: 'org', name: 'Cleared' },
    ])
    expect(orgRows().map((row) => row.action)).toEqual(['ai.overage.cap', 'ai.overage.cap'])
  })
})

describe('permissions (for the roles and members routes)', () => {
  it('ai.permission.changed targets the subject and names the permission and its direction', async () => {
    await logAiPermissionChanged(ORG, PERSON, {
      subject: { type: 'role', id: 'role-1', name: 'Marketing' },
      permission: 'ai.generate',
      granted: false,
    })
    expect(orgRows()).toEqual([
      {
        ...shaped(PERSON),
        action: 'ai.permission.changed',
        target: { type: 'role', id: 'role-1', name: 'Marketing · ai.generate revoked' },
      },
    ])
  })
})

describe('the add-on', () => {
  it('ai.addon.purchased when the mirror goes 0 → 1, removed when 1 → 0, nothing otherwise', async () => {
    await expect(
      logAiAddonChanged(ORG, PERSON, { before: undefined, after: { aiAddon: 1 } as never }),
    ).resolves.toBe(true)
    await expect(
      logAiAddonChanged(ORG, PERSON, { before: { aiAddon: 1 } as never, after: { aiAddon: 1 } as never }),
    ).resolves.toBe(false)
    await expect(
      logAiAddonChanged(ORG, NOBODY, { before: { aiAddon: 1 } as never, after: { aiAddon: 0 } as never }),
    ).resolves.toBe(true)
    expect(orgRows()).toEqual([
      {
        ...shaped(PERSON),
        action: 'ai.addon.purchased',
        target: { type: 'subscription', name: expect.stringMatching(/ AI$/) },
      },
      {
        ...shaped(NOBODY),
        action: 'ai.addon.removed',
        target: { type: 'subscription', name: expect.stringMatching(/ AI$/) },
      },
    ])
  })
})
