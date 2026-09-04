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
 * AN UNVERIFIED ACCOUNT CANNOT REACH A SEND (AGL-479/2589).
 *
 * The property this file holds is not "the send route refuses an unverified
 * caller" — that was already true before AGL-2589, and it was true for the
 * wrong reason. The role lookup on the host document refused them, because
 * nothing can enter a `memberRoles` map without having verified. That is a
 * fact about how accounts are PROVISIONED, and it had already moved once:
 * signup now creates an org for an account that has not verified yet
 * (AGL-2585). A comparable grace on host creation would have opened the
 * campaign send surface with no second line of defense, on a `p=reject`
 * sending domain, and no test anywhere would have gone red.
 *
 * So the fixture below IS that future grace, arranged deliberately: the
 * unverified caller is seeded as an `admin` in the host's `memberRoles` map.
 * Under the old code every assertion here would have sent mail. The refusal
 * asserted is the verification one specifically — `reason: 'email-unverified'`
 * rather than the role message — because a test that accepted either sentence
 * would pass again the day the grace arrives.
 *
 * The positive controls run the other way: a VERIFIED stranger reaches the
 * role gate and is refused by it, which proves the new check is a gate on the
 * address rather than a blanket deny, and a staff impersonation session
 * reaches the same place, which pins the AGL-480 carve-out the other ~135
 * gates already make.
 */

/** What `verifyIdToken` answers with; each case sets it. */
let decodedToken: Record<string, unknown> = {}
/** Every message the send path handed to the mailer. Must stay empty. */
const sent: Array<Record<string, unknown>> = []
/** How many times the handler reached Firestore — the gate runs before it. */
let firestoreReads = 0

const HOST = 'host-1'
const MEMBER = 'uid-member'
const STRANGER = 'uid-stranger'
const STAFF = 'uid-staff'

const store = new Map<string, Record<string, unknown>>()

function docRef(path: string): unknown {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => {
      const data = store.get(path)
      return {
        exists: data !== undefined,
        id: path.split('/').pop() as string,
        data: () => data,
        get: (field: string) => data?.[field],
      }
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): unknown {
  return { doc: (id: string) => docRef(`${path}/${id}`) }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => decodedToken }),
      firestore: () => {
        firestoreReads += 1
        return { collection: (name: string) => collectionRef(name) }
      },
    }),
    firestore: {
      FieldValue: {
        increment: (value: number) => ({ increment: value }),
        serverTimestamp: () => 'server-timestamp',
        delete: () => ({ __delete: true }),
      },
      FieldPath: { documentId: () => '__name__' },
    },
  },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  /*
   * Recorded rather than stubbed to a no-op. "No mail left the building" is
   * an assertion about a call NOT happening, and a silent double would let
   * the opposite pass.
   */
  sendEmail: async (message: Record<string, unknown>) => {
    sent.push(message)
    return { sent: true }
  },
}))

import type { PluginApiResponse } from '@aglyn/aglyn/server'
import { campaignSendHandler } from './campaign-send'

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader() {
      // unused
    },
    redirect() {
      // unused
    },
    end() {
      // unused
    },
  }
  return { res, result }
}

async function post(body: Record<string, unknown>) {
  const { res, result } = makeResponse()
  await campaignSendHandler(
    {
      method: 'POST',
      query: {},
      body: { hostId: HOST, subject: 'Spring sale', body: 'Ends Sunday', ...body },
      cookies: {},
      headers: { authorization: 'Bearer token' },
    } as any,
    res,
  )
  return result
}

beforeEach(() => {
  sent.length = 0
  firestoreReads = 0
  store.clear()
  /*
   * THE GRACE EXCEPTION, ARRANGED. The unverified account is a full `admin`
   * on this site — the state that does not exist today and that this file
   * exists to keep harmless if it ever does.
   */
  store.set(`hosts/${HOST}`, {
    subdomain: 'acme',
    memberRoles: { [MEMBER]: 'admin', [STRANGER]: undefined },
  })
  decodedToken = { uid: MEMBER, email: 'owner@acme.test', email_verified: false }
})

describe('an unverified account cannot reach a send (AGL-2589)', () => {
  it('refuses a broadcast, naming verification rather than the role', async () => {
    const result = await post({ audience: 'leads' })
    expect(result.status).toBe(403)
    expect(result.body?.reason).toBe('email-unverified')
    expect(sent).toHaveLength(0)
  })

  it('refuses a TEST send, which is the same door with a smaller audience', async () => {
    const result = await post({ action: 'test', to: 'owner@acme.test' })
    expect(result.status).toBe(403)
    expect(result.body?.reason).toBe('email-unverified')
    expect(sent).toHaveLength(0)
  })

  it('refuses a SCHEDULED send, so nothing is queued for a cron to run', async () => {
    // The scheduled branch writes a campaign document and hands it to the
    // processor later, which does no authorization of its own — the caller
    // owns that, and the caller is this handler.
    const result = await post({
      audience: 'leads',
      sendAtMs: Date.now() + 3_600_000,
    })
    expect(result.status).toBe(403)
    expect(result.body?.reason).toBe('email-unverified')
    expect(sent).toHaveLength(0)
  })

  it('refuses before it reads the site, so the gate costs no document', async () => {
    await post({ audience: 'leads' })
    expect(firestoreReads).toBe(0)
  })

  it('is refused by the ADDRESS, not by the missing role', async () => {
    /*
     * The distinguishing assertion, and the reason the two 403s are told
     * apart above. A verified stranger gets the role sentence; an unverified
     * admin gets the verification one. If a future change deleted the
     * verification check, this pair would keep passing for the stranger and
     * go red for the admin, which is the direction that matters.
     */
    decodedToken = {
      uid: STRANGER,
      email: 'nobody@example.test',
      email_verified: true,
    }
    const result = await post({ audience: 'leads' })
    expect(result.status).toBe(403)
    expect(result.body?.reason).toBeUndefined()
    expect(result.body?.error).toBe('Not a site admin or editor')
    // Reaching the role gate means the verification gate let it through.
    expect(firestoreReads).toBeGreaterThan(0)
  })

  it('exempts a staff impersonation session, exactly as its ~135 siblings do', async () => {
    // AGL-480: staff have authenticated separately, the act is audited, and
    // the account most likely to need support is the newest — which is
    // precisely the one that has not verified.
    decodedToken = {
      uid: STRANGER,
      email: 'nobody@example.test',
      email_verified: false,
      impersonatedBy: STAFF,
    }
    const result = await post({ audience: 'leads' })
    expect(result.body?.reason).toBeUndefined()
    expect(result.body?.error).toBe('Not a site admin or editor')
    expect(firestoreReads).toBeGreaterThan(0)
  })

  it('treats a MISSING claim as unverified, not as absent-so-fine', async () => {
    // Some custom-token sign-ins carry no `email_verified` at all.
    // `verifyConsoleIdToken` fails closed on that and so does this.
    decodedToken = { uid: MEMBER, email: 'owner@acme.test' }
    const result = await post({ audience: 'leads' })
    expect(result.status).toBe(403)
    expect(result.body?.reason).toBe('email-unverified')
    expect(sent).toHaveLength(0)
  })
})
