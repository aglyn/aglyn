/**
 * @jest-environment node
 */
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

import { asFirestore, memoryFirestore } from '../testing/memory-firestore'
import {
  ACCOUNTING_OAUTH_STATE_TTL_MS,
  consumeAccountingOAuthState,
  mintAccountingOAuthState,
  readAccountingOAuthState,
  recordAccountingOAuthState,
} from './oauth-state'

const NOW = Date.UTC(2026, 9, 6, 12)

describe('the accounting OAuth state', () => {
  const saved = process.env['TOKEN_SIGNING_SECRET']
  beforeEach(() => {
    process.env['TOKEN_SIGNING_SECRET'] = 'test-signing-secret'
  })
  afterAll(() => {
    if (saved === undefined) delete process.env['TOKEN_SIGNING_SECRET']
    else process.env['TOKEN_SIGNING_SECRET'] = saved
  })

  it('verifies a state it minted and reads back the org, member and provider', () => {
    const { state } = mintAccountingOAuthState({ orgId: 'org-1', uid: 'u-1', provider: 'xero', nowMs: NOW })
    expect(readAccountingOAuthState(state, NOW + 1000)).toMatchObject({
      ok: true,
      claims: { orgId: 'org-1', uid: 'u-1', provider: 'xero' },
    })
  })

  it('refuses a tampered state, another version, and one signed under another secret', () => {
    const { state } = mintAccountingOAuthState({ orgId: 'org-1', uid: 'u-1', provider: 'quickbooks', nowMs: NOW })
    const [version, payload, signature] = state.split('.')
    const forged = Buffer.from(JSON.stringify({ o: 'org-2', u: 'u-1', n: 'x', e: NOW + 1e6, p: 'quickbooks' })).toString('base64url')
    expect(readAccountingOAuthState(`${version}.${forged}.${signature}`, NOW)).toEqual({ ok: false, refusal: 'state-invalid' })
    expect(readAccountingOAuthState(`os1.${payload}.${signature}`, NOW)).toEqual({ ok: false, refusal: 'state-invalid' })
    process.env['TOKEN_SIGNING_SECRET'] = 'another-secret'
    expect(readAccountingOAuthState(state, NOW)).toEqual({ ok: false, refusal: 'state-invalid' })
    delete process.env['TOKEN_SIGNING_SECRET']
    expect(readAccountingOAuthState(state, NOW)).toEqual({ ok: false, refusal: 'state-invalid' })
  })

  it('reads an expired state as expired, still naming whose it was', () => {
    const { state } = mintAccountingOAuthState({ orgId: 'org-1', uid: 'u-1', provider: 'xero', nowMs: NOW })
    expect(readAccountingOAuthState(state, NOW + ACCOUNTING_OAUTH_STATE_TTL_MS + 1)).toMatchObject({
      ok: false,
      refusal: 'state-expired',
      claims: { orgId: 'org-1' },
    })
  })

  it('is consumed once, and a newer connect retires an older state', async () => {
    const store = memoryFirestore()
    const firestore = asFirestore(store)
    const first = mintAccountingOAuthState({ orgId: 'org-1', uid: 'u-1', provider: 'xero', nowMs: NOW })
    await recordAccountingOAuthState(firestore, { claims: first.claims, redirectUri: 'https://x/cb', nowMs: NOW })
    const second = mintAccountingOAuthState({ orgId: 'org-1', uid: 'u-1', provider: 'xero', nowMs: NOW + 10 })
    await recordAccountingOAuthState(firestore, { claims: second.claims, redirectUri: 'https://x/cb', nowMs: NOW + 10 })

    await expect(consumeAccountingOAuthState(firestore, { claims: first.claims, nowMs: NOW + 20 })).resolves.toEqual({
      ok: false,
      refusal: 'state-superseded',
    })
    await expect(consumeAccountingOAuthState(firestore, { claims: second.claims, nowMs: NOW + 20 })).resolves.toEqual({
      ok: true,
      redirectUri: 'https://x/cb',
    })
    await expect(consumeAccountingOAuthState(firestore, { claims: second.claims, nowMs: NOW + 30 })).resolves.toEqual({
      ok: false,
      refusal: 'state-replayed',
    })
  })
})
