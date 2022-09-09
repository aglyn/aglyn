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

import { _hasOwnProperty } from '@aglyn/shared-util-guards'
import { AglynEvent, emitter, lifecycleEvent } from '../emit-manager'
import type { PresetId, PresetSchema } from './preset'

export const presets: Record<PresetId, PresetSchema> = {}

emitter.on(AglynEvent.PRESET_REGISTER, ({ preset }) => {
  registerPreset(preset)
})
emitter.on(AglynEvent.PRESET_UNREGISTER, ({ presetId }) => {
  unregisterPreset(presetId)
})

export function getPreset(presetId: PresetId) {
  return presets[presetId]
}

export function hasPreset(presetId: PresetId) {
  return presetId && _hasOwnProperty(presetId, presets)
}

export function registerPreset(preset: PresetSchema) {
  const { presetId, bundleId, componentId } = preset
  lifecycleEvent(
    () => {
      presets[presetId] = preset
    },
    {
      beforeEvent: AglynEvent.PRESET_REGISTERING,
      beforePayload: [{ bundleId, componentId, presetId }],
      afterEvent: AglynEvent.PRESET_REGISTERED,
      afterPayload: [{ bundleId, componentId, presetId }],
    },
  )
}

export function unregisterPreset(presetId: PresetId) {
  lifecycleEvent(
    () => {
      delete presets[presetId]
    },
    {
      beforeEvent: AglynEvent.PRESET_UNREGISTERING,
      beforePayload: [{ presetId }],
      afterEvent: AglynEvent.PRESET_UNREGISTERED,
      afterPayload: [{ presetId }],
    },
  )
}
