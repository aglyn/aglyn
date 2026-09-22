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
 * The contract's failure direction (AGL-3080), which is the whole of it.
 *
 * Realm trust drops a bundle into the app realm. Every way this can be
 * wrong has to point at REFUSING, because an unsigned grant marks a version
 * trusted that the loaders will then fail closed on — or, if a loader is
 * ever lenient, load unverified.
 */

import {
  hasPluginTrustSigner,
  registerPluginTrustSigner,
  signPluginTrust,
} from './plugin-trust-signing'
import { resetPluginServicesForTests } from './plugin-services'

beforeEach(() => {
  resetPluginServicesForTests()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('nothing is signed without a signer', () => {
  it('refuses, and says so out loud, when none is installed', async () => {
    expect(hasPluginTrustSigner()).toBe(false)
    const result = await signPluginTrust('abc123')
    expect(result.signed).toBe(false)
    expect(result.signature).toBeUndefined()
    expect(result.reason).toMatch(/not available/i)
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('no implementation is installed'),
    )
  })

  it('refuses an empty hash before it asks anyone', async () => {
    let asked = false
    registerPluginTrustSigner(
      {
        sign: async () => {
          asked = true
          return { signed: true, signature: 'sig' }
        },
      },
      { pluginId: 'console' },
    )
    expect((await signPluginTrust('   ')).signed).toBe(false)
    expect(asked).toBe(false)
  })
})

describe('with a signer installed', () => {
  it('returns its signature', async () => {
    const seen: string[] = []
    registerPluginTrustSigner(
      {
        sign: async (sha256) => {
          seen.push(sha256)
          return { signed: true, signature: 'c2ln' }
        },
      },
      { pluginId: 'console' },
    )
    expect(await signPluginTrust('deadbeef')).toEqual({
      signed: true,
      signature: 'c2ln',
    })
    expect(seen).toEqual(['deadbeef'])
  })

  it('carries an unconfigured deployment back as a refusal with its reason', async () => {
    registerPluginTrustSigner(
      {
        sign: async () => ({
          signed: false,
          reason: 'Trust signing is not configured (missing PLUGIN_TRUST_PRIVATE_KEY)',
        }),
      },
      { pluginId: 'console' },
    )
    const result = await signPluginTrust('deadbeef')
    expect(result.signed).toBe(false)
    expect(result.reason).toMatch(/PLUGIN_TRUST_PRIVATE_KEY/)
  })

  it('⛔ refuses a signer that claims success with nothing to show', async () => {
    // The one state the loaders cannot tell from tampering: `trust: 'realm'`
    // written with no signature beside it. A signer bug must not become a
    // trusted-but-unloadable version.
    registerPluginTrustSigner(
      { sign: async () => ({ signed: true }) },
      { pluginId: 'console' },
    )
    const result = await signPluginTrust('deadbeef')
    expect(result.signed).toBe(false)
    expect(result.reason).toMatch(/no signature/i)
  })

  it('turns a throw into a refusal rather than propagating it', async () => {
    registerPluginTrustSigner(
      {
        sign: async () => {
          throw new Error('key is malformed')
        },
      },
      { pluginId: 'console' },
    )
    expect(await signPluginTrust('deadbeef')).toEqual({
      signed: false,
      reason: 'Trust signing failed.',
    })
  })

  it('refuses a second signing authority rather than picking one', async () => {
    registerPluginTrustSigner(
      { sign: async () => ({ signed: true, signature: 'a' }) },
      { pluginId: 'console' },
    )
    expect(() =>
      registerPluginTrustSigner(
        { sign: async () => ({ signed: true, signature: 'b' }) },
        { pluginId: 'someone-else' },
      ),
    ).toThrow(/single-implementation/)
  })

  it('refuses a signer that is not one', () => {
    expect(() =>
      registerPluginTrustSigner({} as never, { pluginId: 'console' }),
    ).toThrow(/needs a sign function/)
  })
})
