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
 * AGL-1468: the module-shape failure, in its own file because the mock has to
 * replace `sharp` for the whole module registry.
 *
 * `(await import('sharp')).default` is the line both media routes ran. It is
 * correct under Node ESM and under a bundler that synthesises a CJS
 * namespace, and `undefined` under one that returns `module.exports`
 * directly — Turbopack externalises `sharp` through a generated alias
 * (`.next/node_modules/sharp-<hash>` → `node_modules/sharp`), so the shape
 * that comes back is the bundler's decision and not ours.
 *
 * The failure mode is what makes it worth a test: `undefined(buffer)` throws
 * `TypeError` INSIDE the `catch` that exists to forgive a genuinely
 * unavailable encoder, so a build-configuration problem and a transient
 * storage error produced the same document and the same log-less 200.
 *
 * Both cases below therefore assert on the CONTENT of the reported error, not
 * merely that one exists — the fix is not "we noticed", it is "we can tell
 * which one it was".
 */

describe('sharp module-shape resolution (AGL-1468)', () => {
  afterEach(() => {
    jest.resetModules()
    jest.dontMock('sharp')
  })

  it('names the problem when the module has no callable default', async () => {
    jest.resetModules()
    jest.doMock('sharp', () => ({ __esModule: true, notTheDefault: true }))
    const { generateMediaVariants } = await import('./media-variants')

    const outcome = await generateMediaVariants({
      buffer: Buffer.alloc(16),
      contentType: 'image/png',
      sourceWidth: 1200,
      objectPath: 'hosts/site-a/media/asset',
      saveVariant: async () => undefined,
    })

    expect(outcome.variants).toEqual([])
    // Not "undefined is not a function" from three frames away.
    expect(outcome.error).toContain('sharp did not resolve to a function')
  })

  it('accepts a module that IS the callable, rather than failing on it', async () => {
    jest.resetModules()
    const toBuffer = jest.fn(async () => Buffer.from('RIFF____WEBPtiny'))
    const factory = jest.fn(() => ({
      resize: () => ({ webp: () => ({ toBuffer }) }),
    }))
    // The CommonJS shape: `module.exports = sharp`, no `default`.
    jest.doMock('sharp', () => factory)
    const { generateMediaVariants } = await import('./media-variants')

    const outcome = await generateMediaVariants({
      buffer: Buffer.alloc(16),
      contentType: 'image/png',
      sourceWidth: 1200,
      objectPath: 'hosts/site-a/media/asset',
      saveVariant: async () => undefined,
    })

    expect(outcome.error).toBeUndefined()
    expect(outcome.variants).toEqual([320, 640])
  })
})
