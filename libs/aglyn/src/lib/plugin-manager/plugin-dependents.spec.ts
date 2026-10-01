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

import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  findPluginDependents,
  registerPluginDependentsSource,
  type PluginDependentsRequest,
  type PluginDependentsSource,
} from './plugin-dependents'
import { resetPluginServicesForTests } from './plugin-services'

const asked: PluginDependentsRequest[] = []

const source = (
  kinds: string[],
  answer: Awaited<ReturnType<PluginDependentsSource['find']>>,
): PluginDependentsSource => ({
  kinds,
  async find(request) {
    asked.push(request)
    return answer
  },
})

const request = { hostId: 'h1', kind: 'function', id: 'fn-1', name: 'rateFor' }

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
  asked.length = 0
})

describe('dependents sources (AGL-3080)', () => {
  it('asks only the sources that answer for the kind, and lists what they find', async () => {
    registerPluginDependentsSource(
      source(['function'], {
        dependents: [{ type: 'pipeline', id: 'p1', name: 'Quote', via: ['id'] }],
        truncated: false,
      }),
      { pluginId: 'pipes' },
    )
    registerPluginDependentsSource(
      source(['pipeline'], {
        dependents: [{ type: 'setting', id: 's1', name: 'Rate', via: ['name'] }],
        truncated: false,
      }),
      { pluginId: 'settings' },
    )
    await expect(findPluginDependents(request)).resolves.toEqual({
      dependents: [{ type: 'pipeline', id: 'p1', name: 'Quote', via: ['id'] }],
      complete: true,
    })
    expect(asked).toEqual([request])
  })

  it('is complete and empty when no plugin keeps records that refer to the kind', async () => {
    await expect(findPluginDependents(request)).resolves.toEqual({
      dependents: [],
      complete: true,
    })
  })

  it('is incomplete when a source read only part of its records', async () => {
    registerPluginDependentsSource(source(['function'], { dependents: [], truncated: true }), {
      pluginId: 'pipes',
    })
    await expect(findPluginDependents(request)).resolves.toEqual({
      dependents: [],
      complete: false,
    })
  })

  it('is incomplete, and keeps every other answer, when a source fails', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginDependentsSource(
      {
        kinds: ['function'],
        find: async () => {
          throw new Error('storage down')
        },
      },
      { pluginId: 'broken' },
    )
    registerPluginDependentsSource(
      source(['function'], {
        dependents: [{ type: 'pipeline', id: 'p1', name: 'Quote', via: ['name'] }],
        truncated: false,
      }),
      { pluginId: 'pipes' },
    )
    await expect(findPluginDependents(request)).resolves.toEqual({
      dependents: [{ type: 'pipeline', id: 'p1', name: 'Quote', via: ['name'] }],
      complete: false,
    })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('takes its owner from the loader, and replaces a plugin’s source registered again', async () => {
    setRegisteringPluginId('pipes')
    registerPluginDependentsSource(source(['function'], { dependents: [], truncated: false }))
    registerPluginDependentsSource(
      source(['function'], {
        dependents: [{ type: 'pipeline', id: 'p2', name: 'Tax', via: ['id'] }],
        truncated: false,
      }),
    )
    await expect(findPluginDependents(request)).resolves.toMatchObject({
      dependents: [{ id: 'p2' }],
    })
  })

  it('refuses a source with no owner or no kind', () => {
    expect(() =>
      registerPluginDependentsSource(source(['function'], { dependents: [], truncated: false })),
    ).toThrow(/no owner/)
    expect(() =>
      registerPluginDependentsSource(source([' '], { dependents: [], truncated: false }), {
        pluginId: 'pipes',
      }),
    ).toThrow(/names no kind/)
  })
})
