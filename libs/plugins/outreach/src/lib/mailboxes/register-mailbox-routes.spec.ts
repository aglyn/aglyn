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
import { createSecretBoxKey, parseSecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { OUTREACH_API_ROUTES } from '../constants/api-routes'
import type { OutreachMailboxRouteDeps } from './mailbox-routes'
import { mintOutreachOAuthState } from './oauth-state'
import { registerOutreachMailboxRoutes } from './register-mailbox-routes'

/**
 * The mailbox routes are REGISTERED as the console dispatcher needs them
 * (AGL-2978): every path, each with the release subject that lets the gate
 * ask about the right organization.
 */

const KEYRING = parseSecretBoxKeyring(Buffer.from(createSecretBoxKey(Buffer.alloc(32, 5)).material).toString('base64'))

function deps(): OutreachMailboxRouteDeps {
  return {
    firestore: () => ({}) as FirebaseFirestore.Firestore,
    gate: {} as OutreachMailboxRouteDeps['gate'],
    readConfig: () => ({ configured: true, config: { clientId: 'cid', clientSecret: 'secret', keyring: KEYRING } }),
    stateSigningConfigured: () => true,
    redirectUri: () => null,
    now: () => 0,
    transport: {
      fetch: (async (url: string) => {
        throw new Error(`unscripted ${url}`)
      }) as typeof fetch,
      sleep: async () => undefined,
    },
    consumeRateLimit: async () => ({ allowed: true }),
    logOrgActivity: async () => undefined,
    confirmAliasesByProvider: async () => ({ ok: true, confirmed: [] }),
  }
}

beforeEach(() => {
  process.env['TOKEN_SIGNING_SECRET'] = 'register-mailbox-routes-spec-secret'
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
