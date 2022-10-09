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

// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type { MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type { ComponentId } from '../components-manager'
import { ComponentCategory, NodePresetData } from '../components-manager'
import { PluginId } from '../plugin-manager'

export type PresetId = string

export type PresetSchema = {
  presetId: PresetId
  label: string
  componentId?: ComponentId
  pluginId?: PluginId
  description?: string
  icon?: MdiIconProps
  category?: string | ComponentCategory
  data: NodePresetData
}
