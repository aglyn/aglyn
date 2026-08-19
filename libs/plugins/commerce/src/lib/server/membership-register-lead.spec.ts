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
 * A SIGN-UP LEAVES A LEAD SOMEONE CAN WRITE TO BY NAME (AGL-2303).
 *
 * `campaign-send` reads `leads.name` for merge tags. No lead writer wrote one.
 * Here the name was on the request, went onto the member document as
 * `displayName` two lines earlier, and was dropped from the lead — so every
 * campaign to the leads audience resolved `{{name}}` to an empty string in
 * mail that had already been delivered.
 *
 * Asserted against the VALUE from the request. A writer storing a constant, or
 * the email address that is sitting right there, satisfies any "is there a
 * name" check and fails here.
 */

const mockState: {
  members: Array<Record<string, unknown>>
  leads: Array<Record<string, unknown>>
} = { members: [], leads: [] }

jest.mock('@aglyn/tenant-data-admin', () => {
  const membersCollection = {
    where: () => membersCollection,
    limit: () => membersCollection,
    get: async () => ({ empty: true, docs: [] }),
    doc: () => ({
      id: 'member-1',
      set: async (data: Record<string, unknown>) => {
        mockState.members.push(data)
      },
    }),
  }
  const hostRef = {
    get: async () => ({ exists: true }),
    collection: (name: string) =>
      name === 'siteMembers'
        ? membersCollection
        : {
            // Recorded, not discarded. A double whose `add` returns an id and
            // forgets the payload cannot fail on a wrong payload — which is
            // how a lead with no name on it went unnoticed.
            add: async (data: Record<string, unknown>) => {
              if (name === 'leads') mockState.leads.push(data)
              return { id: `${name}-1` }
            },
          },
  }
  return {
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({ collection: () => ({ doc: () => hostRef }) }),
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
    },
    upsertHostContact: () => undefined,
  }
})

jest.mock('@aglyn/tenant-runtime', () => ({
  emitHostEvent: async () => ({ alerts: [] }),
}))

jest.mock('./membership', () => ({
  hashMemberPassword: () => 'scrypt$test',
  mintMemberSession: () => 'session-token',
  setMemberCookie: () => undefined,
}))

import { membershipRegisterHandler } from './membership-register'

function makeRes(): any {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(value: unknown) {
      res.body = value
      return res
    },
    setHeader: () => undefined,
  }
  return res
}

const register = (body: Record<string, unknown>) =>
  membershipRegisterHandler(
    {
      method: 'POST',
      body: {
        hostId: 'host-1',
        email: 'dana@example.com',
        password: 'correct-horse',
        ...body,
      },
      headers: {},
      query: {},
      cookies: {},
    } as any,
    makeRes(),
  )

beforeEach(() => {
  mockState.members = []
  mockState.leads = []
})

describe('the lead a sign-up leaves behind (AGL-2303)', () => {
  it('carries the name the person just typed', async () => {
    await register({ displayName: 'Dana Reed' })
    expect(mockState.leads).toHaveLength(1)
    expect(mockState.leads[0]).toMatchObject({
      email: 'dana@example.com',
      name: 'Dana Reed',
      source: 'signup',
    })
  })

  it('carries THAT sign-up’s name, not a constant', async () => {
    // Two sign-ups, two names. A writer echoing a fixed string, or the email,
    // survives the test above and dies here.
    await register({ displayName: 'Dana Reed' })
    await register({ displayName: 'Sam Okafor', email: 'sam@example.com' })
    expect(mockState.leads.map((lead) => lead['name'])).toEqual([
      'Dana Reed',
      'Sam Okafor',
    ])
  })

  it('omits the field entirely when no display name was given', async () => {
    // `displayName` is optional at sign-up. An empty string is not a name, and
    // storing one would make `collectName` keep the key and resolve it to
    // nothing — a recipient the sender believes is personalized and is not.
    await register({})
    expect(mockState.leads).toHaveLength(1)
    expect('name' in mockState.leads[0]).toBe(false)
    // …and the member document is written the same way, which is the field
    // the members audience now reads.
    expect('displayName' in mockState.members[0]).toBe(false)
  })
})
