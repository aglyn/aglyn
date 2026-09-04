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
import { schema as appBar } from './app-bar'
import {
  blockPresets,
  socialLinksSchema,
  videoEmbedSchema,
} from './blocks'
import { schema as button } from './button'
import { schema as container } from './container'
import { schema as icon } from './icon'
import { schema as image } from './image'
import { schema as screenLink } from './screen-link'
import { schema as section } from './section'
import { schema as stack } from './stack'
import { schema as toolbar } from './toolbar'
import { schema as typography } from './typography'

/** Every component id a block preset is allowed to reference. */
const REGISTERED_COMPONENT_IDS = new Set(
  [
    appBar,
    button,
    container,
    icon,
    image,
    screenLink,
    section,
    socialLinksSchema,
    stack,
    toolbar,
    typography,
    videoEmbedSchema,
  ].map((schema) => schema.$id),
)

type PresetNode = {
  componentId?: string
  pluginId?: string
  nodes?: PresetNode[]
}

const walk = (
  node: PresetNode,
  visit: (node: PresetNode, parent: PresetNode | null) => void,
  parent: PresetNode | null = null,
) => {
  visit(node, parent)
  for (const child of node.nodes ?? []) walk(child, visit, node)
}

/** Section & block library presets (AGL-538/AGL-539). */
describe('mui block presets', () => {
  it('has a unique $id per preset', () => {
    const ids = blockPresets.map((preset) => preset.$id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('includes the composed page sections a real site needs (AGL-539)', () => {
    const names = blockPresets.map((preset) => preset.displayName)
    for (const expected of [
      'Nav Bar',
      'Hero',
      'Feature Grid',
      'Image + Text',
      'Call to Action',
      'Footer',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('files every composed section under Sections & Blocks (AGL-538)', () => {
    for (const preset of blockPresets) {
      // Leaf embeds (Video, Social Links) keep their element category;
      // everything composed is library material.
      const composed = (preset.data?.nodes?.length ?? 0) > 0
      if (composed) {
        expect({
          preset: preset.displayName,
          category: preset.category,
        }).toEqual({
          preset: preset.displayName,
          category: Aglyn.ComponentCategory.BLOCKS,
        })
      }
    }
  })

  it('references only registered, persisted component ids', () => {
    for (const preset of blockPresets) {
      walk(preset.data as PresetNode, (node) => {
        expect(REGISTERED_COMPONENT_IDS.has(node.componentId as string)).toBe(
          true,
        )
        // Grafted nodes must carry the owning bundle for compose/lookup.
        expect(node.pluginId).toBe('mui')
      })
    }
  })

  it('never pre-assigns node ids (fresh ids are minted at insertion)', () => {
    for (const preset of blockPresets) {
      walk(preset.data as PresetNode, (node) => {
        expect((node as { $id?: string | null }).$id ?? null).toBeNull()
      })
    }
  })

  it('honors parent placement constraints inside every subtree', () => {
    for (const preset of blockPresets) {
      walk(preset.data as PresetNode, (node, parent) => {
        // muiToolbar is LIMIT_TO muiAppBar.
        if (node.componentId === toolbar.$id) {
          expect(parent?.componentId).toBe(appBar.$id)
        }
      })
    }
  })

  /**
   * Inserting a preset must land its styling where the Styles panel can
   * reach it (AGL-1346) — on the node's own `sx`, not in `props.sx`. Both
   * records render, so this is invisible on the canvas and only shows up
   * when an author tries to change the value: before this, inserting a
   * section authored padding no click could ever remove.
   *
   * Driven through the canvas rather than read off the literal, because
   * insertion is where the shape has to survive: `addNodeFromPreset`
   * duplicates, denormalizes and re-instantiates every node in the
   * subtree, and `AglynNode` DROPS top-level fields it does not name.
   */
  it('inserts its styling onto node.sx, where the panel can edit it', () => {
    const canvas = new Aglyn.CanvasManager(undefined as any)
    canvas.setNodes({
      [Aglyn.NODE_ROOT_ID]: {
        $id: Aglyn.NODE_ROOT_ID,
        type: Aglyn.NodeType.NODE,
        componentId: 'div',
        nodes: [],
      },
    } as any)
    const hero = blockPresets.find((preset) => preset.displayName === 'Hero')
    const inserted = canvas.addNodeFromPreset(
      hero as any,
      canvas.getNode(Aglyn.NODE_ROOT_ID)!,
    )

    // Spelled as the longhands the Styles panel's Padding control is named
    // for (AGL-2207): with `py`/`px` the hero's band padding rendered and
    // the control read empty, and clearing it did nothing.
    // The BAND keeps the page padding; alignment and spacing moved inside
    // the Container with the content they arrange (AGL-2544).
    const heroSx = {
      paddingTop: 10,
      paddingBottom: 10,
      paddingLeft: 4,
      paddingRight: 4,
    }
    expect(inserted.sx).toEqual(heroSx)
    // …and it survives the save boundary, which omits an empty sx.
    const saved = (canvas.toJSON().nodes as Record<string, any>)[inserted.$id]
    expect(saved.sx).toEqual(heroSx)
    expect(saved.props?.sx).toBeUndefined()
  })

  it('holds every section block to a container, not the viewport (AGL-2544)', () => {
    /*
      The defect these presets shipped with: `ADD ELEMENT` dropped a bare
      Stack straight into `Document`, so a Feature Grid ran the full 1568px
      while the page's prose sat at 900px, and the FAQ — which had a
      `maxWidth` but no auto margins — rendered hard against the left edge.
      That was the documented happy path on a fresh screen, with no misuse.

      Asserting the CONTAINER rather than a measured width, because the
      width is the container's business and will change; what must not
      regress is that a section block brings one at all.
    */
    for (const name of ['Hero', 'Feature Grid', 'FAQ', 'Call to Action']) {
      const preset = blockPresets.find((p) => p.displayName === name)
      expect(preset).toBeTruthy()
      const band = preset!.data as PresetNode
      const container = (band.nodes ?? [])[0] as PresetNode
      expect(container?.componentId).toBe('muiContainer')
      expect((container as any)?.props?.maxWidth).toBeTruthy()
      // The band itself must NOT be the constrained thing: a CTA's accent
      // band and a hero's background are full-bleed on purpose, and
      // wrapping the outer node would have bought the width by losing that.
      expect((band as any).sx?.maxWidth).toBeUndefined()
    }
  })

  it('keeps a row block a row after the container is inserted (AGL-2544)', () => {
    // Dropping a Container between a `direction: row` Stack and its columns
    // would leave the Container as the single flex child, and three side-by-
    // side features would stack vertically. The direction has to travel
    // inward with them.
    const grid = blockPresets.find((p) => p.displayName === 'Feature Grid')
    const container = ((grid!.data as PresetNode).nodes ?? [])[0] as PresetNode
    const row = (container.nodes ?? [])[0] as PresetNode
    expect((row as any).props?.direction).toBe('row')
    expect((row as any).sx?.flexWrap).toBe('wrap')
    expect((row.nodes ?? []).length).toBe(3)
    expect((grid!.data as any).props?.direction).toBeUndefined()
  })

  it('never authors a props.sx anywhere in a subtree (AGL-1346)', () => {
    // The bundle-wide guard lives in plugin.spec; this one keeps the
    // section library — the presets that carry the most styling — honest
    // in the file where they are written.
    for (const preset of blockPresets) {
      walk(preset.data as PresetNode, (node) => {
        expect((node as any).props ?? {}).not.toHaveProperty('sx')
      })
    }
  })

  it('keeps the nav bar in page flow with brand and screen links', () => {
    const navBar = blockPresets.find(
      (preset) => preset.displayName === 'Nav Bar',
    )
    expect(navBar?.data?.componentId).toBe(appBar.$id)
    expect((navBar?.data as any)?.props?.position).toBe('static')
    let links = 0
    walk(navBar?.data as PresetNode, (node) => {
      if (node.componentId === screenLink.$id) links += 1
    })
    expect(links).toBeGreaterThanOrEqual(2)
  })
})
