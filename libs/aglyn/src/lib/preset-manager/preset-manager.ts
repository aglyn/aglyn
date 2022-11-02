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
import { observable, runInAction } from 'mobx'
import { ComponentCategory } from '../components-manager'
import { createIdUrlSafe } from '../constants'
import { AglynEvent, emitter, lifecycleEvent } from '../emit-manager'
import type { PluginId } from '../plugin-manager'
import {
  type AbstractNodeSchema,
  NodeSchemaNested,
  NodeType,
} from '../screen-manager'

export type PresetId = string

export interface PresetSchema<P = JSX.AnyProps>
  extends AbstractNodeSchema<NodeType.PRESET> {
  $id: PresetId
  meta?: {
    label?: string
    pluginId?: PluginId
    description?: string
    icon?: MdiIconProps
    category?: string | ComponentCategory
  }
  data: NodeSchemaNested<P>
}

emitter.on(AglynEvent.PRESET_REGISTER, ({ preset }) => {
  registerPreset(preset)
})
emitter.on(AglynEvent.PRESET_UNREGISTER, ({ presetId }) => {
  unregisterPreset(presetId)
})

export const presets = observable<Record<PresetId, PresetSchema>>({})

export function getPreset($id: PresetId) {
  return presets[$id]
}

export function hasPreset($id: PresetId) {
  return Boolean($id) && Object.hasOwn(presets, $id)
}

export function registerPreset(preset: PresetSchema) {
  if (!preset) return
  const $id = (preset.$id ||= createIdUrlSafe())
  lifecycleEvent(
    () => {
      runInAction(() => {
        presets[$id] = preset
      })
    },
    {
      beforeEvent: AglynEvent.PRESET_REGISTERING,
      beforePayload: [{ $id, meta: preset.meta }],
      afterEvent: AglynEvent.PRESET_REGISTERED,
      afterPayload: [{ $id, meta: preset.meta }],
    },
  )
}

export function unregisterPreset($id: PresetId) {
  lifecycleEvent(
    () => {
      runInAction(() => {
        delete presets[$id]
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
