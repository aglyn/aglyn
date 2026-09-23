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

/**
 * The sign-up write, end to end (AGL-3289): the REAL route handler against a
 * REAL Firestore, with REAL tokens minted by the Auth emulator. No mocks on
 * the code under test.
 *
 * What it holds: the door writes where the account came from ONCE; a second
 * call — a retry, another tab, a returning Google account — never restates
 * it; the request's own cookie is the fallback when the page could not read
 * the record; and an address with an invitation waiting is the invite door.
 * The writer's creation window and the workspace's copy are held beside the
 * writer, in `account-acquisition.emulator.spec.ts`: reaching that library
 * from here through a deferred import would make nx treat it as lazy-loaded
 * across the whole console.
 *
 * Skipped unless both emulator hosts are set, so an ordinary `jest` run is
 * unaffected and this can never reach production. Main Gate does not run
 * `*.emulator.spec.ts`; `npm run test:emulator-guards` does, or by hand:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8082 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     npx jest -c apps/console/jest.config.ts --testPathPatterns 'auth/acquisition/route\.emulator'
 */

import { request as httpRequest } from 'node:http'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED =
  Boolean(process.env.FIRESTORE_EMULATOR_HOST) &&
  Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST)

// Initialised WITHOUT a credential, before the route is imported, so the
// Admin SDK the route reaches finds this app and talks only to the emulators.
if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip
const PASSWORD = 'E2e-Password-1'
const RUN = Date.now().toString(36)

/** The 2026-09-23 sign-up this was built for, as the capture keeps it. */
const touch = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  at: Date.now() - 5 * 60_000,
  host: 'example.com',
  path: '/pricing',
  ref: 'www.g2.com',
  ...overrides,
})

describeEmulated('the sign-up acquisition write (emulator)', () => {
  let db: Firestore
  let POST: (request: Request) => Promise<Response>

  beforeAll(async () => {
    db = getFirestore()
    POST = (await import('./route')).POST as typeof POST
  }, 60_000)

  async function signUp(label: string): Promise<{ uid: string; email: string; token: string }> {
    const email = `acq-${label}-${RUN}@aglyn.test`
    const user = await getAuth().createUser({ email, password: PASSWORD })
    return { uid: user.uid, email, token: await mintIdToken(email) }
  }

  function call(token: string, body: unknown, headers: Record<string, string> = {}) {
    return POST(
      new Request('https://app.example.com/api/auth/acquisition', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-vercel-ip-country': 'AU',
          'x-vercel-ip-country-region': 'NSW',
          'x-vercel-ip-city': 'Sydney',
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    )
  }

  async function stored(uid: string) {
    return (await db.collection('users').doc(uid).get()).get('acquisition')
  }

  it('records where the account came from, once, with what only the server knows', async () => {
    const account = await signUp('first')
    const response = await call(account.token, { touch: touch() })
    expect(await response.json()).toEqual({ status: 'recorded' })
    expect(await stored(account.uid)).toMatchObject({
      source: 'g2.com',
      medium: 'referral',
      channel: 'referral',
      landing: { host: 'example.com', path: '/pricing' },
      referrerHost: 'www.g2.com',
      door: 'signup-password',
      provider: 'password',
      geo: { country: 'AU', region: 'NSW', city: 'Sydney' },
      recordedBy: 'signup',
    })
    expect(typeof (await stored(account.uid)).accountCreatedAt).toBe('number')
  }, 60_000)

  it('never restates it — a second call, with another touch, writes nothing', async () => {
    const account = await signUp('twice')
    await call(account.token, { touch: touch() })
    const first = await stored(account.uid)
    const again = await call(account.token, { touch: touch({ ref: 'www.google.com', at: Date.now() - 60_000 }) })
    expect(await again.json()).toEqual({ status: 'exists' })
    expect(await stored(account.uid)).toEqual(first)
  }, 60_000)

  it('falls back to the first-touch cookie the request carries', async () => {
    const account = await signUp('cookie')
    const cookie = `aglyn_ft=${encodeURIComponent(JSON.stringify(touch({ ref: 'news.ycombinator.com' })))}`
    await call(account.token, {}, { cookie })
    expect(await stored(account.uid)).toMatchObject({ referrerHost: 'news.ycombinator.com', channel: 'social' })
  }, 60_000)

  it('records an account with nothing captured as unknown, never as blank', async () => {
    const account = await signUp('nothing')
    await call(account.token, { touch: null })
    expect(await stored(account.uid)).toMatchObject({ source: 'unknown', channel: 'unknown', door: 'signup-password' })
  }, 60_000)

  it('names the invite door when an invitation waits for the address', async () => {
    const email = `acq-invited-${RUN}@aglyn.test`
    const inviting = `acq-inviting-org-${RUN}`
    await db.collection('orgs').doc(inviting).collection('invites').doc('invite-1').set({
      email,
      role: 'editor',
      acceptedAt: null,
    })
    const user = await getAuth().createUser({ email, password: PASSWORD })
    await call(await mintIdToken(email), { touch: touch() })
    expect(await stored(user.uid)).toMatchObject({ door: 'invite', invitedToOrgId: inviting, provider: 'password' })
  }, 60_000)
})

/**
 * An ID token from the Auth emulator, over plain local HTTP — the jest
 * environment's fetch polyfill is not a usable client here.
 */
async function mintIdToken(email: string): Promise<string> {
  const [hostname, port] = String(process.env.FIREBASE_AUTH_EMULATOR_HOST).split(':')
  const payload = JSON.stringify({ email, password: PASSWORD, returnSecureToken: true })
  const body = await new Promise<string>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname,
        port: Number(port),
        path: '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (response) => {
        let chunks = ''
        response.on('data', (chunk) => (chunks += chunk))
        response.on('end', () => resolve(chunks))
      },
    )
    request.on('error', reject)
    request.write(payload)
    request.end()
  })
  const data = JSON.parse(body) as { idToken?: string }
  if (!data.idToken) throw new Error(`Auth emulator sign-in failed: ${body}`)
  return data.idToken
}
