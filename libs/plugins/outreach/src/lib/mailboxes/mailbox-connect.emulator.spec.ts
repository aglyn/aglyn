/**
 * @jest-environment node
 *
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
 * A mailbox connect against a real Firestore (AGL-2978).
 *
 * The route spec drives every refusal against an in-memory store; what an
 * in-memory store cannot show is TRANSACTION semantics. Single use is only a
 * property if two consumes racing on one state really cannot both win, and
 * that is Firestore's optimistic concurrency, not a map. So this runs:
 *
 * - two concurrent consumes of one state: exactly one succeeds;
 * - a whole connect through the real routes, the real sealed write and the
 *   real alias store (AGL-2975), with only Google and the session faked;
 * - a disconnect that leaves nothing behind.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start an emulator on ports
 * of your own and point this at it:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> \
 *     npx jest -c libs/plugins/outreach/jest.config.ts \
 *       --testPathPatterns mailbox-connect.emulator
 */

import { createSecretBoxKey, openSecret, parseSecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { confirmMemberEmailAliasesByProvider } from '@aglyn/tenant-data-admin/server/member-email-aliases'
import type { DecodedIdToken } from 'firebase-admin/auth'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { GMAIL_API_BASE } from '../transport/gmail-client'
import { GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE, GOOGLE_OAUTH_ENDPOINTS } from '../transport/google-oauth'
import { parseConnectReturnFragment } from './mailbox-api'
import { refreshTokenSealContext } from './mailbox-credentials'
import { createOutreachMailboxRoutes, type OutreachMailboxRouteDeps } from './mailbox-routes'
import {
  consumeOutreachOAuthState,
  mintOutreachOAuthState,
  OUTREACH_OAUTH_STATES_COLLECTION,
  recordOutreachOAuthState,
} from './oauth-state'

const EMULATED = Boolean(process.env['FIRESTORE_EMULATOR_HOST'])
if (EMULATED && !getApps().length) initializeApp({ projectId: 'aglyn-main' })
const describeEmulated = EMULATED ? describe : describe.skip

const ORG = 'e2e-outreach-connect-org'
const REP = 'e2e-outreach-connect-rep'
const KEYRING = parseSecretBoxKeyring(Buffer.from(createSecretBoxKey(Buffer.alloc(32, 4)).material).toString('base64'))
const REFRESH_TOKEN = '1//e2e-refresh-token'
let consentNonce = ''

const googleFetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input)
  const json = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200 })
  if (url === GOOGLE_OAUTH_ENDPOINTS.token) {
    const form = new URLSearchParams(String(init?.body ?? ''))
    if (form.get('grant_type') === 'refresh_token') return json({ access_token: 'access-2', expires_in: 3600 })
    return json({
      access_token: 'access-1',
      expires_in: 3600,
      refresh_token: REFRESH_TOKEN,
      scope: `openid ${GMAIL_SEND_SCOPE} ${GMAIL_READONLY_SCOPE}`,
      id_token: [
        'h',
        Buffer.from(
          JSON.stringify({
            iss: 'https://accounts.google.com',
            aud: 'e2e-client',
            sub: 'e2e-google-account',
            email: 'avery@rep.example.com',
            email_verified: true,
            nonce: consentNonce,
            exp: Math.floor(Date.now() / 1000) + 600,
          }),
        ).toString('base64url'),
        's',
      ].join('.'),
    })
  }
  if (url === GOOGLE_OAUTH_ENDPOINTS.revoke) return json({})
  if (url === `${GMAIL_API_BASE}/profile`) return json({ emailAddress: 'avery@rep.example.com' })
  if (url === `${GMAIL_API_BASE}/settings/sendAs`) {
    return json({
      sendAs: [
        { sendAsEmail: 'avery@rep.example.com', isPrimary: true, isDefault: true, displayName: 'Avery Rep' },
        { sendAsEmail: 'sales@rep.example.com', verificationStatus: 'accepted', displayName: 'Sales' },
      ],
    })
  }
  throw new Error(`unscripted request to ${url}`)
}) as typeof fetch

describeEmulated('a mailbox connect against Firestore (AGL-2978)', () => {
  let db: Firestore

  const deps = (): OutreachMailboxRouteDeps => ({
    firestore: () => db,
    gate: {
      verifyIdToken: async () =>
        ({ uid: REP, email: 'avery@rep.example.com', email_verified: true }) as unknown as DecodedIdToken,
      resolveOrgPermissions: async (_uid, { orgId }) => ({
        orgId,
        role: 'admin',
        isOwner: true,
        orgWide: true,
        permissions: { 'outreach.use': true },
      }),
      readOrg: async (orgId) => (await db.collection('orgs').doc(orgId).get()).data() ?? null,
      lockdownRefusal: async () => null,
    },
    readConfig: () => ({ configured: true, config: { clientId: 'e2e-client', clientSecret: 'e2e-secret', keyring: KEYRING } }),
    stateSigningConfigured: () => true,
    redirectUri: () => 'https://console.example.com/api/outreach/mailboxes/oauth/callback',
    now: Date.now,
    transport: { fetch: googleFetch, sleep: async () => undefined },
    consumeRateLimit: async () => ({ allowed: true }),
    logOrgActivity: async () => undefined,
    confirmAliasesByProvider: confirmMemberEmailAliasesByProvider,
  })

  const post = (path: string, body: unknown) =>
    new Request(`https://console.example.com/api/${path}`, {
      method: 'POST',
      headers: { authorization: 'Bearer e2e', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  async function cleanUp() {
    await db.recursiveDelete(db.collection('orgs').doc(ORG))
    for (const collection of [OUTREACH_OAUTH_STATES_COLLECTION, 'outreachMailboxCredentials']) {
      const rows = await db.collection(collection).where('orgId', '==', ORG).get()
      await Promise.all(rows.docs.map((doc) => doc.ref.delete()))
    }
  }

  beforeAll(async () => {
    process.env['TOKEN_SIGNING_SECRET'] = 'outreach-connect-emulator-secret'
    db = getFirestore()
    await cleanUp()
    await db.collection('orgs').doc(ORG).set({ slug: 'e2e-outreach', entitlements: { features: { outreach: true } } })
    await db.collection('orgs').doc(ORG).collection('members').doc(REP).set({ role: 'admin', email: 'avery@rep.example.com' })
    await db
      .collection('orgs')
      .doc(ORG)
      .collection('memberEmailAliases')
      .doc(REP)
      .set({ uid: REP, aliases: [{ address: 'sales@rep.example.com', addedAtMs: 1 }], updatedAtMs: 1 })
  }, 60_000)

  afterAll(async () => {
    if (EMULATED) await cleanUp()
  }, 60_000)

  it('lets exactly one of two racing consumes of a state win', async () => {
    const nowMs = Date.now()
    const { claims } = mintOutreachOAuthState({ orgId: ORG, uid: REP, nowMs })
    await recordOutreachOAuthState(db, { claims, redirectUri: 'https://console.example.com/cb', nowMs })
    const outcomes = await Promise.all([
      consumeOutreachOAuthState(db, { claims, nowMs }),
      consumeOutreachOAuthState(db, { claims, nowMs }),
    ])
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([{ ok: false, refusal: 'state-replayed' }])
  }, 60_000)

  it('connects, seals, confirms the member’s pending alias, and disconnects to nothing', async () => {
    const routes = createOutreachMailboxRoutes(deps())
    const connected = await routes.connect(post('outreach/mailboxes/connect', { orgId: ORG }), { params: {} })
    const url = new URL(((await connected.json()) as { url: string }).url)
    consentNonce = url.searchParams.get('nonce') ?? ''
    const back = await routes.oauthCallback(
      new Request(`https://console.example.com/api/outreach/mailboxes/oauth/callback?code=e2e-code&state=${encodeURIComponent(url.searchParams.get('state') ?? '')}`),
      { params: {} },
    )
    const fragment = parseConnectReturnFragment((back.headers.get('location') ?? '').split('#')[1])
    if (!fragment || fragment.kind !== 'code') throw new Error('the callback returned no code')

    const done = await routes.connectComplete(
      post('outreach/mailboxes/connect/complete', { orgId: ORG, code: fragment.code, state: fragment.state, timezone: 'UTC' }),
      { params: {} },
    )
    expect(done.status).toBe(200)
    const { mailbox, confirmedAliases } = (await done.json()) as { mailbox: { id: string }; confirmedAliases: string[] }
    expect(confirmedAliases).toEqual(['sales@rep.example.com'])

    const stored = await db.collection('orgs').doc(ORG).collection('outreachMailboxes').doc(mailbox.id).get()
    expect(stored.get('status')).toBe('connected')
    const credential = await db.collection('outreachMailboxCredentials').doc(mailbox.id).get()
    expect(credential.get('orgId')).toBe(ORG)
    expect(JSON.stringify(credential.data())).not.toContain(REFRESH_TOKEN)
    expect(
      openSecret(String(credential.get('sealedRefreshToken')), KEYRING, { context: refreshTokenSealContext(mailbox.id) }).plaintext,
    ).toBe(REFRESH_TOKEN)
    const aliases = await db.collection('orgs').doc(ORG).collection('memberEmailAliases').doc(REP).get()
    expect(aliases.get('aliases')[0].verifiedAtMs).toEqual(expect.any(Number))
    const pending = await db.collection(OUTREACH_OAUTH_STATES_COLLECTION).where('orgId', '==', ORG).get()
    expect(pending.size).toBe(0)

    const disconnected = await routes.disconnect(
      post('outreach/mailboxes/disconnect', { orgId: ORG, mailboxId: mailbox.id }),
      { params: {} },
    )
    expect(await disconnected.json()).toEqual({ ok: true, revocation: 'revoked' })
    expect((await db.collection('outreachMailboxCredentials').doc(mailbox.id).get()).exists).toBe(false)
    expect((await db.collection('orgs').doc(ORG).collection('outreachMailboxes').doc(mailbox.id).get()).exists).toBe(false)
  }, 60_000)
})
