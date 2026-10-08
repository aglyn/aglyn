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

const mockVariableWriter = {
  check: jest.fn(),
  refusal: jest.fn(async () => null),
  read: jest.fn(async () => null),
  write: jest.fn(async () => ({ ok: true, replayed: false, id: 'v-1', name: 'x', versionId: null, facts: {} })),
}
const mockFunctionWriter = {
  check: jest.fn(),
  refusal: jest.fn(async () => ({ status: 403, error: 'no' })),
  read: jest.fn(async () => null),
  write: jest.fn(),
}

jest.mock('./server/logic-drafts', () => ({
  variableDraftWriter: mockVariableWriter,
  functionDraftWriter: mockFunctionWriter,
}))

import { pluginAiCapability } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerLogicConsoleServerDeclarations } from './declarations.console-server'

/**
 * The console's logic declarations (AGL-3616): the `variable` and `function`
 * draft writers and the `variable` build operation, registered by the boot
 * manifest the CONSOLE runs and never the tenant's.
 */

const REPO_ROOT = join(__dirname, '../../../../..')
const CALL =
  "(await import('@aglyn/plugins-logic/declarations.console-server')).registerLogicConsoleServerDeclarations()"

beforeEach(() => {
  resetPluginServicesForTests()
  jest.clearAllMocks()
})

describe('the console server declarations', () => {
  it('register both writers and the variable operation, owned by logic, once however often they run', () => {
    registerLogicConsoleServerDeclarations()
    registerLogicConsoleServerDeclarations()
    expect(pluginResourceDraftWriter('variable')?.pluginId).toBe('logic')
    expect(pluginResourceDraftWriter('function')?.pluginId).toBe('logic')
    expect(pluginAiCapability('variable')).toMatchObject({ pluginId: 'logic', capability: { draftResource: 'variable' } })
    // A function needs a model: it is the AI plugin's operation, not this one's.
    expect(pluginAiCapability('function')).toBeNull()
  })

  it('answer a check without loading the store half, and hand the rest to it', async () => {
    registerLogicConsoleServerDeclarations()
    const variable = pluginResourceDraftWriter('variable')?.writer
    const fn = pluginResourceDraftWriter('function')?.writer
    expect(variable?.check({ name: 'x', type: 'boolean', value: 'true' }, { hostId: 'h' })).toEqual({
      ok: true,
      facts: { type: 'boolean' },
    })
    expect(fn?.check({ name: 'f' }, { hostId: 'h' })).toMatchObject({ ok: false })
    expect(mockVariableWriter.check).not.toHaveBeenCalled()
    expect(mockFunctionWriter.check).not.toHaveBeenCalled()
    const context = { orgId: 'o', hostId: 'h', uid: 'u', org: null, now: new Date() }
    await expect(variable?.refusal(context)).resolves.toBeNull()
    await expect(fn?.refusal(context)).resolves.toEqual({ status: 403, error: 'no' })
    await expect(variable?.read({ hostId: 'h', id: 'v-1' })).resolves.toBeNull()
    await expect(variable?.write({ ...context, id: 'v-1', name: 'x', content: {} })).resolves.toMatchObject({ ok: true })
    expect(mockVariableWriter.write).toHaveBeenCalledTimes(1)
  })

  it('are called by name from the console’s server manifest, and not the tenant’s', () => {
    const console = readFileSync(join(REPO_ROOT, 'apps/console/constants/plugins.declarations.server.generated.ts'), 'utf8')
    const tenant = readFileSync(join(REPO_ROOT, 'apps/tenant/utils/plugins.declarations.server.generated.ts'), 'utf8')
    expect(console).toContain(CALL)
    expect(tenant).not.toContain('@aglyn/plugins-logic/declarations.console-server')
  })
})
