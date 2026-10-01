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
 * WHICH ELEMENTS ARE HANDED A SITE FUNCTION IS DECLARED (AGL-3393).
 *
 * Compose gives a function's definition, and the site variables it reads, to
 * the elements a plugin declares in `contributes.site.functionBindings` and to
 * nothing else. A first-party declaration is compiled in; a marketplace one
 * rides on the host's realm installs, which are read only when the tree places
 * a namespaced element and the host has a function to hand out.
 *
 * Run through `composeNodesWithChrome`, with only its reads stubbed, because
 * the question is what the published page ships.
 */

const mockGetPublishedLayoutVersion = jest.fn()
const mockGetComponents = jest.fn()
const mockGetVariables = jest.fn()
const mockGetFunctions = jest.fn()
const mockReadRepeatRows = jest.fn()
const mockGetPluginInstalls = jest.fn()
const mockGetForms = jest.fn()
const mockGetRealmPluginInstalls = jest.fn()

jest.mock('./get-layout-version', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetPublishedLayoutVersion(...a),
}))
jest.mock('./get-components', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetComponents(...a),
}))
jest.mock('./get-forms', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetForms(...a),
}))
jest.mock('@aglyn/aglyn/plugin-manager/repeat-rows', () => ({
  __esModule: true,
  readRepeatRows: (...a: unknown[]) => mockReadRepeatRows(...a),
}))
jest.mock('./get-plugin-installs', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetPluginInstalls(...a),
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
jest.mock('./realm-installs-seam', () => ({
  getRealmPluginInstalls: (...a: unknown[]) => mockGetRealmPluginInstalls(...a),
}))

/**
 * No first-party element binds a site function today: the calculators are a
 * marketplace plugin (AGL-3394). The compiled declaration is still how one
 * would, and still wins over every manifest, so a stand-in carries it here.
 */
jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
  FIRST_PARTY_FUNCTION_BINDINGS: { firstPartyWidget: 'functionName' },
}))

import { composeNodesWithChrome } from './compose-screen-nodes'

const ROOT = '_@_'

const QUOTE = {
  name: 'quote',
  parameters: [] as unknown[],
  variables: [] as unknown[],
  operations: [] as unknown[],
}

/** The installed calculator plugin's pinned version, as the join returns it. */
const CALCULATOR_INSTALL = {
  listingId: 'listing-calc',
  version: '1.0.0',
  sha256: 'a'.repeat(64),
  trust: 'realm',
  pluginId: 'aglyn.calculator',
  contributes: {
    site: {
      components: ['aglyn.calculator.scope'],
      functionBindings: { 'aglyn.calculator.scope': 'functionName' },
    },
  },
}

const page = (...children: Array<Record<string, unknown>>) => ({
  [ROOT]: {
    $id: ROOT,
    componentId: 'div',
    nodes: children.map((child) => child['$id']),
  },
  ...Object.fromEntries(
    children.map((child) => [child['$id'], { parentId: ROOT, ...child }]),
  ),
})

const compose = (screenNodes: Record<string, unknown>) =>
  composeNodesWithChrome({
    hostId: 'h1',
    screenNodes: screenNodes as never,
  }) as Promise<Record<string, any>>

describe('function bindings are declared, not named by core (AGL-3393)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetPublishedLayoutVersion.mockResolvedValue({
      version: { nodes: {} },
      layout: {},
    })
    mockGetComponents.mockResolvedValue({ definitions: {} })
    mockGetVariables.mockResolvedValue({})
    mockGetFunctions.mockResolvedValue({ quote: QUOTE })
    mockReadRepeatRows.mockResolvedValue([])
    mockGetPluginInstalls.mockResolvedValue({})
    mockGetForms.mockResolvedValue({ forms: {} })
    mockGetRealmPluginInstalls.mockResolvedValue([CALCULATOR_INSTALL])
  })

  it('binds a first-party element from the compiled declaration, with no install read', async () => {
    const nodes = await compose(
      page({
        $id: 'widget',
        componentId: 'firstPartyWidget',
        props: { functionName: 'quote' },
      }),
    )
    expect(nodes['widget'].props.definition).toEqual(QUOTE)
    expect(mockGetRealmPluginInstalls).not.toHaveBeenCalled()
  })

  it("binds an installed marketplace element through its manifest's declaration", async () => {
    const nodes = await compose(
      page({
        $id: 'calc',
        componentId: 'aglyn.calculator.scope',
        pluginId: 'aglyn.calculator',
        props: { functionName: 'quote' },
      }),
    )
    expect(nodes['calc'].props.definition).toEqual(QUOTE)
    expect(mockGetRealmPluginInstalls).toHaveBeenCalledWith({ hostId: 'h1' })
  })

  it('hands nothing to a marketplace element no install declares', async () => {
    mockGetRealmPluginInstalls.mockResolvedValue([])
    const nodes = await compose(
      page({
        $id: 'calc',
        componentId: 'aglyn.calculator.scope',
        props: { functionName: 'quote' },
      }),
    )
    expect(nodes['calc'].props.definition).toBeUndefined()
  })

  it('hands nothing to an undeclared element, whatever its props say', async () => {
    const nodes = await compose(
      page({
        $id: 'text',
        componentId: 'muiTypography',
        props: { functionName: 'quote', children: 'Hi' },
      }),
    )
    expect(nodes['text'].props.definition).toBeUndefined()
  })

  it('does not read the installs when the host has no function to hand out', async () => {
    mockGetFunctions.mockResolvedValue({})
    await compose(
      page({
        $id: 'calc',
        componentId: 'aglyn.calculator.scope',
        props: { functionName: 'quote' },
      }),
    )
    expect(mockGetRealmPluginInstalls).not.toHaveBeenCalled()
  })

  it('never lets a manifest rebind a first-party element', async () => {
    mockGetRealmPluginInstalls.mockResolvedValue([
      {
        ...CALCULATOR_INSTALL,
        contributes: {
          site: {
            components: ['aglyn.calculator.scope', 'firstPartyWidget'],
            functionBindings: {
              'aglyn.calculator.scope': 'functionName',
              firstPartyWidget: 'hijack',
            },
          },
        },
      },
    ])
    const nodes = await compose(
      page(
        {
          $id: 'calc',
          componentId: 'aglyn.calculator.scope',
          props: { functionName: 'quote' },
        },
        {
          $id: 'widget',
          componentId: 'firstPartyWidget',
          props: { functionName: 'quote', hijack: 'nothing' },
        },
      ),
    )
    expect(nodes['widget'].props.definition).toEqual(QUOTE)
  })

  it('binds first-party elements only when the install read fails', async () => {
    mockGetRealmPluginInstalls.mockRejectedValue(new Error('offline'))
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const nodes = await compose(
      page(
        {
          $id: 'calc',
          componentId: 'aglyn.calculator.scope',
          props: { functionName: 'quote' },
        },
        {
          $id: 'widget',
          componentId: 'firstPartyWidget',
          props: { functionName: 'quote' },
        },
      ),
    )
    expect(nodes['calc'].props.definition).toBeUndefined()
    expect(nodes['widget'].props.definition).toEqual(QUOTE)
    error.mockRestore()
  })
})

describe("the dev loop's plugins bind through their manifests on disk (AGL-3394)", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mkdtempSync, writeFileSync } = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require('node:path') as typeof import('node:path')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'dev-manifests-'))
  const manifestPath = join(dir, 'manifest.json')
  writeFileSync(
    manifestPath,
    JSON.stringify({
      id: 'calculator',
      contributes: {
        site: {
          components: ['aglyn.calculator.scope', 'firstPartyWidget'],
          functionBindings: {
            'aglyn.calculator.scope': 'functionName',
            firstPartyWidget: 'hijack',
          },
        },
      },
    }),
  )
  const env = process.env as Record<string, string | undefined>
  const saved = { ...env }
  const calculator = () =>
    page(
      {
        $id: 'calc',
        componentId: 'aglyn.calculator.scope',
        props: { functionName: 'quote' },
      },
      {
        $id: 'widget',
        componentId: 'firstPartyWidget',
        props: { functionName: 'quote', hijack: 'nothing' },
      },
    )

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetPublishedLayoutVersion.mockResolvedValue({ version: { nodes: {} }, layout: {} })
    mockGetComponents.mockResolvedValue({ definitions: {} })
    mockGetVariables.mockResolvedValue({})
    mockGetFunctions.mockResolvedValue({ quote: QUOTE })
    mockReadRepeatRows.mockResolvedValue([])
    mockGetPluginInstalls.mockResolvedValue({})
    mockGetForms.mockResolvedValue({ forms: {} })
    // A dev bundle has no install.
    mockGetRealmPluginInstalls.mockResolvedValue([])
    env['NEXT_PUBLIC_PLUGIN_DEV'] = 'enabled'
    env['PLUGIN_DEV_MANIFESTS'] = manifestPath
  })

  afterEach(() => {
    for (const key of ['NEXT_PUBLIC_PLUGIN_DEV', 'PLUGIN_DEV_MANIFESTS', 'NODE_ENV']) {
      if (saved[key] === undefined) delete env[key]
      else env[key] = saved[key]
    }
  })

  it("binds a dev plugin's element from its manifest file", async () => {
    const nodes = await compose(calculator())
    expect(nodes['calc'].props.definition).toEqual(QUOTE)
    // The platform's own element keeps its compiled binding.
    expect(nodes['widget'].props.definition).toEqual(QUOTE)
  })

  it('reads nothing without the dev loop opt-in', async () => {
    delete env['NEXT_PUBLIC_PLUGIN_DEV']
    const nodes = await compose(calculator())
    expect(nodes['calc'].props.definition).toBeUndefined()
  })

  it('reads nothing in a production build', async () => {
    env['NODE_ENV'] = 'production'
    const nodes = await compose(calculator())
    expect(nodes['calc'].props.definition).toBeUndefined()
  })

  it('skips a manifest it cannot read, and still composes', async () => {
    env['PLUGIN_DEV_MANIFESTS'] = join(dir, 'missing.json')
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const nodes = await compose(calculator())
    expect(nodes['calc'].props.definition).toBeUndefined()
    expect(nodes['widget'].props.definition).toEqual(QUOTE)
    error.mockRestore()
  })
})

