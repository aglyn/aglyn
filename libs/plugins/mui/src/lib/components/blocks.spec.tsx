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
import { formFieldSchema, formSchema } from './form'
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
    formSchema,
    formFieldSchema,
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
      'Contact Section',
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
        // muiToolbar is LIMIT_TO muiAppBar; formField belongs to form.
        if (node.componentId === toolbar.$id) {
          expect(parent?.componentId).toBe(appBar.$id)
        }
        if (node.componentId === formFieldSchema.$id) {
          expect(parent?.componentId).toBe(formSchema.$id)
        }
      })
    }
  })

  it('gives the contact section the starter-template field set', () => {
    const contact = blockPresets.find(
      (preset) => preset.displayName === 'Contact Section',
    )
    const fieldNames: string[] = []
    walk(contact?.data as PresetNode, (node) => {
      if (node.componentId === formFieldSchema.$id) {
        fieldNames.push((node as any).props?.fieldName)
      }
    })
    expect(fieldNames).toEqual(['name', 'email', 'message'])
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
