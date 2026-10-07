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
 * One registry per process, whichever module graph registered (AGL-3596).
 *
 * Next compiles `instrumentation.ts` into a different module graph from the
 * routes, so the plugins' declarations registered at boot land in one copy of
 * these modules and a core route reads another. `jest.isolateModules` gives
 * the same split: the declarations register in an isolated copy, and the
 * catalog is read from this file's own.
 */

import {
  DEFAULT_ROLE_PERMISSIONS,
  ORG_PERMISSION_KEYS,
  resolveOrgPermissions,
} from '../app-utils/org-permissions'
import { resetPluginEntitlementsForTests } from './plugin-entitlements'

type Entitlements = typeof import('./plugin-entitlements')
type Permissions = typeof import('../app-utils/org-permissions')

const GENERATE = {
  key: 'ai.generate',
  label: 'Generate with AI',
  description: 'Run AI generation jobs.',
  roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
} as const

/** Registers the declaration in a copy of the registry module this file does not share. */
function registerInAnotherGraph(): void {
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const boot = require('./plugin-entitlements') as Entitlements
    boot.registerPluginEntitlements({ pluginId: 'ai', orgPermissions: [GENERATE] })
  })
}

afterEach(() => resetPluginEntitlementsForTests())

describe('a catalog key declared in another module graph', () => {
  it('reaches this copy of the catalog: an owner holds ai.generate', () => {
    expect(ORG_PERMISSION_KEYS).not.toContain('ai.generate')
    registerInAnotherGraph()
    expect(ORG_PERMISSION_KEYS).toContain('ai.generate')
    expect(DEFAULT_ROLE_PERMISSIONS.owner['ai.generate']).toBe(true)
    const owner = { role: 'owner', allHosts: true, consoleUserType: 'manager' }
    expect(resolveOrgPermissions(owner as never)['ai.generate']).toBe(true)
    expect(resolveOrgPermissions({ role: 'viewer' } as never)['ai.generate']).toBe(false)
  })

  it('reaches a copy evaluated after the registration', () => {
    registerInAnotherGraph()
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const route = require('../app-utils/org-permissions') as Permissions
      expect(route.resolveOrgPermissions({ role: 'owner' } as never)['ai.generate']).toBe(true)
    })
  })
})
