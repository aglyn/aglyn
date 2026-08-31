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
 * The realm-plugin host ABI, and the boundary it sits behind.
 *
 * Two properties, and the second is the one a visitor pays for. The host must
 * still carry the APP's React (the blank-canvas invariant: exactly one React
 * and one registry across app and remote bundle), and the module that holds the
 * core namespace as a VALUE must be reached only through an `import()` — a
 * namespace passed as a value is opaque to a bundler, so an eager import of it
 * puts everything the core barrel reaches into every published page's download.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const HOST_GLOBAL = '__AGLYN_PLUGIN_HOST__'
const scope = globalThis as unknown as Record<string, unknown>

afterEach(() => {
  delete scope[HOST_GLOBAL]
})

it('composes a host carrying the caller React and the core namespace', async () => {
  const React = { marker: 'the app bundle React' }
  const jsxRuntime = { marker: 'the app bundle jsx-runtime' }

  const { composeRealmPluginHost } = await import(
    '../utils/realm-plugin-host.client'
  )
  composeRealmPluginHost({ React, jsxRuntime })

  const host = scope[HOST_GLOBAL] as Record<string, unknown>
  expect(host).toBeDefined()
  // Core owns the version stamp; the app must not be able to forge it.
  expect(typeof host['version']).toBe('number')
  // Substituting core's own React here is what renders a remote plugin blank.
  expect(host['React']).toBe(React)
  expect(host['jsxRuntime']).toBe(jsxRuntime)
  // The slot remote bundles read the platform API out of.
  const aglyn = host['aglyn'] as Record<string, unknown>
  expect(typeof aglyn['setRealmPluginHost']).toBe('function')
  expect(typeof aglyn['loadRealmPlugins']).toBe('function')
})

it('reaches the namespace module only through a relative import()', () => {
  const source = readFileSync(
    join(__dirname, '..', 'utils', 'realm-plugins.client.ts'),
    'utf8',
  )
  // A static import of the host module would put the core namespace back into
  // the first-load graph of every published page, which is the whole cost this
  // boundary removes — and it would still compile, lint and pass every other
  // test in this file.
  expect(source).toMatch(
    /await import\(\s*'\.\/realm-plugin-host\.client'\s*\)/,
  )
  expect(source).not.toMatch(
    /^import .*from '\.\/realm-plugin-host\.client'/m,
  )
  // A package-specifier deferral of core registers a dynamic nx edge, which
  // makes `@nx/enforce-module-boundaries` forbid every static import of core
  // across the app. The relative form is the one that crosses no boundary.
  expect(source).not.toMatch(/import\(\s*'@aglyn\//)
})

it('holds no core namespace as a value in the eagerly loaded module', () => {
  const source = readFileSync(
    join(__dirname, '..', 'utils', 'realm-plugins.client.ts'),
    'utf8',
  )
  // `import type * as` is erased; `import * as` is not, and is what pins the
  // barrel.
  expect(source).not.toMatch(/^import \* as Aglyn from '@aglyn\/aglyn'/m)
  expect(source).toMatch(/^import type \* as Aglyn from '@aglyn\/aglyn'/m)
})
