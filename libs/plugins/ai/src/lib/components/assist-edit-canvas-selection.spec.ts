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
 * What Assist is told about the canvas, measured on the besigner's own
 * machinery rather than on doubles (AGL-3114):
 *
 *  - the REAL canvas singleton, loaded the way the component editor loads a
 *    stored version;
 *  - the REAL focus manager, driven the way a Hierarchy row click and a canvas
 *    element click drive it, with the Hierarchy collapsed;
 *  - the REAL editor-session seam, registered with the getter every besigner
 *    page registers, and read the way the panel reads it when a question is
 *    sent.
 *
 * The document is the band Assist was asked about: a Section, its Container,
 * a header Stack, and a row of ten card Stacks, each holding a row of two
 * icon Stacks (a glyph and an arrow), a Screen Link and a description. Ids,
 * components and structure are the reported version's; copy is abbreviated.
 */

import { canvas, CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn'
import { definitionToCanvasTree } from '@aglyn/aglyn/app-utils/definition-canvas-tree'
import { ensureCanvasRoot } from '@aglyn/aglyn/app-utils/ensure-canvas-root'
import {
  openEditorSession,
  registerEditorSession,
  resetEditorSessionsForTests,
} from '@aglyn/aglyn/plugin-manager/editor-sessions'
import * as Besigner from '@aglyn/besigner'
import { ASSIST_EDIT_CONTEXT_MAX_NODES } from '../model/assist-edit'
import { AI_CACHE_PREFIX_TOKEN_CHARS } from '../runtime/ai-runtime'
import { editSelectionBlock, parseAssistEditContext } from '../server/assist-edit'
import { describeAssistEditCanvas } from './assist-edit-canvas'

const ROOT = CANVAS_ROOT_ELEMENT_ID
const COMPONENT_ID = 'CO49LmRG2K'
const VERSION_ID = 'a2vG-JhJj4'

/** Each card: [card, icon row, glyph stack, glyph, arrow stack, arrow, link, label, description]. */
const CARDS = [
  ['ON629_DSeU', 'nCdFFBh-Gw', 'uFQi-5H1BC', 'NbbHsi6_h_', '8nViO-2LK-', 'h444pMGcE2', 'GIM6LfuGI3', 'Besigner', 'IStRniLqsj'],
  ['B6_VPQ-fau', '2Oc765_AVY', 'cEQvnxTd_7', '12IINQDEGC', 'iHYQkR3ds_', 'p570g9rYuR', 'tskY4poi8i', 'Console', 'ybWduHAoIF'],
  ['DtsLSifJW3', '8gn4rZENeL', 'mtKDepOsXz', 'rtQin5dEw6', '6gpjeQvdOz', 'JGfwbQJNAE', 'R7nkRA842n', 'Commerce', 's8mAXzrZFL'],
  ['4-_GpfKl_P', '_15LDraRdG', 'CIO0gxudBe', 'S0o4YzfJDe', '7iTOlqZq1x', 'BI_J_xryeU', 'kgck0jj28I', 'Forms & Inbox', 'NTEVv2id76'],
  ['Htf4wZ4kYG', 'CSw4sn8Paq', 'GlXJPe-v8o', '5WhHYs3w6h', 'k0ChJqjoVM', 'j8YGuvFIAN', '3xuUajymnm', 'CRM', 'aXIJ-B6udu'],
  ['m4jBc3vTtH', 'L0xrI__okx', '4v66ChrtjG', 'RtriaIyUwr', 'qgRCqPZ0Uu', 'XruRFpJSLD', 'PswRyLALea', 'Media', 'Z5hhgwIGhr'],
  ['NBvRyVG8pH', 'lGWy_06L1c', 'XbxdyCsjKN', '3ZyiFBUJuR', 'jGAxUwF5DP', 'WKm0MSaR3G', 'H4LohuzU_1', 'Workflows', '4bv8dj6etR'],
  ['FFS1GrOItU', 'hAimMAenmT', 'OCBVo_uRM6', 'qqbbOtk7XL', '9WLJVqGVZg', 'X5jm7CuXHl', 'nlIJudJbUo', 'Plugins', '_V-vdgEtGM'],
  ['MF7k0TbHwy', '-gZl58AuOH', 'OB5tz9hu5U', 'k_e80xcFnp', 't4IhO0QL8g', 'aYAa5r-0Xc', '8hSN-z11IE', 'Analytics', 'HiHsWcwAcn'],
  ['9XUcLREo7T', 'dy92WP3yaU', 'ZCoohmeH6K', 'GfXxAJjvh8', 'KoqFnK8jGC', 'FTvVuUVpMD', 'usXglaO1F-', 'Marketing', '4AN9h3HJST'],
] as const

const [SELECTED_CARD, ICON_ROW, GLYPH_STACK, GLYPH, ARROW_STACK, ARROW, LINK, , DESCRIPTION] = CARDS[0]
/** The selection's ancestors, root first. */
const ANCESTORS = [ROOT, 'eoSwQte8ZK', 'pNVe99s0FD', 'WH4DSEVY_5', SELECTED_CARD]

interface StoredNode {
  $id: string
  componentId: string
  parentId: string | null
  nodes?: string[]
  props?: Record<string, unknown>
  sx?: Record<string, unknown>
}

/** The version as it is stored: canvas-shaped, every element keyed by its id. */
function reportedVersion(): Record<string, StoredNode> {
  const nodes: Record<string, StoredNode> = {}
  const put = (
    $id: string,
    componentId: string,
    parentId: string | null,
    children: readonly string[] = [],
    props?: Record<string, unknown>,
  ): void => {
    nodes[$id] = {
      $id,
      componentId,
      parentId,
      ...(children.length ? { nodes: [...children] } : {}),
      ...(props ? { props } : {}),
    }
  }
  put(ROOT, 'box', null, ['eoSwQte8ZK'])
  put('eoSwQte8ZK', 'section', ROOT, ['pNVe99s0FD'], {
    element: 'section',
    ariaLabel: 'Explore the platform',
  })
  put('pNVe99s0FD', 'muiContainer', 'eoSwQte8ZK', ['3mIFFfgw_z', 'WH4DSEVY_5'], { maxWidth: 'xl' })
  put('3mIFFfgw_z', 'muiStack', 'pNVe99s0FD', ['x-_avNOyba', 'MII3TLF3Xw', 'nQbJbQ2q0u'], {
    direction: 'column',
  })
  put('x-_avNOyba', 'muiTypography', '3mIFFfgw_z', [], { children: 'ONE PLATFORM' })
  put('MII3TLF3Xw', 'muiTypography', '3mIFFfgw_z', [], {
    children: '{{prop.headline}}',
    component: 'h2',
  })
  put('nQbJbQ2q0u', 'muiTypography', '3mIFFfgw_z', [], { children: '{{prop.lede}}' })
  put(
    'WH4DSEVY_5',
    'muiStack',
    'pNVe99s0FD',
    CARDS.map((card) => card[0]),
  )
  for (const [card, row, glyphStack, glyph, arrowStack, arrow, link, label, text] of CARDS) {
    put(card, 'muiStack', 'WH4DSEVY_5', [row, link, text], { direction: 'column' })
    put(row, 'muiStack', card, [glyphStack, arrowStack], { direction: 'row' })
    put(glyphStack, 'muiStack', row, [glyph], { direction: 'row' })
    put(glyph, 'icon', glyphStack, [], { iconId: 'view-grid-outline', size: 20 })
    put(arrowStack, 'muiStack', row, [arrow], { direction: 'row' })
    put(arrow, 'icon', arrowStack, [], { iconId: 'arrow-top-right', size: 20 })
    put(link, 'muiScreenLink', card, [], { children: label, renderAs: 'link' })
    put(text, 'muiTypography', card, [], { children: `What ${label} does.` })
  }
  nodes[LINK].sx = { fontWeight: 600, textDecoration: 'none' }
  return nodes
}

/**
 * The component editor's first load: `useBesignerDocument` hands the stored
 * map through the page's `toCanvasNodes` (`definitionToCanvasTree`), then
 * `setLocalNodes` denormalizes it and guarantees the root.
 */
function openVersion(): void {
  canvas.reset()
  const tree = definitionToCanvasTree({ rootId: 'eoSwQte8ZK', nodes: reportedVersion() })
  canvas.setNodes(ensureCanvasRoot(canvas.processNodesToDenormalized(tree as never)) as never)
}

/** The component page's registration, getter and all. */
function registerComponentEditor(versionId: string = VERSION_ID): () => void {
  return registerEditorSession({
    documentKind: 'component',
    documentId: COMPONENT_ID,
    versionId,
    isLiveVersion: () => false,
    selectedNodeId: () => Besigner.focus.getLastSelected()?.$id ?? null,
  })
}

/** The outline a question carries, read the way the panel reads it on send. */
function outlineOnSend() {
  const session = openEditorSession()
  const outline = describeAssistEditCanvas(canvas, session?.selectedNodeId?.() ?? null)
  if (!outline) throw new Error('the open canvas must describe its root')
  return outline
}

const node = (id: string) => {
  const found = canvas.getNode(id)
  if (!found) throw new Error(`${id} is not on the canvas`)
  return found
}

/** A Hierarchy row click: `NodeTreeView`'s select handler, minus the event. */
function clickHierarchyRow(id: string): void {
  Besigner.focus.handleNodeSelection(node(id), false)
}

/** A plain canvas click: `DraggableDroppable`'s mousedown on the leaf's own node. */
function clickCanvasElement(rendered: ReturnType<typeof node>): void {
  Besigner.focus.handleNodeSelection(rendered, false)
}

/** The rows the Hierarchy shows. */
const hierarchyRows = () => Besigner.focus.getVisibleNodeOrder().map((row) => row.$id)

/** Opens the Hierarchy down to `id`'s row, the way an author reaches it. */
function expandHierarchyTo(id: string): void {
  for (const ancestor of pathTo(id)) Besigner.focus.expandNode(node(ancestor))
}

/** Collapses every open branch, the selection's included. */
function collapseHierarchy(): void {
  for (const id of Object.keys(reportedVersion())) {
    if (Besigner.focus.isNodeEffectivelyExpanded(node(id))) {
      Besigner.focus.collapseNode(node(id))
    }
  }
}

/** The ids from the root down to `id`'s parent. */
function pathTo(id: string): string[] {
  const path: string[] = []
  let current = canvas.getNode(id)?.parentId
  while (current) {
    path.unshift(current)
    current = canvas.getNode(current)?.parentId
  }
  return path
}

/**
 * Returns the focus state to "nothing selected, nothing open". Deepest branch
 * first, so no collapse finds a descendant still open and records an override.
 */
function resetFocus(): void {
  Besigner.focus.clearFocusStatus()
  const depth = (id: string) => pathTo(id).length
  const open = [...Besigner.focus.getAllExpanded()].map((entry) => entry.$id)
  for (const id of open.sort((a, b) => depth(b) - depth(a))) {
    const branch = canvas.getNode(id)
    if (branch) Besigner.focus.collapseNode(branch)
  }
  for (const id of [...Besigner.focus.getManuallyCollapsed()]) {
    const collapsed = canvas.getNode(id)
    if (!collapsed) continue
    Besigner.focus.expandNode(collapsed)
    Besigner.focus.collapseNode(collapsed)
  }
}

let closeEditor: () => void = () => undefined

beforeEach(() => {
  resetEditorSessionsForTests()
  openVersion()
  resetFocus()
  closeEditor = registerComponentEditor()
})

afterEach(() => {
  closeEditor()
  resetFocus()
  resetEditorSessionsForTests()
  canvas.reset()
})

describe('the reported document, as the component editor holds it', () => {
  it('is whole: 88 elements, and the Screen Link’s ancestors reach the root', () => {
    expect(canvas.nodes.size).toBe(88)
    expect(pathTo(LINK)).toEqual(ANCESTORS)
  })

  it('opens with the Hierarchy collapsed: the root and its section are the only rows', () => {
    expect(hierarchyRows()).toEqual([ROOT, 'eoSwQte8ZK'])
  })
})

describe('the Screen Link selected, the Hierarchy collapsed', () => {
  function expectSelectionCarried(): void {
    const outline = outlineOnSend()
    const ids = outline.nodes.map((entry) => entry.id)
    expect(outline.selectedId).toBe(LINK)
    // The root and the ancestor chain lead, root first, then the selection.
    expect(ids.slice(0, ANCESTORS.length + 1)).toEqual([...ANCESTORS, LINK])
    // The whole card around it: the icon row, both icon stacks, both icons —
    // the arrow among them — and the description.
    expect(ids).toEqual(
      expect.arrayContaining([ICON_ROW, GLYPH_STACK, GLYPH, ARROW_STACK, ARROW, DESCRIPTION]),
    )
    // Its siblings come in full; what they hold, briefly, by place alone.
    const entry = (id: string) => outline.nodes.find((described) => described.id === id)
    expect(entry(ICON_ROW)).toMatchObject({ props: { direction: 'row' } })
    expect(entry(ICON_ROW)).not.toHaveProperty('brief')
    expect(entry(ARROW)).toMatchObject({ componentId: 'icon', parentId: ARROW_STACK, brief: true })
    expect(entry(ARROW)).not.toHaveProperty('props')
    // The selection alone carries its styles.
    expect(entry(LINK)?.sx).toEqual({ fontWeight: 600, textDecoration: 'none' })
  }

  it('a Hierarchy click: the outline carries the selection, its ancestors and its whole card', () => {
    expandHierarchyTo(LINK)
    expect(hierarchyRows()).toContain(LINK)
    clickHierarchyRow(LINK)
    collapseHierarchy()
    expect(hierarchyRows()).toEqual([ROOT, 'eoSwQte8ZK'])
    expect(Besigner.focus.getLastSelected()?.$id).toBe(LINK)
    expectSelectionCarried()
  })

  it('a canvas click: the same outline, with the Hierarchy never opened', () => {
    clickCanvasElement(node(LINK))
    collapseHierarchy()
    expect(hierarchyRows()).toEqual([ROOT, 'eoSwQte8ZK'])
    expectSelectionCarried()
  })

  it('says every other card of the row is built like the selected one, without listing their contents', () => {
    clickCanvasElement(node(LINK))
    const outline = outlineOnSend()
    const ids = outline.nodes.map((entry) => entry.id)
    for (const [card, row, , , , , link, , text] of CARDS.slice(1)) {
      expect(outline.nodes.find((entry) => entry.id === card)).toMatchObject({
        brief: true,
        like: SELECTED_CARD,
        childCount: 3,
      })
      expect(ids).not.toEqual(expect.arrayContaining([row]))
      expect(ids).not.toEqual(expect.arrayContaining([link]))
      expect(ids).not.toEqual(expect.arrayContaining([text]))
    }
  })

  it('describes in full what the outline always did, and briefly what surrounds it, each element after its parent', () => {
    clickCanvasElement(node(LINK))
    const outline = outlineOnSend()
    expect(outline.total).toBe(88)
    const inFull = outline.nodes.filter((entry) => !entry.brief).map((entry) => entry.id)
    const briefly = outline.nodes.filter((entry) => entry.brief)
    expect(inFull).toEqual([...ANCESTORS, LINK, ICON_ROW, DESCRIPTION])
    expect(briefly.map((entry) => entry.id)).toEqual([
      GLYPH_STACK,
      ARROW_STACK,
      GLYPH,
      ARROW,
      ...CARDS.slice(1).map((card) => card[0]),
      '3mIFFfgw_z',
    ])
    for (const entry of briefly) {
      expect(entry).not.toHaveProperty('props')
      expect(entry).not.toHaveProperty('sx')
    }
    const ids = outline.nodes.map((entry) => entry.id)
    outline.nodes.forEach((entry, index) => {
      if (entry.parentId) expect(ids.indexOf(entry.parentId)).toBeLessThan(index)
    })
  })

  it('tells the model what it covers, what it leaves out, and that the arrow is there', () => {
    clickCanvasElement(node(LINK))
    const context = parseAssistEditContext(JSON.parse(JSON.stringify(outlineOnSend())))
    const block = editSelectionBlock(context!)
    expect(block).toContain(`Selected element: "${LINK}" (muiScreenLink).`)
    expect(block).toContain('22 of its 88 elements')
    expect(block).toContain(`{"id":"${ARROW}","component":"icon","parent":"${ARROW_STACK}","children":0}`)
    // The other nine cards, on one line, as built like the selected one.
    expect(block).toContain(
      JSON.stringify({
        ids: CARDS.slice(1).map((card) => card[0]),
        component: 'muiStack',
        parent: 'WH4DSEVY_5',
        like: SELECTED_CARD,
      }),
    )
    // The header beside the row, by place alone, saying it holds more.
    expect(block).toContain('{"id":"3mIFFfgw_z","component":"muiStack","parent":"pNVe99s0FD","children":3,"more":3}')
    expect(block).not.toContain(`"id":"${CARDS[9][4]}"`)
  })

  it('a selected card: the other cards are its siblings, in full and like it, their contents left out', () => {
    clickCanvasElement(node(SELECTED_CARD))
    const outline = outlineOnSend()
    const ids = outline.nodes.map((entry) => entry.id)
    // Everything inside the selected card, in full.
    expect(ids).toEqual(
      expect.arrayContaining([ICON_ROW, GLYPH_STACK, GLYPH, ARROW_STACK, ARROW, LINK, DESCRIPTION]),
    )
    for (const [card, , , , , , link] of CARDS.slice(1)) {
      const sibling = outline.nodes.find((entry) => entry.id === card)
      expect(sibling).toMatchObject({ like: SELECTED_CARD, props: { direction: 'column' } })
      expect(sibling).not.toHaveProperty('brief')
      expect(ids).not.toContain(link)
    }
    expect(outline.nodes).toHaveLength(22)
  })
})

describe('the block the model reads for the reported document', () => {
  function measure(selectedId: string | null) {
    closeEditor()
    closeEditor = registerEditorSession({
      documentKind: 'component',
      documentId: COMPONENT_ID,
      versionId: VERSION_ID,
      isLiveVersion: () => false,
      selectedNodeId: () => selectedId,
    })
    const block = editSelectionBlock(
      parseAssistEditContext(JSON.parse(JSON.stringify(outlineOnSend())))!,
    )
    return { chars: block.length, tokens: Math.round(block.length / AI_CACHE_PREFIX_TOKEN_CHARS) }
  }

  it('holds its size, selected and with nothing selected', () => {
    // Priced like the cache ledger: a change that cuts this block moves a
    // number DOWN and says so in its commit, and one that grows it without
    // meaning to moves it UP and is red here. For this document the outline
    // before AGL-3114 was 2,412 characters with the link selected and 796
    // with nothing selected; describing the whole cap in full was 9,768.
    //
    // Up 155 characters at AGL-3156, meant: the node capabilities are named
    // here, once for every element, because this is the only door an author
    // can use them from — a repeat's bounds need a node that already repeats.
    // This block is the volatile turn rather than a cached prefix, so the 39
    // tokens are paid on an edit the author asked for and on nothing else;
    // the surface catalogs, which every pass of every generation job carries,
    // are deliberately unchanged.
    //
    // Up 93 and 62 characters at AGL-3284, meant: the palette lists Color
    // scheme among the layout elements' settings, so pinning a band light or
    // dark is an edit the assistant can make like any other setting.
    expect({ selected: measure(LINK), nothingSelected: measure(null) }).toEqual({
      selected: { chars: 4_118, tokens: 1_030 },
      nothingSelected: { chars: 1_750, tokens: 438 },
    })
  })
})

describe('a new selection reaches the next question', () => {
  it('another card’s link, clicked on the canvas, replaces the first', () => {
    clickHierarchyRow(LINK)
    expect(outlineOnSend().selectedId).toBe(LINK)
    const consoleLink = CARDS[1][6]
    clickCanvasElement(node(consoleLink))
    const outline = outlineOnSend()
    expect(outline.selectedId).toBe(consoleLink)
    expect(outline.nodes.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([CARDS[1][0], CARDS[1][5]]),
    )
  })

  it('a version switch clears it, and the outline then says nothing is selected', () => {
    clickHierarchyRow(LINK)
    // What the page does when another version opens: unregister, reset the
    // canvas and the focus, then load and register the new one.
    closeEditor()
    canvas.reset()
    Besigner.focus.clearFocusStatus()
    openVersion()
    closeEditor = registerComponentEditor('new-version')
    const outline = outlineOnSend()
    expect(outline.selectedId).toBeNull()
    expect(outline.nodes.map((entry) => entry.id)).toEqual([ROOT, 'eoSwQte8ZK', 'pNVe99s0FD'])
    expect(outline.total).toBe(88)
    const block = editSelectionBlock(parseAssistEditContext(JSON.parse(JSON.stringify(outline)))!)
    expect(block).toContain('Nothing is selected.')
    expect(block).toContain('3 of its 88 elements')
    // Selecting again on the new version is what the next question carries.
    clickCanvasElement(node(LINK))
    expect(outlineOnSend().selectedId).toBe(LINK)
  })
})

describe('on a page of several sections', () => {
  const cards = Array.from({ length: 30 }, (_, index) => `card${index}`)

  /** A hero, a band of thirty two-line cards, and a footer: 99 elements. */
  function openPage(): void {
    const nodes: Record<string, StoredNode> = {
      [ROOT]: { $id: ROOT, componentId: 'div', parentId: null, nodes: ['hero', 'band', 'footer'] },
      hero: { $id: 'hero', componentId: 'section', parentId: ROOT, nodes: ['headline', 'lede', 'cta'] },
      headline: { $id: 'headline', componentId: 'muiTypography', parentId: 'hero' },
      lede: { $id: 'lede', componentId: 'muiTypography', parentId: 'hero' },
      cta: { $id: 'cta', componentId: 'muiButton', parentId: 'hero' },
      band: { $id: 'band', componentId: 'section', parentId: ROOT, nodes: cards },
      footer: { $id: 'footer', componentId: 'section', parentId: ROOT, nodes: ['links', 'legal'] },
      links: { $id: 'links', componentId: 'muiStack', parentId: 'footer' },
      legal: { $id: 'legal', componentId: 'muiTypography', parentId: 'footer' },
    }
    for (const card of cards) {
      nodes[card] = {
        $id: card,
        componentId: 'muiStack',
        parentId: 'band',
        nodes: [`${card}-title`, `${card}-body`],
      }
      nodes[`${card}-title`] = { $id: `${card}-title`, componentId: 'muiTypography', parentId: card }
      nodes[`${card}-body`] = { $id: `${card}-body`, componentId: 'muiTypography', parentId: card }
    }
    canvas.reset()
    canvas.setNodes(nodes as never)
  }

  it('names every other section, and never spends the outline on their content', () => {
    openPage()
    clickCanvasElement(node('lede'))
    const outline = outlineOnSend()
    expect(outline.nodes.map((entry) => entry.id)).toEqual([
      ROOT,
      'hero',
      'lede',
      'band',
      'footer',
      'headline',
      'cta',
    ])
    expect(outline.total).toBe(99)
  })

  it('names the sections, then describes everything inside the selection before anything around it', () => {
    openPage()
    clickCanvasElement(node('band'))
    const ids = outlineOnSend().nodes.map((entry) => entry.id)
    expect(ids.slice(0, 4)).toEqual([ROOT, 'band', 'hero', 'footer'])
    expect(ids.slice(4, 4 + cards.length)).toEqual(cards)
    expect(ids).toHaveLength(ASSIST_EDIT_CONTEXT_MAX_NODES)
    expect(ids).not.toContain('headline')
  })

  it('a nested selection’s own content, however deep, comes before a sibling’s', () => {
    // One section holding an aside and a main column: ten rows of two cells
    // of two lines each, three levels deep, 70 elements under the selection.
    const nodes: Record<string, StoredNode> = {
      [ROOT]: { $id: ROOT, componentId: 'div', parentId: null, nodes: ['page'] },
      page: { $id: 'page', componentId: 'section', parentId: ROOT, nodes: ['aside', 'main'] },
      aside: { $id: 'aside', componentId: 'muiStack', parentId: 'page' },
      main: { $id: 'main', componentId: 'muiStack', parentId: 'page', nodes: [] },
    }
    for (let row = 0; row < 10; row += 1) {
      nodes['main'].nodes?.push(`r${row}`)
      nodes[`r${row}`] = { $id: `r${row}`, componentId: 'muiStack', parentId: 'main', nodes: [] }
      for (let cell = 0; cell < 2; cell += 1) {
        const id = `r${row}c${cell}`
        nodes[`r${row}`].nodes?.push(id)
        nodes[id] = { $id: id, componentId: 'muiStack', parentId: `r${row}`, nodes: [`${id}a`, `${id}b`] }
        nodes[`${id}a`] = { $id: `${id}a`, componentId: 'muiTypography', parentId: id }
        nodes[`${id}b`] = { $id: `${id}b`, componentId: 'muiTypography', parentId: id }
      }
    }
    canvas.reset()
    canvas.setNodes(nodes as never)
    clickCanvasElement(node('main'))
    const ids = outlineOnSend().nodes.map((entry) => entry.id)
    expect(ids).toHaveLength(ASSIST_EDIT_CONTEXT_MAX_NODES)
    expect(ids).not.toContain('aside')
    expect(ids.filter((id) => /^r\dc\d$/.test(id))).toHaveLength(20)
  })
})
