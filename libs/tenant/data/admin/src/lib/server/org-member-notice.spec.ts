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

const sends: Array<Record<string, unknown>> = []
const suppressed = new Set<string>()
const directory = new Map<string, string>()
const metered: string[] = []
let emailConfigured = true
let roster: Array<{ $id: string; role?: string; email?: string }> = []
let sendOk = true

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => emailConfigured,
  sendEmail: async (options: Record<string, unknown>) => {
    sends.push(options)
    return sendOk ? { sent: true, id: 'msg' } : { sent: false, reason: 'network' }
  },
}))
jest.mock('./auth-pools', () => ({
  findUserByUidAcrossPools: async (uid: string) =>
    directory.has(uid) ? { record: { email: directory.get(uid) }, tenantId: null } : null,
}))
jest.mock('./email-suppression', () => ({
  filterSuppressedEmails: async (addresses: readonly string[]) =>
    addresses.filter((address) => !suppressed.has(address)),
}))
jest.mock('./email-metering', () => ({
  meterOrgEmail: async (orgId: string) => {
    metered.push(`org:${orgId}`)
  },
}))
jest.mock('./organizations', () => ({
  listOrgMembers: async () => roster,
}))

import { sendOrgMemberNotice } from './org-member-notice'

const notice = (overrides: Partial<Parameters<typeof sendOrgMemberNotice>[0]> = {}) =>
  sendOrgMemberNotice({
    orgId: 'org-1',
    uids: ['uid-rep'],
    subject: 'Sequences paused your mailbox',
    text: 'Paused.',
    context: 'outreach-mailbox-notice',
    ...overrides,
  })

beforeEach(() => {
  sends.length = 0
  metered.length = 0
  suppressed.clear()
  directory.clear()
  emailConfigured = true
  sendOk = true
  roster = [
    { $id: 'uid-owner', role: 'owner', email: 'Owner@Example.com' },
    { $id: 'uid-admin', role: 'admin', email: 'admin@example.com' },
    { $id: 'uid-rep', role: 'editor', email: 'rep@example.com' },
    { $id: 'uid-other', role: 'editor', email: 'other@example.com' },
  ]
})

describe('sendOrgMemberNotice (AGL-3244)', () => {
  it('emails the members named, one send each, off the roster, and meters the organization', async () => {
    expect(await notice()).toEqual({ sent: 1 })
    expect(sends).toEqual([
      { to: 'rep@example.com', subject: 'Sequences paused your mailbox', text: 'Paused.', context: 'outreach-mailbox-notice' },
    ])
    expect(metered).toEqual(['org:org-1'])
  })

  it('adds the owners and admins when asked, never twice, never anyone else', async () => {
    roster[0].$id = 'uid-rep-owner'
    expect(await notice({ uids: ['uid-rep', 'uid-admin'], includeAdmins: true })).toEqual({ sent: 3 })
    expect(sends.map((send) => send['to']).sort()).toEqual(['admin@example.com', 'owner@example.com', 'rep@example.com'])
  })

  it('asks the directory for a member whose roster row has no address', async () => {
    roster = [{ $id: 'uid-rep', role: 'editor' }]
    directory.set('uid-rep', 'Rep@Example.org')
    expect(await notice()).toEqual({ sent: 1 })
    expect(sends[0]['to']).toBe('rep@example.org')
  })

  it('skips a suppressed address, and says when there was nobody to write to', async () => {
    suppressed.add('rep@example.com')
    expect(await notice()).toEqual({ sent: 0, reason: 'no-recipients' })
    expect(sends).toEqual([])
    expect(await notice({ uids: ['uid-nobody'] })).toEqual({ sent: 0, reason: 'no-recipients' })
  })

  it('reports an unconfigured sender and a failed send without throwing', async () => {
    emailConfigured = false
    expect(await notice()).toEqual({ sent: 0, reason: 'unconfigured' })
    emailConfigured = true
    sendOk = false
    expect(await notice()).toEqual({ sent: 0, reason: 'failed' })
    expect(metered).toEqual([])
  })
})
