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

/**
 * AGL-4225 — a code and a refresh token are single use UNDER CONCURRENCY.
 *
 * The serial half is `connector-oauth-store.spec.ts`, against a double. This
 * is the half a double cannot prove: the guarantee comes from Firestore
 * transactions being serializable, and each exchange transaction both reads
 * and WRITES the code (or refresh token) it consumes, so two at once contend
 * and exactly one commits. A read-then-write outside the transaction would
 * pass every serial test and let both through here.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator, then:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns connector-oauth-store.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

jest.mock('./organizations', () => ({
  resolveOrgMembership: jest.fn(),
  memberHasOrgPermission: jest.fn(),
}))
jest.mock('./lockdown', () => ({ getLockdownVerdict: jest.fn() }))

import { pkceS256Challenge } from './connector-oauth'
import {
  exchangeConnectorCode,
  mintConnectorCode,
  refreshConnectorTokens,
  registerConnectorClient,
  verifyConnectorAccessToken,
} from './connector-oauth-store'

const describeOrSkip = EMULATED ? describe : describe.skip
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback'
const VERIFIER = 'v'.repeat(43)
const live = async () => 'live' as const

async function approve() {
  const client = await registerConnectorClient({ clientName: 'Claude', redirectUris: [CLAUDE] })
  const code = await mintConnectorCode({
    clientId: client.clientId,
    redirectUri: CLAUDE,
    codeChallenge: pkceS256Challenge(VERIFIER),
    orgId: `org-${Date.now()}`,
    uid: 'user-1',
    email: null,
    scopes: ['contacts:read'],
    resource: null,
  })
  return { client, code }
}

describeOrSkip('connector credentials under concurrency (emulator)', () => {
  it('lets exactly ONE of two simultaneous code exchanges through', async () => {
    const { client, code } = await approve()
    const attempt = () =>
      exchangeConnectorCode(
        { code, clientId: client.clientId, redirectUri: CLAUDE, codeVerifier: VERIFIER },
        { liveness: live },
      )
    const results = await Promise.all([attempt(), attempt()])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({ ok: false, error: 'invalid_grant' }),
    ])
  })

  it('lets at most ONE of two simultaneous refreshes through, and a loser that saw the rotation ends the connection', async () => {
    const { client, code } = await approve()
    const first = await exchangeConnectorCode(
      { code, clientId: client.clientId, redirectUri: CLAUDE, codeVerifier: VERIFIER },
      { liveness: live },
    )
    if (!first.ok) throw new Error(first.description)
    const attempt = () =>
      refreshConnectorTokens(
        { refreshToken: first.tokens.refresh_token, clientId: client.clientId },
        { liveness: live },
      )
    const results = await Promise.all([attempt(), attempt()])
    const winners = results.filter((result) => result.ok)
    expect(winners.length).toBeLessThanOrEqual(1)
    // Whichever lost read a spent token, which is reuse: nothing survives.
    for (const result of winners) {
      if (!result.ok) continue
      expect(await verifyConnectorAccessToken(result.tokens.access_token, { liveness: live })).toBeNull()
    }
  })
})
