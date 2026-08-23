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
 *
 * @jest-environment jsdom
 */

/**
 * AGL-2486 — proof that the style capture is WIRED into the realm loader, not
 * merely exported alongside it.
 *
 * `plugin-styles.spec.tsx` proves the registry and the capture behave. Neither
 * of those says anything about whether `loadRealmPlugins` ever calls the
 * capture, and a route nothing calls is the failure shape this repo has
 * recorded before ("written but never read").
 *
 * A real load ends in a blob-URL dynamic `import()`, which jsdom has no module
 * loader for. That import failing is USED here rather than worked around: the
 * capture is mocked to run its callback, and the callback's failure must
 * surface as the loader's per-bundle error. If the capture were called after
 * the import instead of wrapping it, the mock would receive a function that
 * does nothing and the import error would arrive by a different route — so
 * asserting BOTH the entry and the error is what pins the nesting.
 *
 * `globalThis.crypto` is replaced with node's WebCrypto: the loader verifies
 * an Ed25519 signature before it reaches the import, and jsdom's `crypto` has
 * no `subtle`. Signing with `node:crypto` mirrors the staff publish flow, the
 * same way `realm-plugins.spec.ts` does.
 */

import { generateKeyPairSync, sign as nodeSign, webcrypto } from 'node:crypto'
import { capturePluginStyles } from './plugin-styles'
import { loadRealmPlugins, sha256Hex } from './realm-plugins'

jest.mock('./plugin-styles', () => ({
  __esModule: true,
  capturePluginStyles: jest.fn(
    async (_pluginId: string, load: () => Promise<unknown>) => load(),
  ),
}))

const captureMock = capturePluginStyles as unknown as jest.Mock

const BUNDLE = 'export function register(){}'

describe('loadRealmPlugins style capture (AGL-2486)', () => {
  let sha256: string
  let publicKeyBase64: string
  let signature: string
  let errors: unknown[][]

  beforeAll(async () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
    })
    const bytes = new TextEncoder().encode(BUNDLE)
      .buffer as unknown as ArrayBuffer
    sha256 = await sha256Hex(bytes)
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    signature = nodeSign(
      null,
      Buffer.from(sha256, 'utf8'),
      privateKey,
    ).toString('base64')
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string }
    publicKeyBase64 = Buffer.from(jwk.x, 'base64url').toString('base64')
  })

  beforeEach(() => {
    captureMock.mockClear()
    errors = []
    jest
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => void errors.push(args))
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(BUNDLE).buffer,
    })) as unknown as typeof fetch
    // jsdom ships no blob module loader; the URL only has to exist far enough
    // to reach the import the capture is supposed to be wrapped around.
    URL.createObjectURL = jest.fn(() => 'blob:agl-2486')
    URL.revokeObjectURL = jest.fn()
  })

  afterEach(() => jest.restoreAllMocks())

  /** A fresh version each time: the loader caches per `listing@version`. */
  const install = (listingId: string) => ({
    listingId,
    version: `1.0.${Math.random().toString().slice(2)}`,
    sha256,
    trust: 'realm',
    signature,
  })

  it('enters the capture with the listing id, wrapping import + register', async () => {
    await loadRealmPlugins([install('listing-abc')], {
      artifactsBase: 'https://plugins.example',
      publicKeyBase64,
    })

    expect(captureMock).toHaveBeenCalledTimes(1)
    expect(captureMock.mock.calls[0][0]).toBe('listing-abc')
    expect(typeof captureMock.mock.calls[0][1]).toBe('function')
    // The work handed to the capture is the import, and its failure is the
    // loader's per-bundle error — i.e. the capture is OUTSIDE the import.
    expect(errors).toHaveLength(1)
    expect(String(errors[0][0])).toContain('listing-abc')
  })

  it('never reaches the capture for a bundle that fails verification', async () => {
    // Fail-closed control: a tampered sha must not even open a style window.
    await loadRealmPlugins(
      [{ ...install('listing-bad'), sha256: 'f'.repeat(64) }],
      { artifactsBase: 'https://plugins.example', publicKeyBase64 },
    )
    expect(captureMock).not.toHaveBeenCalled()
  })

  it('never reaches the capture for a non-realm install', async () => {
    await loadRealmPlugins(
      [{ ...install('listing-sandboxed'), trust: 'sandbox' }],
      { artifactsBase: 'https://plugins.example', publicKeyBase64 },
    )
    expect(captureMock).not.toHaveBeenCalled()
  })
})
