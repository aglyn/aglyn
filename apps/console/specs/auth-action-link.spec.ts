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

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  authActionUrl,
  oobCodeFromLink,
} from '../app/api/_lib/auth-action-url'

/** A real Firebase-generated link, with the code replaced. */
const FIREBASE_LINK =
  'https://aglyn-main.firebaseapp.com/__/auth/action' +
  '?mode=resetPassword&oobCode=ABC-code_123&apiKey=AIzaSyFake' +
  '&continueUrl=https%3A%2F%2Fapp.aglyn.com%2Fsignin&lang=en'

describe('oobCodeFromLink', () => {
  it('pulls the code out of a Firebase action link', () => {
    expect(oobCodeFromLink(FIREBASE_LINK)).toBe('ABC-code_123')
  })

  it('returns empty rather than throwing on anything unexpected', () => {
    // The caller treats empty as fatal and refuses to send. A throw here
    // would be caught by a route-level handler and reported as a generic
    // failure, losing which part broke.
    expect(oobCodeFromLink('not a url')).toBe('')
    expect(oobCodeFromLink('')).toBe('')
    expect(
      oobCodeFromLink('https://aglyn-main.firebaseapp.com/__/auth/action'),
    ).toBe('')
  })
})

describe('authActionUrl', () => {
  it('points a reset at the console, not at firebaseapp.com', () => {
    // The whole reason this module exists: the Firebase action URL is a
    // console setting we are locked out of, and the oobCode is not bound to
    // the page that redeems it.
    const url = new URL(
      authActionUrl('https://app.aglyn.com', 'resetPassword', 'ABC-code_123'),
    )
    expect(url.origin).toBe('https://app.aglyn.com')
    expect(url.pathname).toBe('/reset-password')
    expect(url.searchParams.get('oobCode')).toBe('ABC-code_123')
    expect(url.searchParams.get('mode')).toBe('resetPassword')
  })

  it('points a verification at the verify page', () => {
    const url = new URL(
      authActionUrl('https://app.aglyn.com', 'verifyEmail', 'xyz'),
    )
    expect(url.pathname).toBe('/verify-email')
    expect(url.searchParams.get('mode')).toBe('verifyEmail')
  })

  it('round-trips a real link without losing the code', () => {
    // The two halves are only ever used together, so the property that
    // matters is the composition, not either one alone.
    const rebuilt = authActionUrl(
      'https://app.aglyn.com',
      'resetPassword',
      oobCodeFromLink(FIREBASE_LINK),
    )
    expect(new URL(rebuilt).searchParams.get('oobCode')).toBe('ABC-code_123')
    expect(rebuilt).not.toContain('firebaseapp.com')
  })

  it('escapes a code containing URL-significant characters', () => {
    // Firebase codes are base64url today, but building the URL by string
    // concatenation would silently truncate at the first `&` if that ever
    // changed. `URLSearchParams` is doing real work here.
    const rebuilt = authActionUrl('https://app.aglyn.com', 'verifyEmail', 'a&b=c')
    expect(new URL(rebuilt).searchParams.get('oobCode')).toBe('a&b=c')
  })

  it('honours a non-production origin', () => {
    // Preview deploys and localhost both have to get a link that comes back
    // to themselves, or testing the flow is impossible anywhere but prod.
    expect(
      authActionUrl('http://localhost:4200', 'resetPassword', 'x'),
    ).toContain('http://localhost:4200/reset-password')
  })
})

/**
 * The claim of AGL-1112, asserted against the source rather than the catalog:
 * nothing asks Firebase Auth to send an email any more.
 */
function* sourceFiles(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.tsx?$/.test(path) && !path.endsWith('.spec.ts')) yield path
  }
}

describe('no client-SDK auth email sends', () => {
  it('never calls sendPasswordResetEmail or sendEmailVerification', () => {
    // These are the two calls that hand composition back to Firebase. Both
    // compile, both look correct, and both silently reintroduce a template
    // nobody can edit and a link on the wrong domain.
    const offenders: string[] = []
    for (const root of ['app', 'components', 'hooks', 'utils']) {
      for (const file of sourceFiles(join(__dirname, '..', root))) {
        const source = readFileSync(file, 'utf8')
        for (const call of ['sendPasswordResetEmail', 'sendEmailVerification']) {
          // The call, not the word — the comments explaining why they are
          // gone mention them by name.
          if (new RegExp(`\\b${call}\\s*\\(`).test(source)) {
            offenders.push(`${file.split('/apps/')[1]} → ${call}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
