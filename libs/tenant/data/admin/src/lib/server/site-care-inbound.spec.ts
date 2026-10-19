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
 * THE SITE CARE ADDRESS (AGL-3959): which received messages are Site Care
 * mail, which request a reply joins, and what a stranger is told.
 */

import { SITE_CARE_UNKNOWN_SENDER_EMAIL_KEY, type ReceivedEmail } from '@aglyn/shared-util-email'
import {
  fileSiteCareInboundEmail,
  findSiteCareAccount,
  siteCareInboundTarget,
  siteCareMessageBody,
} from './site-care-inbound'

const mockFindAcrossPools = jest.fn()
jest.mock('./auth-pools', () => ({
  __esModule: true,
  findUserByEmailAcrossPools: (email: string) => mockFindAcrossPools(email),
}))

jest.mock('./org-billing', () => ({ __esModule: true, readOrgBilling: async () => ({}) }))
jest.mock('./notifications', () => ({ __esModule: true, notifyStaff: async () => undefined }))
jest.mock('./site-care-emails', () => ({
  __esModule: true,
  sendSiteCareEmail: async () => ({ sent: false, to: null, subject: '', reason: 'unconfigured' }),
}))

const DOMAIN = 'in.aglyn.com'

describe('siteCareInboundTarget', () => {
  it('reads care@ as a new request', () => {
    expect(siteCareInboundTarget(['care@in.aglyn.com'], DOMAIN)).toEqual({ kind: 'new' })
    expect(siteCareInboundTarget(['Site Care <CARE@In.Aglyn.com>'], DOMAIN)).toEqual({ kind: 'new' })
  })

  it('reads care+<id>@ as a reply, keeping the id’s case', () => {
    expect(siteCareInboundTarget(['care+AbCdEf0123456789XyZw@in.aglyn.com'], DOMAIN)).toEqual({
      kind: 'reply',
      requestId: 'AbCdEf0123456789XyZw',
    })
    expect(siteCareInboundTarget(['"Aglyn" <care+AbCdEf0123456789XyZw@in.aglyn.com>'], DOMAIN)).toEqual({
      kind: 'reply',
      requestId: 'AbCdEf0123456789XyZw',
    })
  })

  it('prefers a reply over a plain care@ among the recipients', () => {
    expect(
      siteCareInboundTarget(['care@in.aglyn.com', 'care+abcdefghij12@in.aglyn.com'], DOMAIN),
    ).toEqual({ kind: 'reply', requestId: 'abcdefghij12' })
  })

  it('ignores other addresses, other domains and ids of the wrong shape', () => {
    expect(siteCareInboundTarget(['sales@in.aglyn.com'], DOMAIN)).toBeNull()
    expect(siteCareInboundTarget(['care@aglyn.com'], DOMAIN)).toBeNull()
    expect(siteCareInboundTarget(['care+short@in.aglyn.com'], DOMAIN)).toBeNull()
    expect(siteCareInboundTarget(['care+bad/id/abcdefgh@in.aglyn.com'], DOMAIN)).toBeNull()
    expect(siteCareInboundTarget(['not an address'], DOMAIN)).toBeNull()
    expect(siteCareInboundTarget([], DOMAIN)).toBeNull()
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
  const MESSAGE: ReceivedEmail = {
    id: 'msg-1',
    messageId: '<m1@mail>',
    inReplyTo: '',
    from: 'Stranger <stranger@example.com>',
    to: ['care@in.aglyn.com'],
    cc: [],
    bcc: [],
    receivedFor: [],
    subject: 'Change my site',
    text: 'Hello',
    html: '',
  } as ReceivedEmail

  it('answers a sender no Site Care workspace knows, and keeps nothing', async () => {
    const sent: Array<{ key: string; to: string | null }> = []
    const firestore = {
      collection: () => {
        throw new Error('no Firestore read is expected for an unknown sender')
      },
    } as unknown as FirebaseFirestore.Firestore
    const outcome = await fileSiteCareInboundEmail(
      firestore,
      {
        target: { kind: 'new' },
        message: MESSAGE,
        findAccount: async () => null,
      },
      {
        email: async (input) => {
          sent.push({ key: input.key, to: input.to })
          return { sent: true, to: input.to, subject: input.fallback.subject }
        },
      },
    )
    expect(outcome).toEqual({ outcome: 'unknown-sender' })
    expect(sent).toEqual([{ key: SITE_CARE_UNKNOWN_SENDER_EMAIL_KEY, to: 'stranger@example.com' }])
  })
})
