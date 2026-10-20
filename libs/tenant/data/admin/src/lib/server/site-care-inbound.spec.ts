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
 * SITE CARE MAIL AT THE SUPPORT ADDRESS (AGL-3959, AGL-3997): which received
 * messages are Site Care mail, which request a reply joins, and that nothing
 * else is filed or answered. Whether a workspace has Site Care is the real
 * reading of its billing; opening a request and appending a reply are
 * recorded doubles, since `site-care-requests.spec.ts` covers them.
 */

import type { ReceivedEmail } from '@aglyn/shared-util-email'
import {
  fileSiteCareInboundEmail,
  findSiteCareAccount,
  siteCareInboundTarget,
  siteCareMachineMail,
  siteCareMessageBody,
  type SiteCareInboundAddresses,
} from './site-care-inbound'

const mockFindAcrossPools = jest.fn()
jest.mock('./auth-pools', () => ({
  __esModule: true,
  findUserByEmailAcrossPools: (email: string) => mockFindAcrossPools(email),
}))

/** Workspaces billed for Site Care, by id; any other reads as a plan without it. */
const mockSiteCareOrgs = new Set<string>()
jest.mock('./org-billing', () => ({
  __esModule: true,
  readOrgBilling: async (orgId: string) =>
    mockSiteCareOrgs.has(orgId)
      ? { plan: 'starter', stripeCustomerId: 'cus_1', subscription: { status: 'active' }, seatAddons: { siteCare: 1 } }
      : { plan: 'starter', stripeCustomerId: 'cus_2', subscription: { status: 'active' } },
}))
jest.mock('./notifications', () => ({ __esModule: true, notifyStaff: async () => undefined }))
jest.mock('./site-care-emails', () => ({
  __esModule: true,
  sendSiteCareEmail: async () => ({ sent: false, to: null, subject: '', reason: 'unconfigured' }),
}))

const mockOpen = jest.fn()
const mockAppend = jest.fn()
jest.mock('./site-care-requests', () => ({
  __esModule: true,
  ...jest.requireActual('./site-care-requests'),
  openSiteCareRequest: (...args: unknown[]) => mockOpen(...args),
  appendSiteCareReply: (...args: unknown[]) => mockAppend(...args),
}))

const DOMAIN = 'in.aglyn.com'
const SUPPORT = 'help@example.com'
const ADDRESSES: SiteCareInboundAddresses = {
  domain: DOMAIN,
  supportEmail: SUPPORT,
  platformSender: 'noreply@notify.example.com',
}

// ── As much Firestore as the intake reads: documents by path ───────────────

const mockDocs = new Map<string, Record<string, unknown>>()
const reads: string[] = []
const last = (path: string) => path.slice(path.lastIndexOf('/') + 1)

function snapshot(path: string) {
  const data = mockDocs.get(path)
  return { id: last(path), exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
}

function docRef(path: string): unknown {
  return {
    id: last(path),
    get: async () => {
      reads.push(path)
      return snapshot(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): unknown {
  const children = () =>
    [...mockDocs.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    limit: () => ({
      get: async () => {
        reads.push(path)
        return { docs: children().map(snapshot) }
      },
    }),
  }
}

const firestore = { collection: (name: string) => collectionRef(name) } as unknown as FirebaseFirestore.Firestore

/** A member of `orgId`, signing in as `uid`. */
function member(uid: string, orgId: string) {
  mockDocs.set(`orgs/${orgId}`, { name: orgId })
  mockDocs.set(`orgs/${orgId}/members/${uid}`, { role: 'owner' })
  mockDocs.set(`users/${uid}/orgs/${orgId}`, { role: 'owner' })
}

const ACCOUNTS: Record<string, string> = {
  'owner@example.com': 'u-owner',
  'neighbor@example.org': 'u-neighbor',
  'plain@example.org': 'u-plain',
}
const findAccount = async (email: string) => (ACCOUNTS[email] ? { uid: ACCOUNTS[email] } : null)

const MESSAGE: ReceivedEmail = {
  id: 'msg-1',
  messageId: '<m1@mail.example.com>',
  inReplyTo: '',
  from: 'Avery Quinn <owner@example.com>',
  to: [SUPPORT],
  cc: [],
  bcc: [],
  receivedFor: [],
  subject: 'New Saturday hours',
  text: 'Saturday becomes 9 to 2 for December.',
  html: '',
  receivedAtMs: 1_760_900_000_000,
}

const sent: unknown[] = []
const email = async (input: { to: string | null; fallback: { subject: string } }) => {
  sent.push(input)
  return { sent: true, to: input.to, subject: input.fallback.subject }
}

beforeEach(() => {
  mockDocs.clear()
  reads.length = 0
  sent.length = 0
  mockSiteCareOrgs.clear()
  mockOpen.mockReset().mockResolvedValue({ ticketId: 'ticket-new', dueAtMs: 0 })
  mockAppend.mockReset().mockResolvedValue({ appended: true })
  // Avery owns a workspace with Site Care; the neighbor owns another one;
  // the plain member's workspace has no Site Care.
  member('u-owner', 'org-care')
  member('u-neighbor', 'org-other-care')
  member('u-plain', 'org-plain')
  mockSiteCareOrgs.add('org-care').add('org-other-care')
  mockDocs.set('supportTickets/AbCdEf0123456789XyZw', { orgId: 'org-care', kind: 'siteCare', subject: 'Hours' })
})

describe('siteCareInboundTarget', () => {
  it('reads the operator’s support address, and support@ the inbound domain, as a new request', () => {
    expect(siteCareInboundTarget([SUPPORT], ADDRESSES)).toEqual({ kind: 'new' })
    expect(siteCareInboundTarget(['Support <HELP@Example.com>'], ADDRESSES)).toEqual({ kind: 'new' })
    expect(siteCareInboundTarget(['support@in.aglyn.com'], ADDRESSES)).toEqual({ kind: 'new' })
    expect(siteCareInboundTarget(['Aglyn <SUPPORT@In.Aglyn.com>'], ADDRESSES)).toEqual({ kind: 'new' })
  })

  it('reads support+<id>@ as a reply, keeping the id’s case', () => {
    expect(siteCareInboundTarget(['support+AbCdEf0123456789XyZw@in.aglyn.com'], ADDRESSES)).toEqual({
      kind: 'reply',
      requestId: 'AbCdEf0123456789XyZw',
    })
    expect(siteCareInboundTarget(['"Aglyn" <support+AbCdEf0123456789XyZw@in.aglyn.com>'], ADDRESSES)).toEqual({
      kind: 'reply',
      requestId: 'AbCdEf0123456789XyZw',
    })
  })

  it('prefers a reply over a plain support address among the recipients', () => {
    expect(
      siteCareInboundTarget([SUPPORT, 'support@in.aglyn.com', 'support+abcdefghij12@in.aglyn.com'], ADDRESSES),
    ).toEqual({ kind: 'reply', requestId: 'abcdefghij12' })
  })

  it('no longer reads care@ or care+<id>@, which nothing writes', () => {
    expect(siteCareInboundTarget(['care@in.aglyn.com'], ADDRESSES)).toBeNull()
    expect(siteCareInboundTarget(['care+AbCdEf0123456789XyZw@in.aglyn.com'], ADDRESSES)).toBeNull()
  })

  it('ignores other addresses, other domains and ids of the wrong shape', () => {
    expect(siteCareInboundTarget(['sales@in.aglyn.com'], ADDRESSES)).toBeNull()
    expect(siteCareInboundTarget(['support@elsewhere.example'], ADDRESSES)).toBeNull()
    expect(siteCareInboundTarget(['support+short@in.aglyn.com'], ADDRESSES)).toBeNull()
    expect(siteCareInboundTarget(['support+bad/id/abcdefgh@in.aglyn.com'], ADDRESSES)).toBeNull()
    expect(siteCareInboundTarget(['not an address'], ADDRESSES)).toBeNull()
    expect(siteCareInboundTarget([], ADDRESSES)).toBeNull()
  })

  it('reads only the inbound domain’s support@ when the deployment publishes no support address', () => {
    const unpublished = { domain: DOMAIN, supportEmail: null }
    expect(siteCareInboundTarget([SUPPORT], unpublished)).toBeNull()
    expect(siteCareInboundTarget(['support@in.aglyn.com'], unpublished)).toEqual({ kind: 'new' })
  })
})

describe('siteCareMachineMail', () => {
  it('names the platform’s own mail and a machine’s, and lets a person through', () => {
    expect(siteCareMachineMail({ from: `Support <${SUPPORT}>` }, ADDRESSES)).toBe('ours')
    expect(siteCareMachineMail({ from: 'Aglyn <noreply@notify.example.com>' }, ADDRESSES)).toBe('ours')
    expect(siteCareMachineMail({ from: 'support+AbCdEf0123456789XyZw@in.aglyn.com' }, ADDRESSES)).toBe('ours')
    expect(siteCareMachineMail({ from: 'owner@example.com', autoSubmitted: true }, ADDRESSES)).toBe('automatic')
    expect(siteCareMachineMail({ from: 'owner@example.com', autoSubmitted: false }, ADDRESSES)).toBeNull()
    expect(siteCareMachineMail({ from: 'owner@example.com' }, ADDRESSES)).toBeNull()
  })
})

describe('siteCareMessageBody', () => {
  it('keeps the words above the quoted history', () => {
    const body = siteCareMessageBody({
      text: 'Please change the hours to 9–6.\r\n\r\nOn Mon, Oct 19, 2026 at 10:00 AM Aglyn wrote:\r\n> We have your request',
      html: '',
    })
    expect(body).toBe('Please change the hours to 9–6.')
  })

  it('falls back to the html', () => {
    expect(siteCareMessageBody({ text: '', html: '<p>Swap the <b>photo</b></p>' })).toContain('Swap the photo')
  })
})

describe('findSiteCareAccount', () => {
  it('looks the sender up in every auth pool, so an SSO owner is not a stranger', async () => {
    mockFindAcrossPools.mockResolvedValueOnce({ record: { uid: 'sso-owner' }, tenantId: 'tenant-1' })
    expect(await findSiteCareAccount('owner@example.com')).toEqual({ uid: 'sso-owner' })
    expect(mockFindAcrossPools).toHaveBeenCalledWith('owner@example.com')
    mockFindAcrossPools.mockResolvedValueOnce(null)
    expect(await findSiteCareAccount('nobody@example.com')).toBeNull()
    mockFindAcrossPools.mockRejectedValueOnce(new Error('auth unavailable'))
    expect(await findSiteCareAccount('owner@example.com')).toBeNull()
  })
})

describe('fileSiteCareInboundEmail', () => {
  const file = (message: ReceivedEmail, target = siteCareInboundTarget(message.to, ADDRESSES)) =>
    fileSiteCareInboundEmail(firestore, { target: target!, message, addresses: ADDRESSES, findAccount }, { email })

  it('opens a request for a Site Care member writing to the support address', async () => {
    expect(await file(MESSAGE)).toEqual({ outcome: 'opened', requestId: 'ticket-new' })
    expect(mockOpen).toHaveBeenCalledTimes(1)
    expect(mockOpen.mock.calls[0][1]).toMatchObject({
      orgId: 'org-care',
      subject: 'New Saturday hours',
      body: 'Saturday becomes 9 to 2 for December.',
      requester: { uid: 'u-owner', email: 'owner@example.com' },
      source: 'email',
      dedupeKey: '<m1@mail.example.com>',
    })
  })

  it('opens one for the copy the support mailbox delivers to support@ the inbound domain', async () => {
    const copy = { ...MESSAGE, to: [SUPPORT], receivedFor: ['support@in.aglyn.com'] }
    expect(await file(copy, siteCareInboundTarget(['support@in.aglyn.com'], ADDRESSES))).toEqual({
      outcome: 'opened',
      requestId: 'ticket-new',
    })
  })

  it('leaves a member of a workspace without Site Care to the support inbox: nothing filed, nothing sent', async () => {
    const outcome = await file({ ...MESSAGE, from: 'plain@example.org' })
    expect(outcome).toEqual({ outcome: 'ignored', reason: 'not-a-member' })
    expect(mockOpen).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  it('leaves a sender with no account to the support inbox without reading Firestore or answering', async () => {
    const outcome = await file({ ...MESSAGE, from: 'Stranger <stranger@example.net>' })
    expect(outcome).toEqual({ outcome: 'ignored', reason: 'not-a-member' })
    expect(reads).toEqual([])
    expect(mockOpen).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  it('joins a reply to support+<id>@ from a member of the request’s workspace to that request', async () => {
    const reply = {
      ...MESSAGE,
      messageId: '<m2@mail.example.com>',
      to: ['support+AbCdEf0123456789XyZw@in.aglyn.com'],
      subject: 'Re: We have your request: New Saturday hours',
      text: 'And Sunday is closed.\n\nOn Mon, Oct 19, 2026 Aglyn wrote:\n> We have your request',
    }
    expect(await file(reply)).toEqual({ outcome: 'replied', requestId: 'AbCdEf0123456789XyZw' })
    expect(mockAppend).toHaveBeenCalledTimes(1)
    expect(mockAppend.mock.calls[0][1]).toEqual({
      ticketId: 'AbCdEf0123456789XyZw',
      from: { uid: 'u-owner', email: 'owner@example.com' },
      body: 'And Sunday is closed.',
      dedupeKey: '<m2@mail.example.com>',
    })
    expect(mockOpen).not.toHaveBeenCalled()
  })

  it('reads a reply from a member of another Site Care workspace as a new request on theirs', async () => {
    const reply = { ...MESSAGE, from: 'neighbor@example.org', to: ['support+AbCdEf0123456789XyZw@in.aglyn.com'] }
    expect(await file(reply)).toEqual({ outcome: 'opened', requestId: 'ticket-new' })
    expect(mockAppend).not.toHaveBeenCalled()
    expect(mockOpen.mock.calls[0][1]).toMatchObject({ orgId: 'org-other-care' })
  })

  it('ignores a reply from someone who is no Site Care member, and sends nothing back', async () => {
    const reply = { ...MESSAGE, from: 'stranger@example.net', to: ['support+AbCdEf0123456789XyZw@in.aglyn.com'] }
    expect(await file(reply)).toEqual({ outcome: 'ignored', reason: 'not-a-member' })
    expect(mockAppend).not.toHaveBeenCalled()
    expect(mockOpen).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  it('never files the platform’s own mail or a machine’s, even from a member', async () => {
    expect(await file({ ...MESSAGE, from: `Support <${SUPPORT}>` })).toEqual({ outcome: 'ignored', reason: 'ours' })
    expect(await file({ ...MESSAGE, from: 'Aglyn <noreply@notify.example.com>' })).toEqual({
      outcome: 'ignored',
      reason: 'ours',
    })
    const outOfOffice = {
      ...MESSAGE,
      autoSubmitted: true,
      to: ['support+AbCdEf0123456789XyZw@in.aglyn.com'],
      subject: 'Automatic reply: We have your request',
      text: 'I am away until Monday.',
    }
    expect(await file(outOfOffice)).toEqual({ outcome: 'ignored', reason: 'automatic' })
    expect(reads).toEqual([])
    expect(mockOpen).not.toHaveBeenCalled()
    expect(mockAppend).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  it('files nothing for a member’s message with no words and no subject', async () => {
    expect(await file({ ...MESSAGE, subject: '', text: '', html: '' })).toEqual({ outcome: 'ignored', reason: 'empty' })
    expect(mockOpen).not.toHaveBeenCalled()
  })
})
