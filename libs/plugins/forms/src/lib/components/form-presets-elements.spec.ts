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
 * THE FORMS PRESETS PLACE MUI'S SEPARATE FORM ELEMENTS, NEVER A FORM FIELD.
 *
 * Every piece of a field is its own Besigner element, so the Add Element
 * picker offers no all-in-one Form Field, and the Contact Form, the Contact
 * Section and Marketing consent build their fields from Form Control, Form
 * Label, Input and Checkbox — still declaring the same names, so the
 * submissions, the CRM mapping and the consent check see what they always did.
 */

import * as Aglyn from '@aglyn/aglyn'
import { FORM_FIELD_ID, formBlockPresets, formPresets } from './form'

type PresetNode = {
  $id?: string | null
  componentId?: string
  pluginId?: string
  props?: Record<string, unknown>
  nodes?: PresetNode[]
}

/** A preset's nested data as a stored flat map, ids minted in walk order. */
function flatten(root: PresetNode): { rootId: string; nodes: Record<string, Aglyn.AglynNodeSchema> } {
  const nodes: Record<string, Aglyn.AglynNodeSchema> = {}
  let next = 0
  const visit = (node: PresetNode, parentId: string | null): string => {
    const id = `n${next++}`
    nodes[id] = { $id: id, componentId: node.componentId, pluginId: node.pluginId, parentId, props: node.props ?? {}, nodes: [] } as never
    ;(nodes[id] as { nodes: string[] }).nodes = (node.nodes ?? []).map((child) => visit(child, id))
    return id
  }
  return { rootId: visit(root, null), nodes }
}

const all = [...formPresets, ...formBlockPresets]
const byName = (name: string) => {
  const preset = all.find((one) => one.displayName === name)
  if (!preset) throw new Error(`no preset "${name}"`)
  return preset
}

describe('the forms presets', () => {
  it('offers no all-in-one Form Field, and places none', () => {
    expect(all.map((preset) => preset.displayName)).not.toContain('Form Field')
    for (const preset of all) {
      expect(JSON.stringify(preset.data)).not.toContain(`"componentId":"${FORM_FIELD_ID}"`)
    }
  })

  it.each(['Contact Form', 'Contact Section'])('%s declares name, email and message, all required', (name) => {
    const { nodes } = flatten(byName(name).data as PresetNode)
    const formId = Object.keys(nodes).find((id) => nodes[id]?.componentId === 'form') as string
    expect(Aglyn.formFieldDeclsFromNodes(nodes, formId)).toEqual([
      { fieldName: 'name', fieldType: 'text', label: 'Name', required: true },
      { fieldName: 'email', fieldType: 'email', label: 'Email', required: true },
      { fieldName: 'message', fieldType: 'textarea', label: 'Message', required: true },
    ])
  })

  it('Marketing consent is a lone unticked checkbox the consent check reads', () => {
    const data = byName('Marketing consent').data as PresetNode
    expect(data.componentId).toBe('muiFormControl')
    const { nodes, rootId } = flatten({ componentId: 'form', pluginId: 'forms', nodes: [data] })
    const fields = Aglyn.formFieldDeclsFromNodes(nodes, rootId)
    expect(fields).toEqual([
      {
        fieldName: Aglyn.MARKETING_CONSENT_FORM_FIELD.fieldName,
        fieldType: 'checkbox',
        label: Aglyn.MARKETING_CONSENT_FORM_FIELD.options,
        options: [Aglyn.MARKETING_CONSENT_FORM_FIELD.options],
      },
    ])
    expect(Aglyn.formFieldsCaptureConsent(fields, Aglyn.MARKETING_CONSENT_FORM_FIELD.fieldName)).toBe(true)
  })

  it('stamps every field element with mui, the bundle that registers it', () => {
    const elementIds = new Set<string>(Object.values(Aglyn.FORM_INPUT_ELEMENT_IDS))
    for (const preset of all) {
      const visit = (node: PresetNode) => {
        if (elementIds.has(String(node.componentId))) expect(node.pluginId).toBe('mui')
        expect(node.$id ?? null).toBeNull()
        node.nodes?.forEach(visit)
      }
      visit(preset.data as PresetNode)
    }
  })
})
