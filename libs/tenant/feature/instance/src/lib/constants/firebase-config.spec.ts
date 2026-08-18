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
 * AGL-1919 — which origin the Google OAuth handshake runs on.
 *
 * The value under test is not cosmetic. `authDomain` is what the Firebase
 * SDK interpolates into `https://<authDomain>/__/auth/handler`, that string
 * becomes the OAuth `redirect_uri`, and Google's account chooser renders the
 * redirect_uri's HOST. So this constant is literally the domain name a
 * customer reads while deciding whether to trust the sign-in — measured:
 * the consent page for the `auth.aglyn.com` redirect_uri contains no
 * `firebaseapp.com` at all, the one for the firebaseapp redirect_uri names
 * `aglyn-main.firebaseapp.com` twelve times.
 *
 * These drive `fbClientAppOptions` — the exported surface the console
 * actually hands `initializeApp` — rather than the internal resolver, so a
 * refactor that resolved correctly but wired the wrong field would still be
 * caught. Each case re-imports under `jest.isolateModules`, because the
 * options object is built once at module scope (deliberately: Next's
 * DefinePlugin substitutes the `process.env` reads at build time).
 */

const ENV_KEYS = [
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_AUTH_HANDLER_HOST',
  'NEXT_PUBLIC_WORKSPACE_DOMAIN',
  'FIREBASE_AUTH_EMULATOR_ENABLED',
] as const

function authDomainWith(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(env)) process.env[key] = value

  let resolved: string | undefined
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    resolved = require('./firebase-config').fbClientAppOptions.authDomain
  })
  return resolved
}

describe('fbClientAppOptions.authDomain', () => {
  const original = { ...process.env }

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key]
    Object.assign(process.env, original)
  })

  it('uses the explicit handler host when one is configured', () => {
    expect(
      authDomainWith({
        NEXT_PUBLIC_FIREBASE_AUTH_HANDLER_HOST: 'auth.aglyn.com',
        NEXT_PUBLIC_WORKSPACE_DOMAIN: 'aglyn.com',
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'aglyn-main.firebaseapp.com',
      }),
    ).toBe('auth.aglyn.com')
  })

  /**
   * The regression. Vercel's Preview environment sets the handler host and
   * omits the workspace domain; the old resolver additionally required
   * `window.location.hostname` to end in `.aglyn.com`, so a `*.vercel.app`
   * preview could not use the branded host it had been given.
   */
  it('uses the handler host even when the page is not on the workspace domain', () => {
    const previousHref = window.location.href
    window.history.replaceState({}, '', '/')
    expect(
      authDomainWith({
        NEXT_PUBLIC_FIREBASE_AUTH_HANDLER_HOST: 'auth.aglyn.com',
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'aglyn-main.firebaseapp.com',
      }),
    ).toBe('auth.aglyn.com')
    // jsdom serves `localhost`, which is exactly the host that used to fall
    // back — the assertion above is only meaningful because of that.
    expect(window.location.hostname).toBe('localhost')
    window.history.replaceState({}, '', previousHref)
  })

  it('derives auth.<workspaceDomain> when no handler host is configured', () => {
    expect(
      authDomainWith({
        NEXT_PUBLIC_WORKSPACE_DOMAIN: 'example.com',
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'acme-selfhost.firebaseapp.com',
      }),
    ).toBe('auth.example.com')
  })

  /**
   * Never defaulted to `aglyn.com`. A self-hosted install that set neither
   * variable would otherwise be pointed at OUR auth origin — the same trap
   * `ssoServiceMetadata()` calls out, which is why the two share a
   * precedence.
   */
  it('falls back to the project firebaseapp domain when neither is set', () => {
    expect(
      authDomainWith({
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'acme-selfhost.firebaseapp.com',
      }),
    ).toBe('acme-selfhost.firebaseapp.com')
  })

  it('treats a declared-but-empty handler host as unset, not as an override', () => {
    expect(
      authDomainWith({
        NEXT_PUBLIC_FIREBASE_AUTH_HANDLER_HOST: '',
        NEXT_PUBLIC_WORKSPACE_DOMAIN: 'aglyn.com',
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'aglyn-main.firebaseapp.com',
      }),
    ).toBe('auth.aglyn.com')
  })

  /**
   * There is no branded host in front of a local Auth emulator: the SDK's
   * `connectAuthEmulator` takes over, and a branded value here would only
   * mislead anyone reading the config.
   */
  it('keeps the configured domain under the auth emulator', () => {
    expect(
      authDomainWith({
        FIREBASE_AUTH_EMULATOR_ENABLED: 'true',
        NEXT_PUBLIC_FIREBASE_AUTH_HANDLER_HOST: 'auth.aglyn.com',
        NEXT_PUBLIC_WORKSPACE_DOMAIN: 'aglyn.com',
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'aglyn-main.firebaseapp.com',
      }),
    ).toBe('aglyn-main.firebaseapp.com')
  })
})
