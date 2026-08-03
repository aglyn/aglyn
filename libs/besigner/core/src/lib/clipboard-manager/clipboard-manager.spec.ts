/**
 * @jest-environment jsdom
 */
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
import {
  CLIPBOARD_FORMAT_VERSION,
  CLIPBOARD_STORAGE_KEY,
  clear,
  copyNodes,
  getEntry,
  getLabels,
  hasContent,
  pasteInto,
} from './clipboard-manager'

const STACK = 'muiStack'
const LINK = 'muiScreenLink'
const EMAIL_ONLY = 'emailButton'

/** The nav's "Product" column: a Stack holding two Screen Links. */
const seedCanvas = () => {
  Aglyn.canvas.reset()
  Aglyn.canvas.setNodes({
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      type: 'node',
      parentId: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: ['column', 'other-column'],
    },
    column: {
      $id: 'column',
      type: 'node',
      parentId: Aglyn.NODE_ROOT_ID,
      componentId: STACK,
      props: {},
      sx: {},
      nodes: ['link-a', 'link-b'],
    },
    'link-a': {
      $id: 'link-a',
      type: 'node',
      parentId: 'column',
      componentId: LINK,
      props: { children: 'Besigner' },
      sx: {},
      nodes: [],
    },
    'link-b': {
      $id: 'link-b',
      type: 'node',
      parentId: 'column',
      componentId: LINK,
      props: { children: 'Console' },
      sx: {},
      nodes: [],
    },
    'other-column': {
      $id: 'other-column',
      type: 'node',
      parentId: Aglyn.NODE_ROOT_ID,
      componentId: STACK,
      props: {},
      sx: {},
      nodes: [],
    },
  } as any)
}

describe('clipboard-manager — besigner element clipboard (AGL-1202)', () => {
  beforeAll(() => {
    Aglyn.components.registerComponent((() => null) as any, {
      $id: STACK,
      pluginId: 'test-plugin',
      displayName: 'Stack',
    } as any)
    // A Screen Link renders its children as inline text, so it is a LEAF:
    // `resolveInsertTarget` must place a paste beside it, not inside it.
    Aglyn.components.registerComponent((() => null) as any, {
      $id: LINK,
      pluginId: 'test-plugin',
      displayName: 'Screen Link',
      flags: { textEditable: Aglyn.FEATURE_FLAG.ENABLED },
    } as any)
  })

  afterAll(() => {
    for (const id of [STACK, LINK]) Aglyn.components.unregisterComponent(id)
    Aglyn.canvas.reset()
  })

  beforeEach(() => {
    window.localStorage.clear()
    clear()
    seedCanvas()
  })

  it('copies a subtree and reports it as pasteable', () => {
    expect(hasContent()).toBe(false)

    const copied = copyNodes([Aglyn.canvas.getNode('column')!])

    expect(copied).toBe(1)
    expect(hasContent()).toBe(true)
    expect(getLabels()).toHaveLength(1)
    // The stored clipping is detached: no ids from the source canvas.
    const entry = getEntry()!
    expect(entry.nodes[0]).not.toHaveProperty('$id')
    expect(entry.nodes[0].nodes?.[0]).not.toHaveProperty('$id')
    expect(entry.nodes[0].nodes).toHaveLength(2)
  })

  it('pastes into another container with fresh ids, leaving the source intact', () => {
    copyNodes([Aglyn.canvas.getNode('column')!])

    const result = pasteInto(Aglyn.canvas.getNode('other-column')!)

    expect(result.error).toBeUndefined()
    expect(result.nodes).toHaveLength(1)
    const pasted = result.nodes[0]
    expect(pasted.$id).not.toBe('column')
    expect(pasted.parentId).toBe('other-column')
    expect(Aglyn.canvas.getNode('other-column')!.nodes).toEqual([pasted.$id])
    // Two links came along, and they are copies rather than the originals.
    expect(pasted.nodes).toHaveLength(2)
    expect(pasted.nodes).not.toContain('link-a')
    expect(
      pasted.nodes!.map((id: string) => Aglyn.canvas.getNode(id)?.props.children),
    ).toEqual(['Besigner', 'Console'])
    // The source column is untouched.
    expect(Aglyn.canvas.getNode('column')!.nodes).toEqual(['link-a', 'link-b'])
  })

  it('pastes as the next sibling when the target is a leaf', () => {
    copyNodes([Aglyn.canvas.getNode('link-a')!])

    // link-a has no children slot, so the copy lands beside it, not inside.
    const result = pasteInto(Aglyn.canvas.getNode('link-a')!)

    expect(result.error).toBeUndefined()
    expect(Aglyn.canvas.getNode('column')!.nodes).toEqual([
      'link-a',
      result.nodes[0].$id,
      'link-b',
    ])
  })

  it('copies a multi-selection without duplicating nested members', () => {
    // The column AND one of its own links: the link is already inside the
    // column's clipping, so copying it again would paste it twice.
    const copied = copyNodes([
      Aglyn.canvas.getNode('column')!,
      Aglyn.canvas.getNode('link-a')!,
    ])

    expect(copied).toBe(1)
    expect(getEntry()!.nodes).toHaveLength(1)
  })

  it('keeps document order across a multi-element paste', () => {
    copyNodes([
      Aglyn.canvas.getNode('link-a')!,
      Aglyn.canvas.getNode('link-b')!,
    ])

    const result = pasteInto(Aglyn.canvas.getNode('other-column')!)

    expect(
      result.nodes.map((node) => node.props.children),
    ).toEqual(['Besigner', 'Console'])
  })

  it('refuses to copy the document root', () => {
    expect(copyNodes([Aglyn.canvas.getNode(Aglyn.NODE_ROOT_ID)!])).toBe(0)
    expect(hasContent()).toBe(false)
  })

  it('rejects a paste whose element is not registered in this app', () => {
    copyNodes([Aglyn.canvas.getNode('column')!])
    // Simulate the cross-surface case: a clipping copied in the email
    // besigner, pasted into a site document that has no such element.
    const entry = getEntry()!
    entry.nodes[0].nodes![0].componentId = EMAIL_ONLY as any

    const before = Aglyn.canvas.nodes.size
    const result = pasteInto(Aglyn.canvas.getNode('other-column')!)

    expect(result.error).toContain(EMAIL_ONLY)
    expect(result.nodes).toHaveLength(0)
    // Nothing was written — a rejected paste is all-or-nothing.
    expect(Aglyn.canvas.nodes.size).toBe(before)
    expect(Aglyn.canvas.getNode('other-column')!.nodes).toEqual([])
  })

  it('reports an empty clipboard instead of throwing', () => {
    const result = pasteInto(Aglyn.canvas.getNode('other-column')!)
    expect(result.error).toBe('Nothing to paste')
    expect(result.nodes).toHaveLength(0)
  })

  describe('surviving a navigation to another document', () => {
    it('mirrors the entry into localStorage and hydrates from it', () => {
      copyNodes([Aglyn.canvas.getNode('column')!])

      const raw = window.localStorage.getItem(CLIPBOARD_STORAGE_KEY)
      expect(raw).toBeTruthy()
      expect(JSON.parse(raw!).version).toBe(CLIPBOARD_FORMAT_VERSION)

      // A fresh document: in-memory state is gone, the mirror is not.
      clear()
      window.localStorage.setItem(CLIPBOARD_STORAGE_KEY, raw!)
      jest.resetModules()

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const reloaded = require('./clipboard-manager')
      expect(reloaded.hasContent()).toBe(true)
      expect(reloaded.getEntry().nodes).toHaveLength(1)
    })

    it('ignores a mirrored entry written by an older format', () => {
      window.localStorage.setItem(
        CLIPBOARD_STORAGE_KEY,
        JSON.stringify({ version: 0, labels: ['Stack'], nodes: [{}] }),
      )
      jest.resetModules()

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const reloaded = require('./clipboard-manager')
      expect(reloaded.hasContent()).toBe(false)
    })

    it('ignores mirrored junk rather than throwing', () => {
      window.localStorage.setItem(CLIPBOARD_STORAGE_KEY, 'not json')
      jest.resetModules()

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const reloaded = require('./clipboard-manager')
      expect(reloaded.hasContent()).toBe(false)
    })
  })
})
