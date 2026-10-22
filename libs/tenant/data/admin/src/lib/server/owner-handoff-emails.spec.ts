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
 * AGL-4023 — a completed workspace handoff emails both sides: the new owner
 * (theirs now, and the next step) and the person who handed it over (who
 * holds it now, and where that leaves them).
 */

let mockOrg: Record<string, unknown> | undefined
let mockConfigured = true
const mockSend = jest.fn()
const mockRender = jest.fn()
const mockMeter = jest.fn()

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: Boolean(mockOrg), data: () => mockOrg }),
          }),
        }),
      }),
    }),
  },
}))
jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => mockConfigured,
  sendEmail: (...args: unknown[]) => mockSend(...args),
}))
jest.mock('./email-metering', () => ({
  __esModule: true,
  meterOrgEmail: (...args: unknown[]) => mockMeter(...args),
}))
jest.mock('./render-system-email', () => ({
  __esModule: true,
  systemEmailBrand: () => ({
    merge: { 'brand.productName': 'Aglyn' },
    options: {},
    fromName: 'Aglyn',
  }),
  renderSystemEmailContent: (key: string, merge: Record<string, string>) => {
    mockRender(key, merge)
    return Promise.resolve({ subject: `subject:${key}`, text: `text:${key}` })
  },
}))

import { sendOwnerHandoffEmails } from './owner-handoff-emails'

const PROPOSAL = {
  plan: 'starter',
  addons: { siteCare: true },
  interval: 'year',
  proposedAt: 1,
  proposedBy: { uid: 'staff', email: 'staff@aglyn.com' },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockConfigured = true
  mockOrg = { name: 'Acme Builders', slug: 'acme-builders', upgradeProposal: PROPOSAL }
})

const run = (stays = true) =>
  sendOwnerHandoffEmails({
    orgId: 'org-edr',
    newOwner: { email: 'jordan@example.com', displayName: 'Jordan Lee' },
    previousOwner: { email: 'pat@example.com', displayName: 'Pat Lee' },
    previousOwnerStays: stays,
  })

describe('the new owner', () => {
  it('is told the workspace is theirs, and sent to Billing with the proposed plan', async () => {
    await run()
    const [key, merge] = mockRender.mock.calls[0]
    expect(key).toBe('org-owner-handoff-new-owner')
    expect(merge['org.name']).toBe('Acme Builders')
    expect(merge['handoff.previousOwner']).toBe('Pat Lee stays on as an admin.')
    expect(merge.nextStep).toContain('Your plan is ready to start')
    expect(merge['cta.label']).toBe('Start the Starter plan')
    expect(merge['cta.url']).toMatch(/^https:\/\/app\.aglyn\.com\/acme-builders\/billing\?plan=starter/)
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jordan@example.com',
        subject: 'subject:org-owner-handoff-new-owner',
        fromName: 'Aglyn',
        context: 'org-owner-handoff-new-owner',
      }),
    )
  })

  it('without a standing proposal, opens the workspace instead', async () => {
    mockOrg = { name: 'Acme Builders', slug: 'acme-builders' }
    await run()
    const [, merge] = mockRender.mock.calls[0]
    expect(merge['cta.label']).toBe('Open Acme Builders')
    expect(merge['cta.url']).toBe('https://app.aglyn.com/acme-builders')
    expect(merge.nextStep).not.toContain('plan')
  })
})

describe('the person who handed it over', () => {
  it('is told who owns it now, and that they stay on as an admin', async () => {
    await run()
    const [key, merge] = mockRender.mock.calls[1]
    expect(key).toBe('org-owner-handoff-previous-owner')
    expect(merge['newOwner.name']).toBe('Jordan Lee')
    expect(merge['newOwner.email']).toBe('jordan@example.com')
    expect(merge['previousOwner.role']).toBe('Admin')
    expect(merge['cta.url']).toBe('https://app.aglyn.com/acme-builders/team')
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'pat@example.com', context: 'org-owner-handoff-previous-owner' }),
    )
    expect(mockMeter).toHaveBeenCalledTimes(2)
  })

  it('who left is told so, and is not sent to a Team page they cannot open', async () => {
    await run(false)
    const [, newOwnerMerge] = mockRender.mock.calls[0]
    expect(newOwnerMerge['handoff.previousOwner']).toBe('Pat Lee has left the workspace.')
    const [, merge] = mockRender.mock.calls[1]
    expect(merge['previousOwner.role']).toBe('Left the workspace')
    expect(merge['cta.url']).toBe('https://app.aglyn.com')
  })
})

it('sends nothing where email is not configured, and never throws', async () => {
  mockConfigured = false
  await run()
  expect(mockSend).not.toHaveBeenCalled()
  mockConfigured = true
  mockSend.mockRejectedValueOnce(new Error('provider down'))
  await expect(run()).resolves.toBeUndefined()
})
