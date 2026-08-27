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

import type { MdiIconProps } from '../types/nodes'
import { makeAutoObservable, toJS } from 'mobx'
import { computedFn } from 'mobx-utils'
import type { Aglyn } from '../aglyn'
import { lifecycleEvent } from '../lifecycle'
import { COMPONENT_CATEGORY_ORDER, createIdUrlSafe } from '../foundation'
import { AglynEvent } from '../emit-manager'
import type { PluginId } from '../plugin-manager'
import {
  ComponentCategory,
  type ComponentFactory,
  type ComponentId,
  type ComponentSchema,
  type NodeSchemaNested,
  NodeType,
  type PresetId,
  type PresetInteractionSchema,
  type PresetSchema,
  type SchemasByCategory,
} from '../types/nodes'

export class AglynPreset<P = JSX.AnyProps> implements PresetSchema<P> {
  public $id: PresetId
  public type: NodeType.PRESET = NodeType.PRESET
  public category: string | ComponentCategory
  public data: NodeSchemaNested<P>
  public description: string
  public displayName: string
  public icon: MdiIconProps
  public pluginId: PluginId
  public interactionTemplates?: PresetInteractionSchema[]
  public tags?: string[]
  public keywords?: string[]

  constructor(schema: PresetSchema<P>) {
    // Copy EVERY field the schema carries. This was a field-by-field
    // assignment, which meant registration held an opinion about which
    // fields exist: anything added to `PresetSchema` afterwards was dropped
    // silently between registration and the drawer's resolved option, with
    // nothing failing. It had already cost `interactions` once (AGL-589),
    // which needed a line of its own — and a line of its own is exactly what
    // the next field would have needed too (AGL-2486).
    Object.assign(this, schema)

    // The invariants registration DOES own, applied after the copy so a
    // malformed schema cannot talk its way past them.
    this.type = NodeType.PRESET
    this.category = schema.category || ComponentCategory.UNCATEGORIZED

    makeAutoObservable(this)
  }
}

export class ComponentManager {
  public factories: Record<ComponentId, ComponentFactory> = {}
  public schemas: Record<ComponentId, ComponentSchema<any>> = {}
  public presets: Record<PresetId, PresetSchema<any>> = {}

  constructor(protected aglyn?: Aglyn) {
    makeAutoObservable(this)
  }

  public get schemasByCategory(): SchemasByCategory {
    const schemas: SchemasByCategory = {}
    const setSchema = (schema: ComponentSchema<any> | PresetSchema<any>) => {
      const category = schema.category || ComponentCategory.UNCATEGORIZED
      ;(schemas[category] ??= []).push(schema)
      // ;(schemas[ComponentCategory.ALL] ??= []).push(schema)
    }
    // Object.values(this.schemas).forEach(setSchema)
    Object.values(this.presets).forEach(setSchema)
    return schemas
  }

  public get schemasBySortedCategories() {
    // Explicit display rank (AGL-538): curated categories first in a
    // deliberate order (Sections & Blocks on top), plugin-registered
    // categories after them alphabetically, Uncategorized/All last.
    const rankOf = (label: string): number => {
      switch (label) {
        case ComponentCategory.UNCATEGORIZED:
          return COMPONENT_CATEGORY_ORDER.length + 1
        case ComponentCategory.ALL:
          return COMPONENT_CATEGORY_ORDER.length + 2
        default: {
          const rank = COMPONENT_CATEGORY_ORDER.indexOf(label)
          return rank === -1 ? COMPONENT_CATEGORY_ORDER.length : rank
        }
      }
    }
    return Object.entries(this.schemasByCategory)
      .map(([k, v]) => ({
        $id: k,
        label: k,
        items: v,
      }))
      .sort(
        ({ label: a }, { label: b }) =>
          rankOf(a) - rankOf(b) || a.localeCompare(b),
      )
  }

  public getFactory = computedFn((id: ComponentId) => {
    return this.factories[id]
  })
  public getSchema = computedFn((id: ComponentId) => {
    return this.schemas[id]
  })
  public getPreset = computedFn((id: PresetId) => {
    return this.presets[id]
  })
  public getLabel = computedFn((id: ComponentId) => {
    const schema = this.schemas[id]
    return schema?.displayName || schema?.title || schema?.$id
  })

  public registerComponent(
    component: ComponentFactory,
    schema: ComponentSchema,
  ) {
    lifecycleEvent(
      () => {
        this.factories[schema.$id] = component
        this.schemas[schema.$id] = schema
      },
      {
        beforeEvent: AglynEvent.COMPONENT_REGISTERING,
        beforePayload: [{ $id: schema.$id, pluginId: schema.pluginId }],
        afterEvent: AglynEvent.COMPONENT_REGISTERED,
        afterPayload: [{ $id: schema.$id, pluginId: schema.pluginId }],
      },
    )
  }
  public unregisterComponent(id: ComponentId) {
    lifecycleEvent(
      () => {
        delete this.factories[id]
        delete this.schemas[id]
      },
      {
        beforeEvent: AglynEvent.COMPONENT_UNREGISTERING,
        beforePayload: [{ componentId: id }],
        afterEvent: AglynEvent.COMPONENT_UNREGISTERED,
        afterPayload: [{ componentId: id }],
      },
    )
  }
  public registerPreset(presets: PresetSchema[] | PresetSchema) {
    if (!presets) return
    const arr = Array.isArray(presets) ? presets : [presets]

    for (const preset of arr) {
      const $id = (preset.$id ||= createIdUrlSafe())
      lifecycleEvent(
        () => {
          this.presets[$id] = new AglynPreset(preset)
        },
        {
          beforeEvent: AglynEvent.PRESET_REGISTERING,
          beforePayload: [{ preset: toJS(preset) }],
          afterEvent: AglynEvent.PRESET_REGISTERED,
          afterPayload: [{ preset: toJS(preset) }],
        },
      )
    }
  }
  public unregisterPreset($ids: PresetId[] | PresetId) {
    if (!$ids) return
    const arr = Array.isArray($ids) ? $ids : [$ids]

    for (const $id of arr) {
      lifecycleEvent(
        () => {
          delete this.presets[$id]
        },
        {
          beforeEvent: AglynEvent.PRESET_UNREGISTERING,
          beforePayload: [{ $id }],
          afterEvent: AglynEvent.PRESET_UNREGISTERED,
          afterPayload: [{ $id }],
        },
      )
    }
  }
}

export default ComponentManager
