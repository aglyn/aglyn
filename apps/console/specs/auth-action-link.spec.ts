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
  resolveAuthActionOrigin,
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
 * The origin a recovery link is built on (AGL-751).
 *
 * The `oobCode` is redeemable from anywhere, which is what lets AGL-1112 skip
 * the locked Firebase handler — and is exactly why the host in the emailed
 * link must not come from a request header. These endpoints take an address
 * from a stranger and mail a live reset code to it.
 */
describe('resolveAuthActionOrigin', () => {
  const ENV = process.env
  beforeEach(() => {
    process.env = { ...ENV }
    delete process.env.AUTH_ACTION_ALLOWED_ORIGINS
    process.env.NEXT_PUBLIC_CONSOLE_URL = 'https://app.aglyn.com'
    // Default to the strict path; the dev-only case sets its own.
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
  })
  afterEach(() => {
    process.env = ENV
  })

  it('ignores an attacker-supplied origin and uses the console', () => {
    // The whole point. A link on evil.example.com would hand whoever runs it
    // a valid password-reset code for an account they do not own, delivered
    // in a mail genuinely sent by Aglyn.
    expect(resolveAuthActionOrigin('https://evil.example.com')).toBe(
      'https://app.aglyn.com',
    )
  })

  it('ignores a host that merely looks like ours', () => {
    expect(resolveAuthActionOrigin('https://app.aglyn.com.evil.test')).toBe(
      'https://app.aglyn.com',
    )
    expect(resolveAuthActionOrigin('https://notapp.aglyn.com')).toBe(
      'https://app.aglyn.com',
    )
  })

  it('ignores a subdomain of an authorized domain we do not control', () => {
    // `vercel.app` is in the project's Firebase authorized-domain list, so a
    // continueUrl there can pass Firebase's own check. Anyone can deploy to
    // that domain, which is why this cannot be the boundary.
    expect(resolveAuthActionOrigin('https://attacker-site.vercel.app')).toBe(
      'https://app.aglyn.com',
    )
  })

  it('refuses a non-http scheme', () => {
    expect(resolveAuthActionOrigin('javascript:alert(1)')).toBe(
      'https://app.aglyn.com',
    )
    expect(resolveAuthActionOrigin('data:text/html,x')).toBe(
      'https://app.aglyn.com',
    )
  })

  it('falls back rather than failing when there is no origin at all', () => {
    // Fail-safe, not fail-closed: a link on the real console redeems
    // perfectly, so the safe answer is also the working one. Recovery must
    // never break in order to protect itself.
    expect(resolveAuthActionOrigin(undefined)).toBe('https://app.aglyn.com')
    expect(resolveAuthActionOrigin(null)).toBe('https://app.aglyn.com')
    expect(resolveAuthActionOrigin('')).toBe('https://app.aglyn.com')
    expect(resolveAuthActionOrigin('not a url')).toBe('https://app.aglyn.com')
  })

  it('keeps the canonical origin, trailing slash and all', () => {
    expect(resolveAuthActionOrigin('https://app.aglyn.com/')).toBe(
      'https://app.aglyn.com',
    )
  })

  it('honours an explicitly allowlisted preview origin', () => {
    // The operator control: one env var lets a preview deploy test recovery
    // against itself, and removing it is the rollback.
    process.env.AUTH_ACTION_ALLOWED_ORIGINS =
      'https://preview-a.vercel.app, https://staging.aglyn.com'
    expect(resolveAuthActionOrigin('https://preview-a.vercel.app')).toBe(
      'https://preview-a.vercel.app',
    )
    expect(resolveAuthActionOrigin('https://staging.aglyn.com')).toBe(
      'https://staging.aglyn.com',
    )
    expect(resolveAuthActionOrigin('https://preview-b.vercel.app')).toBe(
      'https://app.aglyn.com',
    )
  })

  it('allows localhost in development but never in production', () => {
    expect(resolveAuthActionOrigin('http://localhost:4200')).toBe(
      'https://app.aglyn.com',
    )
    ;(process.env as Record<string, string>).NODE_ENV = 'development'
    expect(resolveAuthActionOrigin('http://localhost:4200')).toBe(
      'http://localhost:4200',
    )
  })

  it('tracks NEXT_PUBLIC_CONSOLE_URL for a self-hosted install', () => {
    process.env.NEXT_PUBLIC_CONSOLE_URL = 'https://console.example.com'
    expect(resolveAuthActionOrigin('https://evil.example.com')).toBe(
      'https://console.example.com',
    )
    expect(resolveAuthActionOrigin('https://console.example.com')).toBe(
      'https://console.example.com',
    )
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
