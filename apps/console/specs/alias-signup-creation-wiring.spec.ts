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
 * A NEW ACCOUNT IS NOT CREATED UNDER ANOTHER ACCOUNT'S VERIFIED ADDRESS
 * (AGL-4041).
 *
 * The decision lives in `cloud/functions/src/alias-signup.ts`, which that
 * package's own `node --test` drives. Nothing in the nx workspace imports
 * the function, so this spec holds the parts that join the two:
 * the handler runs the gate, it throws the marker, and the console turns
 * that marker into a sentence a person can act on.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  AuthAppErrorCodes,
  AuthErrorMessage,
  AuthErrorNotice,
  type AuthResultError,
  EMAIL_ON_ANOTHER_ACCOUNT_MARKER,
  normalizeAuthError,
} from '@aglyn/shared-data-enums'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const index = readFileSync(join(REPO_ROOT, 'cloud/functions/src/index.ts'), 'utf8')
const decision = readFileSync(
  join(REPO_ROOT, 'cloud/functions/src/alias-signup.ts'),
  'utf8',
)

describe('AGL-4041 · the creation handler runs the alias gate', () => {
  const handler = index.slice(index.indexOf('beforeUserCreated('))

  it('awaits it before the signups lock is consulted', () => {
    const gate = handler.indexOf('await refuseAliasSignup(event.data)')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(handler.indexOf('signupsCreationVerdict('))
  })

  it('refuses by throwing, with the marker the console reads', () => {
    const gate = index.slice(
      index.indexOf('async function refuseAliasSignup('),
      index.indexOf('beforeUserCreated('),
    )
    expect(gate).toContain('aliasSignupVerdict(')
    expect(gate).toMatch(/throw new HttpsError\(\s*'permission-denied'/)
    expect(gate).toContain('EMAIL_ON_ANOTHER_ACCOUNT_MARKER')
    expect(decision).toContain(
      `export const EMAIL_ON_ANOTHER_ACCOUNT_MARKER = '${EMAIL_ON_ANOTHER_ACCOUNT_MARKER}'`,
    )
  })

  it('reads the same collections the account-emails library writes', () => {
    expect(index).toContain("collection('emailIdentityIndex')")
    expect(index).toMatch(/collection\('users'\)[\s\S]{0,80}collection\('emails'\)/)
  })
})

describe('AGL-4041 · the console names the refusal', () => {
  const raw = {
    code: 'auth/internal-error',
    name: 'FirebaseError',
    message:
      'Firebase: HTTP Cloud Function returned an error: {"error":{"message":' +
      '"This email address is already added to another account, so no new account was created. (' +
      EMAIL_ON_ANOTHER_ACCOUNT_MARKER +
      ')","status":"PERMISSION_DENIED"}} (auth/internal-error).',
  }

  it('turns the blocking-function error into its own notice', () => {
    const shown = normalizeAuthError(raw as unknown as AuthResultError)
    expect(shown.code).toBe(AuthAppErrorCodes.EMAIL_ON_ANOTHER_ACCOUNT)
    expect(shown.message).not.toContain('Firebase')
    expect(AuthErrorNotice[AuthAppErrorCodes.EMAIL_ON_ANOTHER_ACCOUNT]).toBe(true)
    expect(AuthErrorMessage[AuthAppErrorCodes.EMAIL_ON_ANOTHER_ACCOUNT]).toMatch(
      /^No new account was created\. Sign in to the account/,
    )
  })

  it('names no account', () => {
    const shown = normalizeAuthError(raw as unknown as AuthResultError)
    expect(shown.message).not.toMatch(/@/)
  })
})
