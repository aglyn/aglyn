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
 * THE ANCESTOR WALKS MUST TERMINATE ON A REAL DOCUMENT.
 *
 * The document root is ITS OWN PARENT in stored screen documents:
 * `CanvasManager.processNodesToDenormalized` builds the root through
 * `denormalizeNodes([{ $id: NODE_ROOT_ID, … }], NODE_ROOT_ID)`, and
 * `denormalizeNodes` stamps the `parentId` argument onto every node it
 * writes — including the root, which therefore gets its own id. The map in
 * `SCREEN_NODES` below is the live `aglyn-marketing` Demo screen, read out of
 * `hosts/DXnRbPH4CQ/screens/tvE5P-PnLs/versions/-P4ocjKPMB`, and its root
 * carries `parentId: '_@_'` exactly as described.
 *
 * `AglynNode.parent` resolves `parentId` through the node map, so on a stored
 * document `root.parent === root`. A `while (current) { current =
 * current.parent }` walk therefore never reaches a null: it spins on the root
 * forever, synchronously, on the renderer's main thread. Chrome answers no
 * further input at all and the tab has to be closed.
 *
 * The reason no existing spec caught it is that every hand-written fixture in
 * this suite omits the root's `parentId`, which makes `parent` return
 * `undefined` and the walk terminate — the one field that decides between
 * "returns false" and "locks the browser".
 */

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import {
  createResponsiveCssVarTheme,
  createResponsiveTheme,
  ThemeProvider,
} from '@aglyn/shared-ui-theme'
import { act, render, screen } from '@testing-library/react'

import {
  isAncestorHidden,
  isAncestorHiddenOnSite,
} from '../utils/canvas-reveal'
import NodeTreeView from './node-tree-view'

const noopFactory = (() => null) as any

const theme = createResponsiveCssVarTheme(
  createResponsiveTheme({ themeOptions: { palette: { mode: 'light' } } }),
  createResponsiveTheme({ themeOptions: { palette: { mode: 'dark' } } }),
)

/**
 * How many times a walk may read `parent` before the chain is declared
 * unterminated. Deeper than any real document and far cheaper than the
 * alternative, which is a jest worker that never returns.
 */
const WALK_CEILING = 10_000

/**
 * A node whose `parent` counts its reads and throws once the walk has clearly
 * stopped making progress. A plain self-referential object would hang the
 * worker instead of failing it, and a test that hangs reports nothing.
 */
function selfParentedRoot(overrides: Record<string, unknown> = {}) {
  let reads = 0
  const root: Record<string, unknown> = { $id: Aglyn.NODE_ROOT_ID, ...overrides }
  Object.defineProperty(root, 'parent', {
    get() {
      reads += 1
      if (reads > WALK_CEILING) {
        throw new Error('ancestor walk did not terminate')
      }
      return root
    },
  })
  return root
}

/** Two nodes that parent each other — the general malformed-tree case. */
function mutuallyParentedPair() {
  let reads = 0
  const bump = () => {
    reads += 1
    if (reads > WALK_CEILING) {
      throw new Error('ancestor walk did not terminate')
    }
  }
  const a: Record<string, unknown> = { $id: 'a' }
  const b: Record<string, unknown> = { $id: 'b' }
  Object.defineProperty(a, 'parent', {
    get() {
      bump()
      return b
    },
  })
  Object.defineProperty(b, 'parent', {
    get() {
      bump()
      return a
    },
  })
  return a
}

/**
 * The live Demo screen's node map, ids and structure verbatim. Props are
 * dropped: the freeze is structural, and the ancestor chain is the whole
 * fixture. `_@_` keeps the `parentId` production stores for it.
 */
const SCREEN_NODES: Record<string, unknown> = {
  '_@_': { $id: '_@_', componentId: 'div', parentId: '_@_', nodes: ['Cq1K3ai-uQ', 'r0oU8D_Sps', '8Ir0kH2hcO'] },
  'Cq1K3ai-uQ': { $id: 'Cq1K3ai-uQ', componentId: 'section', parentId: '_@_', nodes: ['CBwtPknymL'] },
  CBwtPknymL: { $id: 'CBwtPknymL', componentId: 'muiContainer', parentId: 'Cq1K3ai-uQ', nodes: ['JLSkD3yjYY'] },
  JLSkD3yjYY: { $id: 'JLSkD3yjYY', componentId: 'muiStack', parentId: 'CBwtPknymL', nodes: ['V_LgS49w2X', '2V58GyABLE'] },
  V_LgS49w2X: { $id: 'V_LgS49w2X', componentId: 'muiStack', parentId: 'JLSkD3yjYY', nodes: ['IyzRNjsw9i', 'e3HVokZCyg', 'YzbMXW8tUr', 'KzrM9aBH7u', 'sCMdgf6fHV'] },
  IyzRNjsw9i: { $id: 'IyzRNjsw9i', componentId: 'muiTypography', parentId: 'V_LgS49w2X' },
  e3HVokZCyg: { $id: 'e3HVokZCyg', componentId: 'muiTypography', parentId: 'V_LgS49w2X' },
  YzbMXW8tUr: { $id: 'YzbMXW8tUr', componentId: 'muiTypography', parentId: 'V_LgS49w2X' },
  KzrM9aBH7u: { $id: 'KzrM9aBH7u', componentId: 'muiStack', parentId: 'V_LgS49w2X', nodes: ['aTrpCIJoZQ', '_xoYH50Lvl', 'OukrHeQM7C', 'LI9A6Row34', 'GxPI0AaDFX'] },
  aTrpCIJoZQ: { $id: 'aTrpCIJoZQ', componentId: 'muiTypography', parentId: 'KzrM9aBH7u' },
  _xoYH50Lvl: { $id: '_xoYH50Lvl', componentId: 'muiStack', parentId: 'KzrM9aBH7u', nodes: ['IjkCPwiC5m', 'fjfla6bNBA'] },
  IjkCPwiC5m: { $id: 'IjkCPwiC5m', componentId: 'icon', parentId: '_xoYH50Lvl' },
  fjfla6bNBA: { $id: 'fjfla6bNBA', componentId: 'muiTypography', parentId: '_xoYH50Lvl' },
  OukrHeQM7C: { $id: 'OukrHeQM7C', componentId: 'muiStack', parentId: 'KzrM9aBH7u', nodes: ['ER6Qz4IV_N', 'UiiQqYp8gZ'] },
  ER6Qz4IV_N: { $id: 'ER6Qz4IV_N', componentId: 'icon', parentId: 'OukrHeQM7C' },
  UiiQqYp8gZ: { $id: 'UiiQqYp8gZ', componentId: 'muiTypography', parentId: 'OukrHeQM7C' },
  LI9A6Row34: { $id: 'LI9A6Row34', componentId: 'muiStack', parentId: 'KzrM9aBH7u', nodes: ['o-FWhWjgon', 'rzNb25JyXi'] },
  'o-FWhWjgon': { $id: 'o-FWhWjgon', componentId: 'icon', parentId: 'LI9A6Row34' },
  rzNb25JyXi: { $id: 'rzNb25JyXi', componentId: 'muiTypography', parentId: 'LI9A6Row34' },
  GxPI0AaDFX: { $id: 'GxPI0AaDFX', componentId: 'muiStack', parentId: 'KzrM9aBH7u', nodes: ['zxwps9Y2FA', '95AqRKCbp0'] },
  zxwps9Y2FA: { $id: 'zxwps9Y2FA', componentId: 'icon', parentId: 'GxPI0AaDFX' },
  '95AqRKCbp0': { $id: '95AqRKCbp0', componentId: 'muiTypography', parentId: 'GxPI0AaDFX' },
  sCMdgf6fHV: { $id: 'sCMdgf6fHV', componentId: 'muiTypography', parentId: 'V_LgS49w2X' },
  '2V58GyABLE': { $id: '2V58GyABLE', componentId: 'muiStack', parentId: 'JLSkD3yjYY', nodes: ['0yPpnK3FVP', 'D80MX0hsK2'] },
  '0yPpnK3FVP': { $id: '0yPpnK3FVP', componentId: 'muiTypography', parentId: '2V58GyABLE' },
  D80MX0hsK2: { $id: 'D80MX0hsK2', componentId: 'form', parentId: '2V58GyABLE', nodes: ['XLpWHvAll_', 'B2EBgiAU_x', 'SlsPA3EP_v', 'ZFAkOr7wUI', 'M9DmeY0NBB', '_jh0VHuaO_'] },
  XLpWHvAll_: { $id: 'XLpWHvAll_', componentId: 'formField', parentId: 'D80MX0hsK2' },
  B2EBgiAU_x: { $id: 'B2EBgiAU_x', componentId: 'formField', parentId: 'D80MX0hsK2' },
  SlsPA3EP_v: { $id: 'SlsPA3EP_v', componentId: 'formField', parentId: 'D80MX0hsK2' },
  ZFAkOr7wUI: { $id: 'ZFAkOr7wUI', componentId: 'formField', parentId: 'D80MX0hsK2' },
  M9DmeY0NBB: { $id: 'M9DmeY0NBB', componentId: 'formField', parentId: 'D80MX0hsK2' },
  _jh0VHuaO_: { $id: '_jh0VHuaO_', componentId: 'formField', parentId: 'D80MX0hsK2' },
  r0oU8D_Sps: { $id: 'r0oU8D_Sps', componentId: 'section', parentId: '_@_', nodes: ['75CdilR-il'] },
  '75CdilR-il': { $id: '75CdilR-il', componentId: 'muiContainer', parentId: 'r0oU8D_Sps', nodes: ['49cLTpUIEu'] },
  '49cLTpUIEu': { $id: '49cLTpUIEu', componentId: 'muiStack', parentId: '75CdilR-il', nodes: ['ks13-200uv', 'B6uJfenF4Y'] },
  'ks13-200uv': { $id: 'ks13-200uv', componentId: 'muiStack', parentId: '49cLTpUIEu', nodes: ['eFcOcE4OBg', 'mroSmmcf6F'] },
  eFcOcE4OBg: { $id: 'eFcOcE4OBg', componentId: 'muiTypography', parentId: 'ks13-200uv' },
  mroSmmcf6F: { $id: 'mroSmmcf6F', componentId: 'muiTypography', parentId: 'ks13-200uv' },
  B6uJfenF4Y: { $id: 'B6uJfenF4Y', componentId: 'muiStack', parentId: '49cLTpUIEu', nodes: ['8aErZrJK5N', 'HTrvarjWCP', 'Wt7Y3PPahH'] },
  '8aErZrJK5N': { $id: '8aErZrJK5N', componentId: 'image', parentId: 'B6uJfenF4Y' },
  HTrvarjWCP: { $id: 'HTrvarjWCP', componentId: 'image', parentId: 'B6uJfenF4Y' },
  Wt7Y3PPahH: { $id: 'Wt7Y3PPahH', componentId: 'image', parentId: 'B6uJfenF4Y' },
  '8Ir0kH2hcO': { $id: '8Ir0kH2hcO', componentId: 'section', parentId: '_@_', nodes: ['eIW58oNMrD'] },
  eIW58oNMrD: { $id: 'eIW58oNMrD', componentId: 'muiContainer', parentId: '8Ir0kH2hcO', nodes: ['BzZFwGBhJr'] },
  BzZFwGBhJr: { $id: 'BzZFwGBhJr', componentId: 'muiStack', parentId: 'eIW58oNMrD', nodes: ['oIu32kLDZT', 'ozwSDBTI0h', 'm-MJarNUo1'] },
  oIu32kLDZT: { $id: 'oIu32kLDZT', componentId: 'muiTypography', parentId: 'BzZFwGBhJr' },
  ozwSDBTI0h: { $id: 'ozwSDBTI0h', componentId: 'muiTypography', parentId: 'BzZFwGBhJr' },
  'm-MJarNUo1': { $id: 'm-MJarNUo1', componentId: 'muiButton', parentId: 'BzZFwGBhJr' },
}

/** The screen's Form element — the node the freeze was reported against. */
const FORM_ID = 'D80MX0hsK2'

function registerSchemas() {
  for (const componentId of new Set(
    Object.values(SCREEN_NODES).map(
      (node) => (node as { componentId: string }).componentId,
    ),
  )) {
    Aglyn.components.registerComponent(noopFactory, {
      $id: componentId,
      displayName: componentId,
    } as never)
  }
}

describe('the hierarchy ancestor walk on a stored document', () => {
  beforeEach(() => {
    registerSchemas()
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes(SCREEN_NODES as never)
    Besigner.focus.clearFocusStatus()
  })
  afterEach(() => act(() => Besigner.focus.clearFocusStatus()))

  it('stores the document root as its own parent', () => {
    // The premise the rest of this file rests on, asserted rather than
    // assumed: a walk that follows `parent` from anywhere in this document
    // arrives at a node that answers with itself.
    const root = Aglyn.canvas.getNode(Aglyn.NODE_ROOT_ID)!
    expect(root.parentId).toBe(Aglyn.NODE_ROOT_ID)
    expect(root.parent?.$id).toBe(Aglyn.NODE_ROOT_ID)
  })

  it('terminates when the root parents itself', () => {
    expect(isAncestorHidden(selfParentedRoot() as never)).toBe(false)
    expect(isAncestorHiddenOnSite(selfParentedRoot() as never)).toBe(false)
  })

  it('terminates on a malformed tree whose nodes parent each other', () => {
    expect(isAncestorHidden(mutuallyParentedPair() as never)).toBe(false)
    expect(isAncestorHiddenOnSite(mutuallyParentedPair() as never)).toBe(false)
  })

  it('still reports a hidden ancestor', () => {
    const form = Aglyn.canvas.getNode(FORM_ID)!
    act(() => {
      Aglyn.canvas.updateNodeFields(form.parent!, { hidden: true } as never)
    })
    expect(isAncestorHidden(form as never)).toBe(true)
  })

  it('renders the hierarchy row of a hidden layer', () => {
    // The gesture that froze the tab: the eye on the Form element's row.
    // Rendering the row that results reads `isAncestorHidden`, which is the
    // walk under test — over the live document, where the root's `parentId`
    // makes it a loop.
    act(() => {
      Aglyn.canvas.updateNodeFields(Aglyn.canvas.getNode(FORM_ID)!, {
        hidden: true,
      } as never)
    })
    render(
      <ThemeProvider theme={theme}>
        <NodeTreeView />
      </ThemeProvider>,
    )
    act(() => {
      for (const id of ['_@_', 'Cq1K3ai-uQ', 'CBwtPknymL', 'JLSkD3yjYY', '2V58GyABLE']) {
        Besigner.focus.expandNode(Aglyn.canvas.getNode(id)!)
      }
    })
    expect(screen.getByRole('button', { name: 'Show form' })).toBeTruthy()
  })
})
