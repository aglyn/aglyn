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

import * as Aglyn from '@aglyn/aglyn'
import { componentCreateSeed } from './component-create-seed'

const mockEnsure = jest.fn(async () => undefined)
jest.mock('../constants/console-plugin-loader', () => ({
  consolePluginLoader: {
    ensure: (...args: unknown[]) => (mockEnsure as any)(...args),
  },
}))

/**
 * What the Components page creates (AGL-3287). The email plugin is not loaded
 * in this suite, so its Header stands here as a registered preset under the
 * id core names for it — which is exactly the contract the page relies on.
 */
describe('componentCreateSeed (AGL-3287)', () => {
  const HEADER = Aglyn.REUSABLE_EMAIL_BLOCK_STARTER_PRESET_IDS.header

  beforeEach(() => {
    mockEnsure.mockClear()
    Aglyn.components.registerPreset({
      $id: HEADER,
      type: Aglyn.NodeType.PRESET,
      displayName: 'Header',
      pluginId: 'email',
      data: {
        $id: null,
        componentId: 'emailSection',
        pluginId: 'email',
        props: { align: 'center' },
        nodes: [
          {
            $id: null,
            componentId: 'emailText',
            pluginId: 'email',
            props: { children: 'Your company' },
          },
        ],
      },
    } as unknown as Aglyn.PresetSchema)
  })

  afterEach(() => {
    Aglyn.components.unregisterPreset(HEADER)
  })

  it('starts a page component blank and names no kind, exactly as before', async () => {
    const seed = await componentCreateSeed({ kind: 'site' })
    expect(seed).not.toHaveProperty('kind')
    expect(seed.rootId).toBe(Aglyn.CANVAS_ROOT_ELEMENT_ID)
    expect(seed.nodes[Aglyn.CANVAS_ROOT_ELEMENT_ID]).toMatchObject({
      componentId: 'div',
      nodes: [],
    })
    // A page component needs nothing the page does not already have.
    expect(mockEnsure).not.toHaveBeenCalled()
  })

  it('starts a Header email block from the email plugin’s own Header', async () => {
    const seed = await componentCreateSeed({ kind: 'email', starter: 'header' })
    expect(seed.kind).toBe('email')
    expect(mockEnsure).toHaveBeenCalledWith(['email'], ['site'])
    const root = seed.nodes[seed.rootId] as Record<string, any>
    expect(root).toMatchObject({
      componentId: 'emailSection',
      parentId: null,
      props: { align: 'center' },
    })
    expect(root['nodes']).toHaveLength(1)
    expect(seed.nodes[root['nodes'][0]]).toMatchObject({
      componentId: 'emailText',
      parentId: seed.rootId,
      props: { children: 'Your company' },
    })
  })

  it('starts a Blank email block on the empty canvas, still as an email block', async () => {
    const seed = await componentCreateSeed({ kind: 'email', starter: 'blank' })
    expect(seed.kind).toBe('email')
    expect(seed.rootId).toBe(Aglyn.CANVAS_ROOT_ELEMENT_ID)
    expect(mockEnsure).not.toHaveBeenCalled()
  })

  it('refuses rather than quietly creating a blank block when a starter is missing', async () => {
    Aglyn.components.unregisterPreset(HEADER)
    await expect(
      componentCreateSeed({ kind: 'email', starter: 'header' }),
    ).rejects.toThrow('The header could not be loaded')
  })
})
