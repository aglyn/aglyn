/**
 * What a delivered campaign email does to a lead (AGL-3446): a lead the
 * sending site holds and nobody has touched moves from New to Nurturing,
 * found by the `personKey` of the address it reached, and nothing else
 * moves.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}))

import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { nurtureReachedLeads } from './lead-nurturing'

const docs = new Map<string, Record<string, unknown>>()
let commits = 0

const docRef = (path: string) => ({ path })
const firestore: any = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      collection: (sub: string) => ({ doc: (key: string) => docRef(`${name}/${id}/${sub}/${key}`) }),
    }),
  }),
  getAll: async (...refs: Array<{ path: string }>) =>
    refs.map((ref) => ({ ref, exists: docs.has(ref.path), data: () => docs.get(ref.path) })),
  batch: () => {
    const queued: Array<[string, Record<string, unknown>]> = []
    return {
      set: (ref: { path: string }, value: Record<string, unknown>) => void queued.push([ref.path, value]),
      commit: async () => {
        commits += 1
        for (const [path, value] of queued) docs.set(path, { ...(docs.get(path) ?? {}), ...value })
      },
    }
  },
}

const ORG = 'org-1'
const HOST = 'site-1'
const leadPath = (email: string) => `orgs/${ORG}/leads/${personKey(email)}`
const lead = (email: string, fields: Record<string, unknown> = {}) =>
  docs.set(leadPath(email), { email, visibleTo: [`host:${HOST}`], ...fields })

beforeEach(() => {
  docs.clear()
  commits = 0
})

describe('nurtureReachedLeads', () => {
  it('moves a reached lead nobody touched to Nurturing, however its address was cased', async () => {
    lead('dana@example.com')
    lead('lee@example.com', { status: 'new' })
    await expect(
      nurtureReachedLeads(firestore, { orgId: ORG, hostId: HOST, emails: ['Dana@Example.com', 'lee@example.com'] }),
    ).resolves.toBe(2)
    expect(docs.get(leadPath('dana@example.com'))).toMatchObject({ status: 'nurturing' })
    expect(docs.get(leadPath('lee@example.com'))).toMatchObject({ status: 'nurturing' })
    expect(commits).toBe(1)
  })

  it('never moves a lead back, a converted one, or one the sending site does not hold', async () => {
    lead('a@example.com', { status: 'working' })
    lead('b@example.com', { status: 'unqualified' })
    lead('c@example.com', { status: 'nurturing' })
    lead('d@example.com', { status: 'qualified', convertedContactId: 'c-1' })
    lead('e@example.com', { convertedContactId: 'c-2' })
    lead('f@example.com', { visibleTo: ['host:other-site'] })
    const before = new Map(docs)
    await expect(
      nurtureReachedLeads(firestore, {
        orgId: ORG,
        hostId: HOST,
        emails: ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com', 'f@example.com', 'nobody@example.com'],
      }),
    ).resolves.toBe(0)
    expect(docs).toEqual(before)
    expect(commits).toBe(0)
  })

  it('moves a lead the org holds for every site', async () => {
    lead('dana@example.com', { visibleTo: ['org'] })
    await expect(nurtureReachedLeads(firestore, { orgId: ORG, hostId: HOST, emails: ['dana@example.com'] })).resolves.toBe(1)
  })

  it('swallows a failed read: the mail has already gone', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = { ...firestore, getAll: async () => Promise.reject(new Error('unavailable')) }
    await expect(nurtureReachedLeads(broken, { orgId: ORG, hostId: HOST, emails: ['dana@example.com'] })).resolves.toBe(0)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
