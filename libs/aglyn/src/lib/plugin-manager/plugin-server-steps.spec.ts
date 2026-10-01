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
 * A step another plugin runs is handed to the executor that plugin registered,
 * and an empty registry is never read as "nobody runs it" for a step a plugin
 * declared (AGL-3080).
 *
 * The cases hold apart the three answers of `pluginServerStepExecutor` —
 * registered, declared but missing (which must THROW once the repair has had
 * its turn), and neither — and pin the ownership rules a registration is held
 * to: an owner, plain types, no type another plugin declares or holds, and
 * nothing registered unless every type is accepted.
 */

let mockDeclared: unknown = undefined

jest.mock('./first-party-plugins.generated', () => {
  const actual = jest.requireActual('./first-party-plugins.generated')
  return {
    __esModule: true,
    ...actual,
    get PLUGIN_SERVER_STEPS_DECLARED() {
      return mockDeclared === undefined ? actual.PLUGIN_SERVER_STEPS_DECLARED : mockDeclared
    },
  }
})

import {
  registerPluginDeclarationsRepair,
  resetPluginDeclarationsRepairForTests,
} from './plugin-declarations-repair'
import {
  declaredServerStep,
  declaredServerSteps,
  pluginServerStepExecutor,
  registeredServerStepExecutor,
  registerServerStepExecutor,
  resetServerStepExecutorsForTests,
  type ServerStepExecutor,
  ServerStepUnavailableError,
} from './plugin-server-steps'

const ran: ServerStepExecutor = async () => ({ detail: 'ran' })
const other: ServerStepExecutor = async () => ({ detail: 'other' })

beforeEach(() => {
  mockDeclared = [{ pluginId: 'stamps', type: 'stampVisitor' }]
  resetServerStepExecutorsForTests()
  resetPluginDeclarationsRepairForTests()
})

afterAll(() => {
  resetServerStepExecutorsForTests()
  resetPluginDeclarationsRepairForTests()
})

describe('the compiled declarations', () => {
  it('reads every row the generator compiled, each a plugin and a plain step type', () => {
    mockDeclared = undefined
    for (const row of declaredServerSteps()) {
      expect(row).toEqual({ pluginId: expect.any(String), type: expect.stringMatching(/^[a-z][A-Za-z0-9]*$/) })
    }
  })

  it('finds a declaration by its step type, and nothing for a type nobody declares', () => {
    expect(declaredServerStep('stampVisitor')).toEqual({ pluginId: 'stamps', type: 'stampVisitor' })
    expect(declaredServerStep('sendEmail')).toBeNull()
  })
})

describe('registerServerStepExecutor', () => {
  it('registers one executor under each of its types, with its owner', () => {
    registerServerStepExecutor(['stampVisitor', 'unstampVisitor'], ran, { pluginId: 'stamps' })
    expect(registeredServerStepExecutor('stampVisitor')).toEqual({ pluginId: 'stamps', run: ran })
    expect(registeredServerStepExecutor('unstampVisitor')).toEqual({ pluginId: 'stamps', run: ran })
  })

  it('refuses a registration with no owner', () => {
    expect(() => registerServerStepExecutor(['stampVisitor'], ran)).toThrow(/no owner/)
    expect(registeredServerStepExecutor('stampVisitor')).toBeNull()
  })

  it('refuses no types, and a type that is not a plain step name', () => {
    expect(() => registerServerStepExecutor([], ran, { pluginId: 'stamps' })).toThrow(/no step type/)
    expect(() => registerServerStepExecutor(['stamp visitor'], ran, { pluginId: 'stamps' })).toThrow(
      /not a plain step type/,
    )
  })

  it('refuses a type another plugin declares', () => {
    expect(() => registerServerStepExecutor(['stampVisitor'], ran, { pluginId: 'imposter' })).toThrow(
      /declared by "stamps"; refused an executor from "imposter"/,
    )
  })

  it('refuses a type another plugin already holds, and the holder keeps it', () => {
    registerServerStepExecutor(['ringBell'], ran, { pluginId: 'bells' })
    expect(() => registerServerStepExecutor(['ringBell'], other, { pluginId: 'chimes' })).toThrow(
      /already has an executor from "bells"; refused "chimes"/,
    )
    expect(registeredServerStepExecutor('ringBell')?.run).toBe(ran)
  })

  it('registers nothing when one of its types is refused', () => {
    expect(() =>
      registerServerStepExecutor(['ringBell', 'stampVisitor'], ran, { pluginId: 'bells' }),
    ).toThrow(/declared by "stamps"/)
    expect(registeredServerStepExecutor('ringBell')).toBeNull()
  })

  it('lets the same plugin register again, replacing its own', () => {
    registerServerStepExecutor(['stampVisitor'], ran, { pluginId: 'stamps' })
    registerServerStepExecutor(['stampVisitor'], other, { pluginId: 'stamps' })
    expect(registeredServerStepExecutor('stampVisitor')?.run).toBe(other)
  })

  it('unregisters only while it is still the one registered', () => {
    const first = registerServerStepExecutor(['stampVisitor'], ran, { pluginId: 'stamps' })
    registerServerStepExecutor(['stampVisitor'], other, { pluginId: 'stamps' })
    first()
    expect(registeredServerStepExecutor('stampVisitor')?.run).toBe(other)
  })
})

describe('pluginServerStepExecutor', () => {
  it('answers the registered executor, declared or not', async () => {
    registerServerStepExecutor(['stampVisitor'], ran, { pluginId: 'stamps' })
    registerServerStepExecutor(['ringBell'], other, { pluginId: 'bells' })
    expect((await pluginServerStepExecutor('stampVisitor'))?.run).toBe(ran)
    expect((await pluginServerStepExecutor('ringBell'))?.run).toBe(other)
  })

  it('answers null for a type nobody declares or registers, and runs no repair', async () => {
    const repair = jest.fn(async (): Promise<void> => undefined)
    registerPluginDeclarationsRepair(repair)
    expect(await pluginServerStepExecutor('sendEmail')).toBeNull()
    expect(repair).not.toHaveBeenCalled()
  })

  it('runs the repair for a declared step nobody registered, and answers what it registered', async () => {
    registerPluginDeclarationsRepair(async () => {
      registerServerStepExecutor(['stampVisitor'], ran, { pluginId: 'stamps' })
    })
    expect((await pluginServerStepExecutor('stampVisitor'))?.run).toBe(ran)
  })

  it('THROWS for a declared step still missing after the repair, naming the step and its plugin', async () => {
    const repair = jest.fn(async (): Promise<void> => undefined)
    registerPluginDeclarationsRepair(repair)
    await expect(pluginServerStepExecutor('stampVisitor')).rejects.toThrow(ServerStepUnavailableError)
    await expect(pluginServerStepExecutor('stampVisitor')).rejects.toThrow(
      'the "stampVisitor" step did not run: the plugin that runs it ("stamps") is not loaded on this server',
    )
    expect(repair).toHaveBeenCalled()
  })

  it('throws the same when the repair itself fails, and logs the failure', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginDeclarationsRepair(async () => {
      throw new Error('boot failed again')
    })
    await expect(pluginServerStepExecutor('stampVisitor')).rejects.toThrow(ServerStepUnavailableError)
    expect(logged).toHaveBeenCalledWith('[server-steps] the declarations repair failed', expect.any(Error))
    logged.mockRestore()
  })
})
