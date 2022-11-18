/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import type { MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
import { makeAutoObservable, observable, runInAction, toJS } from 'mobx'
import { ComponentCategory } from '../components-manager'
import { createIdUrlSafe } from '../constants'
import { AglynEvent, emitter, lifecycleEvent } from '../emit-manager'
import type { PluginId } from '../plugin-manager'
import {
  type AbstractNodeSchema,
  type NodeSchemaNested,
  NodeType,
} from '../screen-manager'

export type PresetId = string

export interface PresetSchema<P = JSX.AnyProps>
  extends AbstractNodeSchema<NodeType.PRESET> {
  $id: PresetId
  pluginId?: PluginId
  displayName?: string
  description?: string
  category?: string | ComponentCategory
  icon?: MdiIconProps
  data: NodeSchemaNested<P>
}
export interface PresetState {
  byId?: Record<PresetId, PresetSchema<any>>
}

export class AglynPreset<P = JSX.AnyProps> implements PresetSchema<P> {
  public $id: PresetId
  public type: NodeType.PRESET = NodeType.PRESET
  public category: string | ComponentCategory
  public data: NodeSchemaNested<P>
  public description: string
  public displayName: string
  public icon: MdiIconProps
  public pluginId: PluginId

  constructor(schema: PresetSchema<P>) {
    this.$id = schema.$id
    this.category = schema.category || ComponentCategory.UNCATEGORIZED
    this.data = schema.data
    this.description = schema.description
    this.displayName = schema.displayName
    this.icon = schema.icon
    this.pluginId = schema.pluginId

    makeAutoObservable(this)
  }
}

export const state = observable<PresetState>({
  byId: {},
})

emitter.on(AglynEvent.PRESET_REGISTER, ({ preset }) => {
  registerPreset(preset)
})
emitter.on(AglynEvent.PRESET_UNREGISTER, ({ presetId }) => {
  unregisterPreset(presetId)
})

export function getPreset($id: PresetId) {
  return (state.byId ||= {})[$id]
}

export function hasPreset($id: PresetId) {
  return Boolean($id) && Object.hasOwn(state, $id)
}

export function registerPreset(presets: PresetSchema[] | PresetSchema) {
  if (!presets) return
  const arr = Array.isArray(presets) ? presets : [presets]

  for (const preset of arr) {
    const $id = (preset.$id ||= createIdUrlSafe())
    lifecycleEvent(
      () => {
        runInAction(() => {
          state.byId[$id] = new AglynPreset(preset)
        })
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

export function unregisterPreset($ids: PresetId[] | PresetId) {
  if (!$ids) return
  const arr = Array.isArray($ids) ? $ids : [$ids]

  for (const $id of arr) {
    lifecycleEvent(
      () => {
        runInAction(() => {
          delete state.byId[$id]
        })
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
