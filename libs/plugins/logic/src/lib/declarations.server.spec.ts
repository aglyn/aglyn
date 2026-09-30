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
 * @jest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mockFind = jest.fn(async () => ({
  dependents: [{ type: 'variable', id: 'v-1', name: 'price', via: ['id' as const] }],
  truncated: false,
}))

jest.mock('./server/variable-dependents', () => ({
  findWorkflowDependents: (...args: unknown[]) =>
    (mockFind as (...a: unknown[]) => unknown)(...args),
}))

import { findPluginDependents } from '@aglyn/aglyn/plugin-manager/plugin-dependents'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerLogicServerDeclarations } from './declarations.server'

/**
 * The logic plugin answers what depends on a workflow (AGL-3080): its
 * variables computed from one. The workflows plugin asks the platform's
 * "Used by" scan, the scan asks the registered sources, and neither plugin
 * imports the other. The registration only exists in a running app if the
 * app CALLS it, by name, from the manifest its boot runs.
 */

const REPO_ROOT = join(__dirname, '../../../../..')

beforeEach(() => {
  resetPluginServicesForTests()
  mockFind.mockClear()
})

describe('the server declarations', () => {
  it('answer the "Used by" scan for a workflow with this plugin’s variables', async () => {
    registerLogicServerDeclarations()
    const ask = { hostId: 'site-1', kind: 'workflow', id: 'wf-1', name: 'Quote' }
    await expect(findPluginDependents(ask)).resolves.toEqual({
      dependents: [{ type: 'variable', id: 'v-1', name: 'price', via: ['id'] }],
      complete: true,
    })
    expect(mockFind).toHaveBeenCalledWith(ask)
  })

  it('answer nothing for any other kind, and register once however often they run', async () => {
    registerLogicServerDeclarations()
    registerLogicServerDeclarations()
    await expect(
      findPluginDependents({ hostId: 'site-1', kind: 'function', id: 'fn-1' }),
    ).resolves.toEqual({ dependents: [], complete: true })
    await findPluginDependents({ hostId: 'site-1', kind: 'workflow', id: 'wf-1' })
    expect(mockFind).toHaveBeenCalledTimes(1)
  })

  it.each([
    'apps/tenant/utils/plugins.declarations.server.generated.ts',
    'apps/console/constants/plugins.declarations.server.generated.ts',
  ])('are called by name from %s', (manifest) => {
    const source = readFileSync(join(REPO_ROOT, manifest), 'utf8')
    expect(source).toContain(
      "(await import('@aglyn/plugins-logic/declarations.server')).registerLogicServerDeclarations()",
    )
  })
})
