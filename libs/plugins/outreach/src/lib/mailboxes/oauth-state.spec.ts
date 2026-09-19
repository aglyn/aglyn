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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  mintOutreachOAuthState,
  OUTREACH_OAUTH_STATE_TTL_MS,
  OUTREACH_OAUTH_STATES_COLLECTION,
  outreachOAuthStateDocId,
  outreachOAuthStateRef,
  outreachOidcNonce,
  outreachPkceVerifier,
  readOutreachOAuthState,
  recordOutreachOAuthState,
} from './oauth-state'

/**
 * The OAuth state's signature (AGL-2978): what verifies, what does not, and
 * what an expired state still says about itself. Consumption — the
 * single-use half — runs against real transactions in
 * `mailbox-connect.emulator.spec.ts` and through the routes in
 * `mailbox-routes.spec.ts`.
 */

const NOW = Date.UTC(2026, 8, 14, 18, 0, 0)
const SECRET = 'outreach-oauth-state-spec-secret'

beforeEach(() => {
  process.env['TOKEN_SIGNING_SECRET'] = SECRET
})

afterAll(() => {
  delete process.env['TOKEN_SIGNING_SECRET']
})

describe('the OAuth state signature (AGL-2978)', () => {
  it('verifies what it minted, naming the org, member, nonce and expiry', () => {
    const { state, claims } = mintOutreachOAuthState({ orgId: 'org-1', uid: 'uid-1', nowMs: NOW, nonce: 'n-1' })
    expect(claims).toEqual({ orgId: 'org-1', uid: 'uid-1', nonce: 'n-1', exp: NOW + OUTREACH_OAUTH_STATE_TTL_MS })
    expect(state).toMatch(/^os1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(readOutreachOAuthState(state, NOW + 1)).toEqual({ ok: true, claims })
  })

  it('gives every connect a fresh random nonce', () => {
    const first = mintOutreachOAuthState({ orgId: 'org-1', uid: 'uid-1', nowMs: NOW })
    const second = mintOutreachOAuthState({ orgId: 'org-1', uid: 'uid-1', nowMs: NOW })
    expect(first.claims.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.claims.nonce).not.toBe(second.claims.nonce)
  })

  it('refuses a tampered payload, a tampered signature, another version and junk', () => {
    const { state } = mintOutreachOAuthState({ orgId: 'org-1', uid: 'uid-1', nowMs: NOW })
    const [version, payload, signature] = state.split('.')
    const otherMember = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')), u: 'uid-2' }),
    ).toString('base64url')
    const invalid = { ok: false, refusal: 'state-invalid' }
    expect(readOutreachOAuthState(`${version}.${otherMember}.${signature}`, NOW)).toEqual(invalid)
    const lastChanged = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`
    expect(readOutreachOAuthState(`${version}.${payload}.${lastChanged}`, NOW)).toEqual(invalid)
    expect(readOutreachOAuthState(`os2.${payload}.${signature}`, NOW)).toEqual(invalid)
    for (const junk of ['', 'os1', 'os1.a.b.c', null, 42, 'x'.repeat(2000)]) {
      expect(readOutreachOAuthState(junk, NOW)).toEqual(invalid)
    }
  })

  it('refuses a state signed under another secret — a different deployment, or a rotated one', () => {
    const { state } = mintOutreachOAuthState({ orgId: 'org-1', uid: 'uid-1', nowMs: NOW })
    process.env['TOKEN_SIGNING_SECRET'] = 'a-different-secret'
    expect(readOutreachOAuthState(state, NOW)).toEqual({ ok: false, refusal: 'state-invalid' })
  })

  it('proves nothing, and throws on minting, with no signing secret', () => {
    const { state } = mintOutreachOAuthState({ orgId: 'org-1', uid: 'uid-1', nowMs: NOW })
    delete process.env['TOKEN_SIGNING_SECRET']
    expect(readOutreachOAuthState(state, NOW)).toEqual({ ok: false, refusal: 'state-invalid' })
    expect(() => mintOutreachOAuthState({ orgId: 'org-1', uid: 'uid-1', nowMs: NOW })).toThrow(/TOKEN_SIGNING_SECRET/)
  })

  it('reports an authentic expired state as expired, still saying whose it was', () => {
    const { state, claims } = mintOutreachOAuthState({ orgId: 'org-1', uid: 'uid-1', nowMs: NOW })
    expect(readOutreachOAuthState(state, NOW + OUTREACH_OAUTH_STATE_TTL_MS)).toEqual({
      ok: false,
      refusal: 'state-expired',
      claims,
    })
  })
})

describe('what the state derives (AGL-2978)', () => {
  it('derives a PKCE verifier and an OpenID nonce that differ from each other and per nonce', () => {
    const verifier = outreachPkceVerifier('n-1')
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(outreachPkceVerifier('n-1')).toBe(verifier)
    expect(outreachPkceVerifier('n-2')).not.toBe(verifier)
    expect(outreachOidcNonce('n-1')).not.toBe(verifier)
    expect(verifier).not.toContain('n-1')
  })

  it('keys the pending record by org and member, never by either alone', () => {
    const id = outreachOAuthStateDocId('org-1', 'uid-1')
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(outreachOAuthStateDocId('org-1', 'uid-2')).not.toBe(id)
    expect(outreachOAuthStateDocId('org-2', 'uid-1')).not.toBe(id)
    // The separator keeps ('ab', 'c') and ('a', 'bc') apart.
    expect(outreachOAuthStateDocId('ab', 'c')).not.toBe(outreachOAuthStateDocId('a', 'bc'))
  })
})

describe('the pending record lives under its organization (AGL-2978)', () => {
  const REPO_ROOT = join(__dirname, '../../../../../..')
  const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')

  it('is written to and consumed from orgs/{orgId}/outreachOAuthStates', async () => {
    const written: string[] = []
    const ref = (path: string): any => ({
      path,
      collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
      set: async () => void written.push(path),
    })
    const firestore = { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }) } as never
    const { claims } = mintOutreachOAuthState({ orgId: 'org-1', uid: 'uid-1', nowMs: 1 })
    await recordOutreachOAuthState(firestore, { claims, redirectUri: 'https://console.example.com/cb', nowMs: 1 })
    expect(written).toEqual([
      `orgs/org-1/${OUTREACH_OAUTH_STATES_COLLECTION}/${outreachOAuthStateDocId('org-1', 'uid-1')}`,
    ])
    expect(outreachOAuthStateRef(firestore, 'org-1', 'uid-1').path).toBe(written[0])
  })

  it('is named by no Firestore rule, so the org block’s default deny closes it to every client', () => {
    // The org block has no catch-all (`cloud/rules-outreach.spec.mjs` proves
    // the refusal against the emulator); a rule naming the collection is the
    // one way a client could reach a pending record.
    expect(read('cloud/firebase-firestore.rules')).not.toContain(OUTREACH_OAUTH_STATES_COLLECTION)
  })

  it('is named by no core library: the org erasure and export reach it through the org tree', () => {
    for (const path of [
      'libs/tenant/data/admin/src/lib/server/erase.ts',
      'libs/tenant/data/admin/src/lib/server/personal-data-export.ts',
    ]) {
      expect([path, read(path).includes(OUTREACH_OAUTH_STATES_COLLECTION)]).toEqual([path, false])
    }
  })
})
