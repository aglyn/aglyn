/**
 * What a lead hands to the contact it became (AGL-3233): its activities
 * and tasks gain the contact and keep the lead, every plugin listener is
 * told, and a sweep that fails costs the others nothing.
 */

import {
  registerPluginLeadConversionListener,
  resetPluginLeadConversionListenersForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-lead-conversion'

const docs = new Map<string, Record<string, any>>()
const updates: Array<{ path: string; patch: Record<string, unknown> }> = []

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

const collectionRef = (path: string): any => ({
  where: (field: string, _op: string, value: unknown) => ({
    limit: () => ({
      get: async () => ({
        docs: childPaths(path)
          .filter((p) => docs.get(p)?.[field] === value)
          .map((p) => ({
            ref: { path: p },
            get: (key: string) => docs.get(p)?.[key],
          })),
      }),
    }),
  }),
})

let failBatch = false
const firestore: any = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      collection: (sub: string) => collectionRef(`${name}/${id}/${sub}`),
    }),
  }),
  batch: () => {
    const queued: Array<{ path: string; patch: Record<string, unknown> }> = []
    return {
      update: (ref: { path: string }, patch: Record<string, unknown>) => {
        queued.push({ path: ref.path, patch })
      },
      commit: async () => {
        if (failBatch) throw new Error('batch refused')
        for (const write of queued) {
          docs.set(write.path, { ...(docs.get(write.path) ?? {}), ...write.patch })
          updates.push(write)
        }
      },
    }
  },
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}))

import { handOffLeadRecords } from './hand-off-lead'

const ORG = 'org-1'
const input = {
  firestore,
  orgId: ORG,
  hostId: 'site-1',
  leadId: 'lead-key',
  contactId: 'c-1',
  email: ' Dana@Example.com ',
  by: 'member' as const,
}

beforeEach(() => {
  docs.clear()
  updates.length = 0
  failBatch = false
  resetPluginLeadConversionListenersForTests()
})

describe('handOffLeadRecords', () => {
  it('stamps the contact onto every activity and task filed on the lead, and keeps the lead', async () => {
    docs.set(`orgs/${ORG}/crmActivities/a-1`, { leadId: 'lead-key', kind: 'call' })
    docs.set(`orgs/${ORG}/crmActivities/a-2`, { leadId: 'lead-key', contactId: 'c-1' })
    docs.set(`orgs/${ORG}/crmActivities/a-3`, { leadId: 'other', kind: 'note' })
    docs.set(`orgs/${ORG}/crmTasks/t-1`, { leadId: 'lead-key', title: 'Call back' })
    const report = await handOffLeadRecords(input)
    expect(report).toEqual({ activities: 1, tasks: 1, plugins: {} })
    expect(docs.get(`orgs/${ORG}/crmActivities/a-1`)).toMatchObject({
      leadId: 'lead-key',
      contactId: 'c-1',
    })
    expect(docs.get(`orgs/${ORG}/crmActivities/a-3`)).not.toHaveProperty('contactId')
    expect(docs.get(`orgs/${ORG}/crmTasks/t-1`)).toMatchObject({ leadId: 'lead-key', contactId: 'c-1' })
    // A row already pointing at the contact is not rewritten.
    expect(updates.map((write) => write.path).sort()).toEqual([
      `orgs/${ORG}/crmActivities/a-1`,
      `orgs/${ORG}/crmTasks/t-1`,
    ])
  })

  it('tells every plugin listener, with the address normalized', async () => {
    const heard: Array<Record<string, unknown>> = []
    registerPluginLeadConversionListener(
      async (request) => {
        heard.push({ ...request })
        return { enrollments: 3 }
      },
      { pluginId: 'mail' },
    )
    const report = await handOffLeadRecords(input)
    expect(report.plugins).toEqual({ mail: { enrollments: 3 } })
    expect(heard).toEqual([
      {
        orgId: ORG,
        hostId: 'site-1',
        leadId: 'lead-key',
        contactId: 'c-1',
        email: 'dana@example.com',
        by: 'member',
      },
    ])
  })

  it('never throws: a sweep that fails is logged, and the listeners still run', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    docs.set(`orgs/${ORG}/crmActivities/a-1`, { leadId: 'lead-key' })
    failBatch = true
    registerPluginLeadConversionListener(async () => ({ ok: true }), { pluginId: 'mail' })
    const report = await handOffLeadRecords(input)
    expect(report).toEqual({ activities: 0, tasks: 0, plugins: { mail: { ok: true } } })
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
