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
  findSiteCareWorkspacesForSender,
  siteCareAddressMatches,
  siteCareInboundTarget,
  siteCareMachineMail,
  siteCareMessageBody,
  siteCareSenderCandidates,
  type SiteCareInboundAddresses,
} from './site-care-inbound'

const mockFindAcrossPools = jest.fn()
jest.mock('./auth-pools', () => ({
  __esModule: true,
  findUserByEmailAcrossPools: (email: string) => mockFindAcrossPools(email),
}))

const mockFindAlias = jest.fn()
jest.mock('./account-emails', () => ({
  __esModule: true,
  findAccountByVerifiedAlias: (email: string) => mockFindAlias(email),
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

function fieldOf(data: Record<string, unknown> | undefined, field: string): unknown {
  return field.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], data)
}

function collectionRef(path: string): unknown {
  const children = () =>
    [...mockDocs.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
  const read = (keep: (key: string) => boolean = () => true) => async () => {
    reads.push(path)
    return { docs: children().filter(keep).map(snapshot) }
  }
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    get: read(),
    limit: () => ({ get: read() }),
    // The one query the intake makes: workspaces that bought Site Care.
    where: (field: string, op: string, value: number) => {
      expect(op).toBe('>=')
      const keep = (key: string) => Number(fieldOf(mockDocs.get(key), field) ?? 0) >= value
      return { limit: () => ({ get: read(keep) }) }
    },
  }
}

const firestore = { collection: (name: string) => collectionRef(name) } as unknown as FirebaseFirestore.Firestore

const ACCOUNTS: Record<string, string> = {
  'owner@example.com': 'u-owner',
  'neighbor@example.org': 'u-neighbor',
  'plain@example.org': 'u-plain',
}
const findAccount = async (email: string) => (ACCOUNTS[email] ? { uid: ACCOUNTS[email] } : null)

/** A member of `orgId`, signing in as `uid` with the address `ACCOUNTS` gives it (or `email`). */
function member(uid: string, orgId: string, email?: string) {
  const address = email ?? Object.keys(ACCOUNTS).find((key) => ACCOUNTS[key] === uid) ?? null
  mockDocs.set(`orgs/${orgId}`, { ...(mockDocs.get(`orgs/${orgId}`) ?? {}), name: orgId })
  mockDocs.set(`orgs/${orgId}/members/${uid}`, { role: 'owner', email: address })
  mockDocs.set(`users/${uid}/orgs/${orgId}`, { role: 'owner' })
}

/** Bills `orgId` for Site Care: on the org document, where the roster pass finds it, and in its billing. */
function buySiteCare(orgId: string) {
  mockSiteCareOrgs.add(orgId)
  mockDocs.set(`orgs/${orgId}`, { ...(mockDocs.get(`orgs/${orgId}`) ?? {}), seatAddons: { siteCare: 1 } })
}

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
  mockFindAcrossPools.mockReset()
  mockFindAlias.mockReset().mockResolvedValue(null)
  // Avery owns a workspace with Site Care; the neighbor owns another one;
  // the plain member's workspace has no Site Care.
  member('u-owner', 'org-care')
  member('u-neighbor', 'org-other-care')
  member('u-plain', 'org-plain')
  buySiteCare('org-care')
  buySiteCare('org-other-care')
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

  it('then the addresses people confirmed on their account, and nothing unconfirmed', async () => {
    mockFindAcrossPools.mockResolvedValue(null)
    mockFindAlias.mockImplementation(async (email: string) =>
      email === 'avery@work.example' ? { uid: 'u-owner', address: email } : null,
    )
    expect(await findSiteCareAccount('avery@work.example')).toEqual({ uid: 'u-owner' })
    expect(await findSiteCareAccount('typed-only@work.example')).toBeNull()
  })
})

describe('siteCareSenderCandidates', () => {
  it('tries the address, then without its tag, then Gmail’s other spellings', () => {
    expect(siteCareSenderCandidates('Avery <Avery@Example.com>')).toEqual([['avery@example.com']])
    expect(siteCareSenderCandidates('avery+site@example.com')).toEqual([['avery+site@example.com'], ['avery@example.com']])
    expect(siteCareSenderCandidates('a.very+x@gmail.com')).toEqual([
      ['a.very+x@gmail.com'],
      ['a.very@gmail.com'],
      ['avery@gmail.com', 'a.very@googlemail.com', 'avery@googlemail.com'],
    ])
  })

  it('folds no dots outside Gmail, and never leaves the sender’s domain', () => {
    const all = siteCareSenderCandidates('a.very+x@example.com').flat()
    expect(all).toEqual(['a.very+x@example.com', 'a.very@example.com'])
    expect(siteCareSenderCandidates('not an address')).toEqual([])
  })
})

describe('siteCareAddressMatches', () => {
  it('is one mailbox regardless of case, a sender’s tag, and Gmail’s dots and domains', () => {
    expect(siteCareAddressMatches('OWNER@Example.com', 'owner@example.com')).toBe(true)
    expect(siteCareAddressMatches('owner+site@example.com', 'owner@example.com')).toBe(true)
    expect(siteCareAddressMatches('firstlast@gmail.com', 'first.last@gmail.com')).toBe(true)
    expect(siteCareAddressMatches('First.Last+care@googlemail.com', 'firstlast@gmail.com')).toBe(true)
  })

  it('is not the same mailbox across domains, with dots outside Gmail, or onto a member’s own tag', () => {
    expect(siteCareAddressMatches('owner@example.org', 'owner@example.com')).toBe(false)
    expect(siteCareAddressMatches('owner@gmail.com', 'owner@example.com')).toBe(false)
    expect(siteCareAddressMatches('first.last@example.com', 'firstlast@example.com')).toBe(false)
    expect(siteCareAddressMatches('owner+other@example.com', 'owner+site@example.com')).toBe(false)
    expect(siteCareAddressMatches('owner@example.com', 'owner+site@example.com')).toBe(false)
    expect(siteCareAddressMatches('', 'owner@example.com')).toBe(false)
  })
})

describe('findSiteCareWorkspacesForSender', () => {
  it('returns every Site Care workspace the sender belongs to, by id', async () => {
    member('u-owner', 'org-b-care')
    buySiteCare('org-b-care')
    member('u-owner', 'org-plain-2')
    const matches = await findSiteCareWorkspacesForSender(firestore, findAccount, 'owner@example.com')
    expect(matches.map((match) => match.orgId)).toEqual(['org-b-care', 'org-care'])
    expect(matches.every((match) => match.uid === 'u-owner' && match.email === 'owner@example.com')).toBe(true)
  })

  it('reads an address that is itself somebody’s sign-in as theirs, never as a look-alike’s', async () => {
    ACCOUNTS['owner+site@example.com'] = 'u-tagged'
    try {
      member('u-tagged', 'org-plain')
      expect(await findSiteCareWorkspacesForSender(firestore, findAccount, 'owner+site@example.com')).toEqual([])
    } finally {
      delete ACCOUNTS['owner+site@example.com']
    }
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

  it('leaves a sender with no account to the support inbox, reading only the Site Care rosters, answering nothing', async () => {
    const outcome = await file({ ...MESSAGE, from: 'Stranger <stranger@example.net>' })
    expect(outcome).toEqual({ outcome: 'ignored', reason: 'not-a-member' })
    expect(reads).toEqual([
      'orgs',
      'orgs/org-care/members',
      'orgs/org-care/memberEmailAliases',
      'orgs/org-other-care/members',
      'orgs/org-other-care/memberEmailAliases',
    ])
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

  it('files a member’s mail from a tagged or differently cased address on their workspace', async () => {
    expect(await file({ ...MESSAGE, from: 'Avery <OWNER+site@Example.com>' })).toEqual({
      outcome: 'opened',
      requestId: 'ticket-new',
    })
    expect(mockOpen.mock.calls[0][1]).toMatchObject({
      orgId: 'org-care',
      requester: { uid: 'u-owner', email: 'owner+site@example.com' },
    })
  })

  it('files a Gmail owner’s mail however they dot it, and from googlemail.com', async () => {
    member('u-gmail', 'org-care', 'first.last@gmail.com')
    expect(await file({ ...MESSAGE, from: 'FirstLast+news@googlemail.com' })).toEqual({
      outcome: 'opened',
      requestId: 'ticket-new',
    })
    expect(mockOpen.mock.calls[0][1]).toMatchObject({ orgId: 'org-care', requester: { uid: 'u-gmail' } })
  })

  it('files mail from an address a member confirmed in the workspace, and not from one only typed', async () => {
    mockDocs.set('orgs/org-care/memberEmailAliases/u-owner', {
      uid: 'u-owner',
      aliases: [
        { address: 'hello@avery-bakery.example', addedAtMs: 1, verifiedAtMs: 2 },
        { address: 'typed@avery-bakery.example', addedAtMs: 1 },
      ],
    })
    expect(await file({ ...MESSAGE, from: 'hello@avery-bakery.example' })).toEqual({
      outcome: 'opened',
      requestId: 'ticket-new',
    })
    expect(mockOpen.mock.calls[0][1]).toMatchObject({ orgId: 'org-care', requester: { uid: 'u-owner' } })
    expect(await file({ ...MESSAGE, from: 'typed@avery-bakery.example' })).toEqual({
      outcome: 'ignored',
      reason: 'not-a-member',
    })
  })

  it('files nothing when two members of a workspace are the same mailbox, and nothing across domains', async () => {
    member('u-dots-1', 'org-care', 'first.last@gmail.com')
    member('u-dots-2', 'org-care', 'firstlast@googlemail.com')
    expect(await file({ ...MESSAGE, from: 'f.irstlast@gmail.com' })).toEqual({ outcome: 'ignored', reason: 'not-a-member' })
    expect(await file({ ...MESSAGE, from: 'owner@example.org' })).toEqual({ outcome: 'ignored', reason: 'not-a-member' })
    expect(mockOpen).not.toHaveBeenCalled()
  })

  it('joins a reply from a member’s tagged address to the request', async () => {
    const reply = {
      ...MESSAGE,
      from: 'owner+site@example.com',
      to: ['support+AbCdEf0123456789XyZw@in.aglyn.com'],
      text: 'One more thing.',
    }
    expect(await file(reply)).toEqual({ outcome: 'replied', requestId: 'AbCdEf0123456789XyZw' })
    expect(mockAppend.mock.calls[0][1]).toMatchObject({ from: { uid: 'u-owner', email: 'owner+site@example.com' } })
  })

  it('files a member of several Site Care workspaces on the first by id, with every candidate recorded', async () => {
    member('u-owner', 'org-a-care')
    buySiteCare('org-a-care')
    expect(await file(MESSAGE)).toEqual({ outcome: 'opened', requestId: 'ticket-new' })
    expect(mockOpen.mock.calls[0][1]).toMatchObject({
      orgId: 'org-a-care',
      candidates: [
        { orgId: 'org-a-care', name: 'org-a-care', uid: 'u-owner' },
        { orgId: 'org-care', name: 'org-care', uid: 'u-owner' },
      ],
    })
  })

  it('records the one workspace of a sender in only one, which keeps nothing for staff', async () => {
    await file(MESSAGE)
    expect(mockOpen.mock.calls[0][1].candidates).toEqual([{ orgId: 'org-care', name: 'org-care', uid: 'u-owner' }])
  })

  it('files nothing for a member’s message with no words and no subject', async () => {
    expect(await file({ ...MESSAGE, subject: '', text: '', html: '' })).toEqual({ outcome: 'ignored', reason: 'empty' })
    expect(mockOpen).not.toHaveBeenCalled()
  })
})
