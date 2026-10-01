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
 * A COMPUTED VARIABLE TAKES ITS VALUE FROM THE PLUGIN THAT COMPUTES IT
 * (AGL-129, AGL-3080).
 *
 * The compose pipeline reads the site's variables and functions, asks every
 * registered variable computer for its computation beside those reads, and
 * binds what it answers. It reads no plugin's records itself: with no
 * computer registered, and when one fails, a variable shows its stored value.
 *
 * Run through `composeNodesWithChrome` with only its reads stubbed; the
 * computers are registered on the real core registry, as a plugin's server
 * declarations register them at boot.
 */

const mockGetPublishedLayoutVersion = jest.fn()
const mockGetVariables = jest.fn()
const mockGetFunctions = jest.fn()

jest.mock('./get-layout-version', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetPublishedLayoutVersion(...a),
}))
jest.mock('./get-components', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ definitions: {} })),
}))
jest.mock('./get-forms', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ forms: {} })),
}))
jest.mock('@aglyn/aglyn/plugin-manager/repeat-rows', () => ({
  __esModule: true,
  readRepeatRows: jest.fn(async () => ({})),
}))
jest.mock('./get-plugin-installs', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
}))
jest.mock('./get-variables', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetVariables(...a),
  getFunctions: (...a: unknown[]) => mockGetFunctions(...a),
}))
jest.mock('./get-collection-content', () => ({
  __esModule: true,
  getPublishedCollectionSource: jest.fn(),
}))
jest.mock('./apply-publish-schedule', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('./get-screen-version', () => ({
  __esModule: true,
  default: jest.fn(),
}))

import { registerVariableComputer } from '@aglyn/aglyn/plugin-manager/computed-variables'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { composeNodesWithChrome } from './compose-screen-nodes'

const ROOT = '_@_'

const PAGE = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['price'] },
  price: {
    $id: 'price',
    componentId: 'muiTypography',
    parentId: ROOT,
    props: { children: 'From {{var:v-price}}' },
    nodes: [],
  },
}

const compose = () =>
  composeNodesWithChrome({ hostId: 'h1', screenNodes: PAGE as never }) as Promise<
    Record<string, any>
  >

describe('computed variables are the computing plugin’s (AGL-3080)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetPluginServicesForTests()
    mockGetPublishedLayoutVersion.mockResolvedValue({ version: { nodes: {} }, layout: {} })
    mockGetVariables.mockResolvedValue({
      'v-price': { name: 'price', type: 'number', value: '10', workflowId: 'wf-quote' },
    })
    mockGetFunctions.mockResolvedValue({})
  })

  it('binds the value the registered computer answers for the site', async () => {
    const asked: string[] = []
    registerVariableComputer(
      {
        async prepare(hostId) {
          asked.push(hostId)
          return ({ variables }) => ({
            ...variables,
            'v-price': { ...variables['v-price']!, value: '42' },
          })
        },
      },
      { pluginId: 'workflows' },
    )
    const nodes = await compose()
    expect(nodes['price'].props.children).toBe('From 42')
    expect(asked).toEqual(['h1'])
  })

  it('binds the stored value where no plugin computes variables', async () => {
    const nodes = await compose()
    expect(nodes['price'].props.children).toBe('From 10')
  })

  it('binds the stored value when the computer fails, and still renders the page', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerVariableComputer(
      { prepare: async () => Promise.reject(new Error('storage down')) },
      { pluginId: 'workflows' },
    )
    const nodes = await compose()
    expect(nodes['price'].props.children).toBe('From 10')
    spy.mockRestore()
  })
})
