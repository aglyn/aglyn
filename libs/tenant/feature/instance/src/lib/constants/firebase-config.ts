/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import { type FirebaseOptions } from 'firebase/app'

export const RECAPTCHA_API_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY
export const FIREBASE_CLIENT_APP_NAME = 'DEFAULT_AGLYN'

/**
 * On deployed workspace hosts the OAuth handshake is funnelled through one
 * dedicated same-site auth origin — `auth.<workspaceDomain>` (e.g.
 * auth.aglyn.com), which reverse-proxies the Firebase auth helpers under
 * /__/* (console next.config rewrite, AGL-462). This keeps the handshake
 * same-site (all *.aglyn.com share the aglyn.com eTLD+1, so browser storage
 * partitioning — which severed the cross-origin *.firebaseapp.com
 * authDomain and broke mobile Google sign-in — never applies), while
 * every host, including dynamically-provisioned {org}.aglyn.com
 * workspaces, presents the SAME redirect URI. Google OAuth forbids
 * wildcard redirect URIs, so a per-host authDomain would need a new
 * registration per org; the single auth host needs exactly one.
 *
 * **The auth origin is a property of the DEPLOYMENT, not of the page you
 * happen to be on** (AGL-1919). This used to gate on
 * `window.location.hostname` being on the workspace domain, which meant
 * localhost and every preview deployment silently fell back to
 * `aglyn-main.firebaseapp.com` — and so Google's account chooser said
 * "continue to aglyn-main.firebaseapp.com" for the entire local
 * development loop. Google renders the redirect_uri's host, and the
 * redirect_uri is `https://<authDomain>/__/auth/handler`. Preview was the
 * sharper version of the same bug: it *has* NEXT_PUBLIC_FIREBASE_AUTH_
 * HANDLER_HOST set and could not use it, because a `*.vercel.app`
 * hostname fails the `endsWith` test.
 *
 * Widening it is safe precisely because nothing about the branded host is
 * new: `auth.aglyn.com` already serves `/__/auth/*`, is already a Firebase
 * authorized domain, and `https://auth.aglyn.com/__/auth/handler` is
 * already a registered redirect URI on the production OAuth client
 * (AGL-1486 probed all three). This only widens which page hosts use a
 * handler that already works.
 *
 * The precedence deliberately MIRRORS `ssoServiceMetadata()` in
 * `sso-provisioning.ts`, which documents it as load-bearing — the SAML ACS
 * URL and the OAuth redirect URI have to name the same origin or the two
 * halves of a flow land on different ones:
 *
 *   1. NEXT_PUBLIC_FIREBASE_AUTH_HANDLER_HOST — an explicit override wins.
 *   2. `auth.<NEXT_PUBLIC_WORKSPACE_DOMAIN>` — derived only when the
 *      variable is actually SET, never defaulted to `aglyn.com`: a
 *      self-hosted install with neither variable would otherwise be
 *      pointed at OUR auth origin.
 *   3. NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN — the project's own
 *      *.firebaseapp.com, for self-host installs that never stood up an
 *      auth subdomain.
 *
 * The emulator keeps the configured domain outright: there is no branded
 * host in front of a local Auth emulator.
 */
function resolveFirebaseAuthDomain(): string | undefined {
  const configured = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
  if (process.env['FIREBASE_AUTH_EMULATOR_ENABLED'] === 'true') {
    return configured
  }
  const workspaceDomain = process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN
  // `||`, not `??`, and for the same reason `ssoServiceMetadata()` uses it:
  // a variable declared-but-empty in a .env file (`NEXT_PUBLIC_FIREBASE_
  // AUTH_HANDLER_HOST=`) is NOT an override — `??` would accept `''` and
  // hand Firebase `https:///__/auth/handler`.
  const branded =
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_HANDLER_HOST ||
    (workspaceDomain ? `auth.${workspaceDomain}` : '')
  return branded || configured
}

/**
 * Firebase client-side configuration assembled directly from NEXT_PUBLIC_*
 * environment variables so that Next.js webpack DefinePlugin substitutes
 * them at build time and no intermediate constant indirection can carry a
 * stale undefined value across a cached compilation.
 */
export const fbClientAppOptions: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY,
  authDomain: resolveFirebaseAuthDomain(),
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
}

// export let fbClientApp: FirebaseApp
//
// try {
//   fbClientApp = getApp(FIREBASE_CLIENT_APP_NAME)
// }
// catch {
//   fbClientApp = initializeApp(fbClientAppOptions, {
//     name: FIREBASE_CLIENT_APP_NAME,
//     automaticDataCollectionEnabled: true,
//   })
// }
//
// export default fbClientApp
