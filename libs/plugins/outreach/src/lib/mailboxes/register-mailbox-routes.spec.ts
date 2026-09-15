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

import {
  resolvePluginApiMatch,
  resolvePluginApiRequestSubject,
} from '@aglyn/aglyn/server'
import {
  providerGrantRevokerFor,
  unregisterProviderGrantRevoker,
} from '@aglyn/tenant-data-admin/server/provider-grant-revokers'
import { createSecretBoxKey, parseSecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { OUTREACH_API_ROUTES } from '../constants/api-routes'
import { OUTREACH_COLLECTIONS } from '../model/outreach.types'
import { GOOGLE_OAUTH_ENDPOINTS } from '../transport/google-oauth'
import { sealMailboxRefreshToken } from './mailbox-credentials'
import type { OutreachMailboxRouteDeps } from './mailbox-routes'
import { mintOutreachOAuthState } from './oauth-state'
import { registerOutreachMailboxRoutes } from './register-mailbox-routes'

/**
 * The mailbox routes are REGISTERED as the console dispatcher needs them
 * (AGL-2978): every path, each with the release subject that lets the gate
 * ask about the right organization, and the grant revoker an org erasure
 * runs before it deletes.
 */

const KEYRING = parseSecretBoxKeyring(Buffer.from(createSecretBoxKey(Buffer.alloc(32, 5)).material).toString('base64'))

let credentials: Array<{ id: string; data: Record<string, unknown> }>
let revoked: string[]

function deps(): OutreachMailboxRouteDeps {
  const firestore = {
    collection: () => ({
      where: (_field: string, _op: string, value: unknown) => ({
        limit: () => ({
          get: async () => {
            const docs = credentials
              .filter((entry) => entry.data['providerAccountId'] === value)
              .map((entry) => ({ id: entry.id, get: (field: string) => entry.data[field] }))
            return { docs, size: docs.length }
          },
        }),
      }),
    }),
  } as unknown as FirebaseFirestore.Firestore
  return {
    firestore: () => firestore,
    gate: {} as OutreachMailboxRouteDeps['gate'],
    readConfig: () => ({ configured: true, config: { clientId: 'cid', clientSecret: 'secret', keyring: KEYRING } }),
    stateSigningConfigured: () => true,
    redirectUri: () => null,
    now: () => 0,
    transport: {
      fetch: (async (url: string, init?: RequestInit) => {
        if (url === GOOGLE_OAUTH_ENDPOINTS.revoke) {
          revoked.push(new URLSearchParams(String(init?.body)).get('token') ?? '')
          return new Response('{}', { status: 200 })
        }
        throw new Error(`unscripted ${url}`)
      }) as typeof fetch,
      sleep: async () => undefined,
    },
    consumeRateLimit: async () => ({ allowed: true }),
    logOrgActivity: async () => undefined,
    confirmAliasesByProvider: async () => ({ ok: true, confirmed: [] }),
  }
}

const stored = (mailboxId: string, orgId: string, account: string, token: string) => ({
  id: mailboxId,
  data: {
    id: mailboxId,
    orgId,
    mailboxId,
    provider: 'google',
    providerAccountId: account,
    connectedByUid: 'uid-rep',
    email: 'avery@rep.example.com',
    scopes: [],
    ...sealMailboxRefreshToken(token, mailboxId, KEYRING),
    createdAtMs: 1,
    updatedAtMs: 1,
  },
})

beforeEach(() => {
  process.env['TOKEN_SIGNING_SECRET'] = 'register-mailbox-routes-spec-secret'
  credentials = []
  revoked = []
  unregisterProviderGrantRevoker(OUTREACH_COLLECTIONS.mailboxCredentials)
  registerOutreachMailboxRoutes(deps())
})

describe('registerOutreachMailboxRoutes (AGL-2978)', () => {
  it('registers every mailbox route under the outreach prefix', () => {
    const paths = [
      OUTREACH_API_ROUTES.mailboxesAvailability,
      OUTREACH_API_ROUTES.mailboxesConnect,
      OUTREACH_API_ROUTES.mailboxesOAuthCallback,
      OUTREACH_API_ROUTES.mailboxesConnectComplete,
      OUTREACH_API_ROUTES.mailboxesSettings,
      OUTREACH_API_ROUTES.mailboxesStatus,
      OUTREACH_API_ROUTES.mailboxesTest,
      OUTREACH_API_ROUTES.mailboxesDisconnect,
    ]
    for (const path of paths) {
      expect(path.startsWith('outreach/mailboxes/')).toBe(true)
      expect(typeof (resolvePluginApiMatch(path)?.route as { web?: unknown })?.web).toBe('function')
    }
  })

  it('names the org an authenticated route’s request carries as its release subject', async () => {
    const request = new Request('https://app.example.com/api/outreach/mailboxes/settings', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'org-1', mailboxId: 'gm_1' }),
    })
    await expect(resolvePluginApiRequestSubject(OUTREACH_API_ROUTES.mailboxesSettings, request)).resolves.toEqual({
      orgId: 'org-1',
    })
  })

  it('names the org and member of a signed state for the tokenless callback, and nobody otherwise', async () => {
    const { state } = mintOutreachOAuthState({ orgId: 'org-1', uid: 'uid-rep', nowMs: Date.now() })
    const callback = (value: string) =>
      new Request(`https://app.example.com/api/outreach/mailboxes/oauth/callback?code=c&state=${encodeURIComponent(value)}`)
    await expect(resolvePluginApiRequestSubject(OUTREACH_API_ROUTES.mailboxesOAuthCallback, callback(state))).resolves.toEqual({
      orgId: 'org-1',
      uid: 'uid-rep',
    })
    await expect(
      resolvePluginApiRequestSubject(OUTREACH_API_ROUTES.mailboxesOAuthCallback, callback(`${state}tampered`)),
    ).resolves.toBeNull()
  })
})

describe('the grant revoker an org erasure runs (AGL-2978)', () => {
  it('revokes an erased org’s grant at Google with its opened refresh token', async () => {
    const revoke = providerGrantRevokerFor(OUTREACH_COLLECTIONS.mailboxCredentials)
    expect(revoke).toBeDefined()
    const credential = stored('gm_a', 'org-erased', 'google-account-1', 'refresh-a')
    credentials = [credential]
    await expect(revoke?.(credential, { erasingOrgId: 'org-erased' })).resolves.toBe('revoked')
    expect(revoked).toEqual(['refresh-a'])
  })

  it('keeps a grant another organization still uses, and ignores the erased org’s own copies', async () => {
    const revoke = providerGrantRevokerFor(OUTREACH_COLLECTIONS.mailboxCredentials)
    const erased = stored('gm_a', 'org-erased', 'shared-account', 'refresh-a')
    const sameOrgTwin = stored('gm_b', 'org-erased', 'shared-account', 'refresh-b')
    const elsewhere = stored('gm_c', 'org-still-here', 'shared-account', 'refresh-c')
    credentials = [erased, sameOrgTwin]
    await expect(revoke?.(erased, { erasingOrgId: 'org-erased' })).resolves.toBe('revoked')
    credentials = [erased, sameOrgTwin, elsewhere]
    await expect(revoke?.(erased, { erasingOrgId: 'org-erased' })).resolves.toBe('kept')
    expect(revoked).toEqual(['refresh-a'])
  })

  it('answers failed for a document that is not a credential', async () => {
    const revoke = providerGrantRevokerFor(OUTREACH_COLLECTIONS.mailboxCredentials)
    await expect(revoke?.({ id: 'x', data: { orgId: 'org-erased' } }, { erasingOrgId: 'org-erased' })).resolves.toBe('failed')
  })
})
