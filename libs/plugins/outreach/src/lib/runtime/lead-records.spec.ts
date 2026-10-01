/**
 * What a sequence does when a lead converts (AGL-3234): every enrollment
 * made on the lead is re-pointed at the contact it became. What a sent step
 * or a reply does to the lead's own stage is the record system's — the
 * CRM's `lead-nurturing.spec.ts` holds it.
 */

const docs = new Map<string, Record<string, any>>()
const updates: Array<{ path: string; patch: Record<string, unknown> }> = []

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

const docRef = (path: string): any => ({
  path,
  get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
  set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
    docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value)
  },
})
const collectionRef = (path: string): any => ({
  doc: (id: string) => docRef(`${path}/${id}`),
  where: (field: string, _op: string, value: unknown) => ({
    get: async () => ({
      docs: childPaths(path)
        .filter((p) => docs.get(p)?.[field] === value)
        .map((p) => ({ ref: { path: p }, get: (key: string) => docs.get(p)?.[key] })),
    }),
  }),
})
const firestore: any = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      ...docRef(`${name}/${id}`),
      collection: (sub: string) => collectionRef(`${name}/${id}/${sub}`),
    }),
  }),
  batch: () => {
    const queued: Array<{ path: string; patch: Record<string, unknown> }> = []
    return {
      update: (ref: { path: string }, patch: Record<string, unknown>) => void queued.push({ path: ref.path, patch }),
      commit: async () => {
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

import { followOutreachLeadToContact } from './lead-records'

const ORG = 'org-1'
const LEAD = 'lead-key'
const enrollment = (id: string, fields: Record<string, unknown>) =>
  docs.set(`orgs/${ORG}/outreachEnrollments/${id}`, fields)

beforeEach(() => {
  docs.clear()
  updates.length = 0
})

describe('followOutreachLeadToContact', () => {
  it('re-points every enrollment made on the lead at the contact, keeping the lead and the id', async () => {
    enrollment('seq-1_lead-key', { sequenceId: 'seq-1', target: 'lead', leadId: LEAD, contactId: '', stepIndex: 2 })
    enrollment('seq-2_lead-key', { sequenceId: 'seq-2', target: 'lead', leadId: LEAD, contactId: '' })
    enrollment('seq-1_c-9', { sequenceId: 'seq-1', target: 'contact', leadId: null, contactId: 'c-9' })
    await expect(
      followOutreachLeadToContact(firestore, { orgId: ORG, leadId: LEAD, contactId: 'c-1' }),
    ).resolves.toEqual({ enrollments: 2 })
    expect(docs.get(`orgs/${ORG}/outreachEnrollments/seq-1_lead-key`)).toMatchObject({
      target: 'contact',
      contactId: 'c-1',
      leadId: LEAD,
      stepIndex: 2,
    })
    expect(docs.get(`orgs/${ORG}/outreachEnrollments/seq-1_c-9`)).toMatchObject({ contactId: 'c-9' })
    expect(updates).toHaveLength(2)
  })

  it('writes nothing for an enrollment that already names the contact', async () => {
    enrollment('seq-1_lead-key', { sequenceId: 'seq-1', target: 'contact', leadId: LEAD, contactId: 'c-1' })
    await expect(
      followOutreachLeadToContact(firestore, { orgId: ORG, leadId: LEAD, contactId: 'c-1' }),
    ).resolves.toEqual({ enrollments: 0 })
    expect(updates).toEqual([])
  })
})
