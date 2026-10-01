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

import type { HostVariable } from '../app-utils/variables'
import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  prepareComputedVariables,
  registerVariableComputer,
  type VariableComputer,
} from './computed-variables'
import {
  registerPluginDeclarationsRepair,
  resetPluginDeclarationsRepairForTests,
} from './plugin-declarations-repair'
import { resetPluginServicesForTests } from './plugin-services'

const VARIABLES: Record<string, HostVariable> = {
  'v-price': { name: 'price', type: 'number', value: '10' },
  'v-greeting': { name: 'greeting', type: 'text', value: 'Hi' },
}

/** A computer that sets one variable's value, recording the site it prepared for. */
const setting = (id: string, value: string, prepared: string[]): VariableComputer => ({
  async prepare(hostId) {
    prepared.push(hostId)
    return ({ variables }) => ({ ...variables, [id]: { ...variables[id]!, value } })
  },
})

beforeEach(() => {
  resetPluginServicesForTests()
  resetPluginDeclarationsRepairForTests()
  setRegisteringPluginId(undefined)
})

describe('computed variables (AGL-3080)', () => {
  it('leave every variable its stored value when no plugin computes any', async () => {
    const compute = await prepareComputedVariables('site-1')
    expect(compute({ variables: VARIABLES, functions: {} })).toBe(VARIABLES)
  })

  it('run the app’s declarations step once more when no computer is registered', async () => {
    const prepared: string[] = []
    const repair = jest.fn(async () => {
      registerVariableComputer(setting('v-price', '42', prepared), { pluginId: 'pipes' })
    })
    registerPluginDeclarationsRepair(repair)
    const compute = await prepareComputedVariables('site-1')
    expect(repair).toHaveBeenCalledTimes(1)
    expect(compute({ variables: VARIABLES, functions: {} })['v-price']?.value).toBe('42')
  })

  it('leave the stored values when the repair registers nothing or fails', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginDeclarationsRepair(async () => {
      throw new Error('boot failed')
    })
    const compute = await prepareComputedVariables('site-1')
    expect(compute({ variables: VARIABLES, functions: {} })).toBe(VARIABLES)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('apply each plugin’s computation, in registration order, to the site prepared for', async () => {
    const prepared: string[] = []
    registerVariableComputer(setting('v-price', '42', prepared), { pluginId: 'pipes' })
    registerVariableComputer(
      {
        async prepare(hostId) {
          prepared.push(hostId)
          // Sees the first computer's answer: the value it doubles is 42.
          return ({ variables }) => ({
            ...variables,
            'v-price': { ...variables['v-price']!, value: String(Number(variables['v-price']!.value) * 2) },
          })
        },
      },
      { pluginId: 'doubler' },
    )
    const compute = await prepareComputedVariables('site-1')
    expect(prepared).toEqual(['site-1', 'site-1'])
    expect(compute({ variables: VARIABLES, functions: {} })['v-price']?.value).toBe('84')
  })

  it('keep the stored values a failing computer would have changed, and every other answer', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const prepared: string[] = []
    registerVariableComputer(
      { prepare: async () => Promise.reject(new Error('storage down')) },
      { pluginId: 'unprepared' },
    )
    registerVariableComputer(
      {
        prepare: async () => () => {
          throw new Error('bad run')
        },
      },
      { pluginId: 'throwing' },
    )
    registerVariableComputer(setting('v-greeting', 'Hello', prepared), { pluginId: 'greeter' })
    const compute = await prepareComputedVariables('site-1')
    expect(compute({ variables: VARIABLES, functions: {} })).toEqual({
      ...VARIABLES,
      'v-greeting': { name: 'greeting', type: 'text', value: 'Hello' },
    })
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('take the owner from the loader, and refuse a computer with none', () => {
    expect(() => registerVariableComputer(setting('v-price', '1', []))).toThrow(/no owner/)
    setRegisteringPluginId('pipes')
    expect(() => registerVariableComputer(setting('v-price', '1', []))).not.toThrow()
  })
})
