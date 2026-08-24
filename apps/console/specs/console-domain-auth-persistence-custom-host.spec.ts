/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://console.acme-agency.com/"}
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
 * AGL-1099c, the half that needs its own file.
 *
 * `currentOriginPersistenceClass` reads `window.location.host`, and under
 * this repo's jsdom that property cannot be faked from inside a test.
 * Measured, all three:
 *
 * - redefining `location` on `window` throws "Cannot redefine property:
 *   location";
 * - redefining `host` on `window.location` throws "Cannot redefine property:
 *   host";
 * - delete-then-assign **fails silently**, leaving the host as `localhost`.
 *
 * That last one is the trap: a
 * test written that way asserts against `localhost` while believing it is on
 * a custom domain, so it reports `durable` and passes, proving the opposite
 * of what it claims.
 *
 * The only honest way to put this code on a custom origin is to boot the
 * environment there, which is per-file. Hence one small file whose entire job
 * is the case that matters most: **on a real custom console domain, the
 * console declares `ephemeral`.**
 *
 * The docblock ordering is load-bearing — the `@jest-environment` pragma has
 * to be in the FIRST docblock or the license header shadows it and the file
 * silently runs under the default environment.
 */

import {
  currentOriginPersistenceClass,
  originPersistenceClass,
} from '../constants/workspace-domain'

describe('on a real custom console domain origin', () => {
  it('boots jsdom on the custom domain — the premise of every case below', () => {
    // Asserted, not assumed. If the pragma above ever stops taking effect,
    // this file would otherwise quietly re-run the localhost case and go
    // green while testing nothing.
    expect(window.location.host).toBe('console.acme-agency.com')
  })

  it('declares ephemeral, so no refresh token reaches this origin', () => {
    // `ephemeral` selects `inMemoryPersistence` with a sealed
    // `setPersistence` (AGL-1379) AND `memoryLocalCache()` (AGL-1456).
    // `durable` here would leave a Firebase refresh token in plaintext in
    // IndexedDB, plus cached document bodies beside it, on a hostname whose
    // DNS the customer can re-point at their own server after a detach — and
    // `securetoken.googleapis.com` is not App Check enforced, so that token
    // is exchangeable for ID tokens from any origin until someone calls
    // `revokeRefreshTokens` by hand.
    expect(currentOriginPersistenceClass()).toBe('ephemeral')
  })

  it('agrees with the pure mapping for this host', () => {
    expect(currentOriginPersistenceClass()).toBe(
      originPersistenceClass(window.location.host),
    )
  })
})
