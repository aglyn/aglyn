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
 * A soft allotment's crossings (AGL-2942), through the alert pipeline's two
 * channels: once per threshold per month, to the workspace's owners and
 * admins and to the person the allotment is for — who gets the words without
 * the Billing link a collaborator cannot open.
 *
 * The channels are the injectable seam; the marker is real Firestore
 * semantics over a double, so "announced twice" and "never announced" are
 * both reachable.
 */

let mockDocs = new Map<string, Record<string, unknown>>()

function mockSnapshot(path: string) {
  return {
    id: path.split('/').pop() as string,
    exists: mockDocs.has(path),
    data: () => mockDocs.get(path),
    get: (field: string) => (mockDocs.get(path) ?? {})[field],
  }
}
function mockRef(path: string): any {
  return {
    path,
    id: path.split('/').pop(),
    collection: (name: string) => mockCollection(`${path}/${name}`),
    get: async () => mockSnapshot(path),
  }
}
function mockCollection(prefix: string): any {
  return {
    doc: (id: string) => mockRef(`${prefix}/${id}`),
    get: async () => ({
      docs: [...mockDocs.keys()]
        .filter((path) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'))
        .map(mockSnapshot),
    }),
  }
}
const mockFirestore: any = {
  collection: (name: string) => mockCollection(name),
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const queued: Array<() => void> = []
    const result = await fn({
      get: async (ref: { path: string }) => mockSnapshot(ref.path),
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        queued.push(() => mockDocs.set(ref.path, { ...(mockDocs.get(ref.path) ?? {}), ...data }))
      },
    })
    for (const write of queued) write()
    return result
  },
}

// The real channels are replaced per call; the modules behind them would
// initialize the admin app on import.
jest.mock('@aglyn/tenant-data-admin/server/notifications', () => ({ __esModule: true, notifyUsers: jest.fn() }))
jest.mock('@aglyn/tenant-data-admin/server/email-suppression', () => ({ __esModule: true, filterSuppressedEmails: jest.fn() }))
jest.mock('@aglyn/tenant-data-admin/server/email-metering', () => ({ __esModule: true, meterPlatformEmail: jest.fn() }))
jest.mock('@aglyn/shared-util-email', () => ({ __esModule: true, sendEmail: jest.fn() }))

import { announceAiAllotmentAlerts } from './ai-allotment-alerts'

const ORG = 'org-alerts'
const MONTH = '2026-09'

const channels = () => ({
  notify: jest.fn(async () => undefined),
  send: jest.fn(async () => ({ sent: true as const, id: 'email-1' })),
  filter: jest.fn(async (emails: readonly string[]) => [...emails]),
  meter: jest.fn(async () => undefined),
})

const memberStanding = {
  subject: 'member:m1',
  scope: 'member' as const,
  uid: 'm1',
  hostId: null,
  credits: 1000,
  used: 850,
  mode: 'soft' as const,
}

beforeEach(() => {
  mockDocs = new Map<string, Record<string, unknown>>([
    [`orgs/${ORG}/members/owner-1`, { role: 'owner', email: 'owner@example.test' }],
    [`orgs/${ORG}/members/admin-1`, { role: 'admin', email: 'admin@example.test' }],
    [`orgs/${ORG}/members/m1`, { role: 'editor', email: 'sam@example.test', displayName: 'Sam' }],
    [`orgs/${ORG}/aiAllotments/member:m1`, { credits: 1000, mode: 'soft' }],
    [`orgs/${ORG}/aiAllotments/host:h1`, { credits: 5000, mode: 'soft' }],
    ['hosts/h1', { displayName: 'Acme' }],
  ])
})

describe('a soft allotment’s crossing', () => {
  it('tells the managers with the Billing link and the person without it, in the console and by email', async () => {
    const pipeline = channels()
    const announced = await announceAiAllotmentAlerts(
      mockFirestore,
      { orgId: ORG, orgSlug: 'acme', month: MONTH, alerts: [{ standing: memberStanding, threshold: 80 }] },
      pipeline,
    )
    expect(announced).toBe(1)
    expect(pipeline.notify).toHaveBeenCalledWith(
      ['owner-1', 'admin-1'],
      expect.objectContaining({
        type: 'billing.usage',
        title: 'Sam is past 80% of their AI allotment',
        link: '/acme/billing/usage#ai-allotments',
        orgId: ORG,
      }),
    )
    expect(pipeline.notify).toHaveBeenCalledWith(
      ['m1'],
      expect.not.objectContaining({ link: expect.anything() }),
    )
    expect(pipeline.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['owner@example.test', 'admin@example.test'], context: 'ai-allotment-alert' }),
    )
    expect(pipeline.send).toHaveBeenCalledWith(expect.objectContaining({ to: ['sam@example.test'] }))
    expect(pipeline.meter).toHaveBeenCalledTimes(2)
  })

  it('announces a threshold ONCE a month, a higher one again, and the same one next month', async () => {
    const pipeline = channels()
    const at = (threshold: 80 | 100, month = MONTH) =>
      announceAiAllotmentAlerts(
        mockFirestore,
        { orgId: ORG, orgSlug: 'acme', month, alerts: [{ standing: memberStanding, threshold }] },
        pipeline,
      )
    expect(await at(80)).toBe(1)
    expect(await at(80)).toBe(0)
    expect(await at(100)).toBe(1)
    expect(await at(80)).toBe(0)
    expect(await at(80, '2026-10')).toBe(1)
    expect(mockDocs.get(`orgs/${ORG}/aiAllotments/member:m1`)).toMatchObject({
      alerted: { month: '2026-10', threshold: 80 },
    })
  })

  it('a site’s crossing goes to the managers alone, naming the site', async () => {
    const pipeline = channels()
    await announceAiAllotmentAlerts(
      mockFirestore,
      {
        orgId: ORG,
        orgSlug: null,
        month: MONTH,
        alerts: [
          {
            standing: { ...memberStanding, subject: 'host:h1', scope: 'host', uid: null, hostId: 'h1', credits: 5000, used: 5100 },
            threshold: 100,
          },
        ],
      },
      pipeline,
    )
    expect(pipeline.notify).toHaveBeenCalledTimes(1)
    expect(pipeline.notify).toHaveBeenCalledWith(
      ['owner-1', 'admin-1'],
      expect.objectContaining({ title: 'The Acme site has used its whole AI allotment' }),
    )
    expect(pipeline.send).toHaveBeenCalledTimes(1)
  })

  it('an allotment removed before the crossing is announced is not announced, and a failing channel stops nothing else', async () => {
    const pipeline = channels()
    mockDocs.delete(`orgs/${ORG}/aiAllotments/member:m1`)
    pipeline.notify.mockRejectedValueOnce(new Error('down'))
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const announced = await announceAiAllotmentAlerts(
      mockFirestore,
      {
        orgId: ORG,
        orgSlug: 'acme',
        month: MONTH,
        alerts: [
          { standing: memberStanding, threshold: 80 },
          {
            standing: { ...memberStanding, subject: 'host:h1', scope: 'host', uid: null, hostId: 'h1' },
            threshold: 80,
          },
        ],
      },
      pipeline,
    )
    // The removed member allotment is skipped; the site's throws in its
    // notification and is logged, not rethrown.
    expect(announced).toBe(0)
    expect(console.error).toHaveBeenCalled()
  })
})
