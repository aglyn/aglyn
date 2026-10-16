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
 * THE SSO DOMAIN RULE REFUSES THE ACCOUNT BEFORE IT EXISTS (AGL-3877).
 *
 * The session mint refuses an `@aglyn.com` account outside its SSO tenant,
 * but by then the account has already been created in the project pool: a
 * second user under the same address, with a "new account" email to match.
 * The account-creation blocking function in `cloud/functions` is the only
 * thing that can stop that, and nothing in the nx workspace imports or tests
 * it, so this spec holds two things:
 *
 *  1. The deployed decision is the tested one: the region in
 *     `cloud/functions/src/sso-domain-policy.ts` is byte-for-byte the region
 *     in the library, whose spec drives every verdict.
 *  2. The wiring: the gate runs first in the creation handler and refuses by
 *     throwing, with the marker the console looks for.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  AuthAppErrorCodes,
  type AuthResultError,
  SSO_DOMAIN_REQUIRED_MARKER,
  normalizeAuthError,
} from '@aglyn/shared-data-enums'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const LIB_POLICY = join(
  REPO_ROOT,
  'libs/tenant/data/admin/src/lib/server/sso-domain-policy.ts',
)
const FUNCTION_POLICY = join(REPO_ROOT, 'cloud/functions/src/sso-domain-policy.ts')
const FUNCTION_INDEX = join(REPO_ROOT, 'cloud/functions/src/index.ts')

const REGION_START = '// #region sso-domain-policy'
const REGION_END = '// #endregion sso-domain-policy'

function region(path: string): string {
  const source = readFileSync(path, 'utf8')
  const from = source.indexOf(REGION_START)
  const to = source.indexOf(REGION_END)
  if (from === -1 || to === -1 || to < from) {
    throw new Error(`${path} has no ${REGION_START} … ${REGION_END} block.`)
  }
  return source.slice(from + REGION_START.length, to)
}

describe('AGL-1993 · the deployed decision is the tested decision', () => {
  it('is byte-for-byte identical in the library and in cloud/functions', () => {
    expect(region(FUNCTION_POLICY)).toBe(region(LIB_POLICY))
  })

  it('carries no import, which is what lets it be copied at all', () => {
    expect(region(LIB_POLICY)).not.toMatch(/^\s*import\s/m)
  })
})

describe('AGL-1993 · the creation handler runs the gate', () => {
  const index = readFileSync(FUNCTION_INDEX, 'utf8')
  const handler = index.slice(index.indexOf('beforeUserCreated('))

  it('calls the gate before the signups lock is consulted', () => {
    const gate = handler.indexOf('refuseSsoDomainCreation(event.data)')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(handler.indexOf('signupsCreationVerdict('))
  })

  it('decides through the shared region and refuses by throwing', () => {
    expect(index).toMatch(/from '\.\/sso-domain-policy'/)
    const gate = index.slice(
      index.indexOf('function refuseSsoDomainCreation('),
      index.indexOf('beforeUserCreated('),
    )
    expect(gate).toContain('ssoDomainCreationRefused(')
    expect(gate).toMatch(/throw new HttpsError\(\s*'permission-denied'/)
    expect(gate).toContain('SSO_DOMAIN_REQUIRED_MARKER')
  })

  it('sends the marker the console reads', () => {
    expect(index).toContain(
      `const SSO_DOMAIN_REQUIRED_MARKER = '${SSO_DOMAIN_REQUIRED_MARKER}'`,
    )
  })
})

describe('AGL-1993 · the console names the refusal', () => {
  it('turns the blocking-function error into the SSO notice', () => {
    const raw = {
      code: 'auth/internal-error',
      name: 'FirebaseError',
      message:
        'Firebase: HTTP Cloud Function returned an error: {"error":{"message":' +
        '"This address has to sign in with single sign-on (SSO). (' +
        SSO_DOMAIN_REQUIRED_MARKER +
        ')","status":"PERMISSION_DENIED"}} (auth/internal-error).',
    }
    const shown = normalizeAuthError(raw as unknown as AuthResultError)
    expect(shown.code).toBe(AuthAppErrorCodes.SSO_DOMAIN_REQUIRED)
    expect(shown.message).not.toContain('Firebase')
  })

  it('leaves every other error as it was', () => {
    const raw = { code: 'auth/internal-error', name: 'FirebaseError', message: 'x' }
    expect(normalizeAuthError(raw as unknown as AuthResultError)).toBe(raw)
  })
})
