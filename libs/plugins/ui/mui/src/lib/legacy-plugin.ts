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
import * as AppBar from './components/app-bar'
import * as Button from './components/button'
import * as Container from './components/container'
import * as List from './components/list'
import * as ListItem from './components/list-item'
import * as ListItemText from './components/list-item-text'
import * as Stack from './components/stack'
import * as Toolbar from './components/toolbar'
import * as Typography from './components/typography'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * Registers the MUI components with the legacy `@aglyn/aglyn` global plugin
 * registry, for pages still running on the legacy runtime
 * (`AglynNodeRenderer`, `Aglyn.canvas`, ...). New code should register the
 * exported `bundle` with `registerBundle` from `@aglyn/aglyn` instead.
 */
export function registerLegacyMuiPlugin(): void {
  if (Aglyn.plugins.getDependency(BUNDLE_ID)) return

  Aglyn.plugins.addDependency({
    $id: BUNDLE_ID,
    displayName: 'Material UI',
    description: 'Material UI elements',
    title: 'Material UI',
    dependencies: {},
    load(): void {
      Aglyn.components.registerComponent(AppBar.default, AppBar.schema)
      Aglyn.components.registerComponent(Toolbar.default, Toolbar.schema)
      Aglyn.components.registerComponent(Typography.default, Typography.schema)
      Aglyn.components.registerComponent(Button.default, Button.schema)
      Aglyn.components.registerComponent(Container.default, Container.schema)
      Aglyn.components.registerComponent(List.default, List.schema)
      Aglyn.components.registerComponent(ListItem.default, ListItem.schema)
      Aglyn.components.registerComponent(
        ListItemText.default,
        ListItemText.schema,
      )
      Aglyn.components.registerComponent(Stack.default, Stack.schema)

      Aglyn.components.registerPreset(AppBar.presets)
      Aglyn.components.registerPreset(Toolbar.presets)
      Aglyn.components.registerPreset(Typography.presets)
      Aglyn.components.registerPreset(Button.presets)
      Aglyn.components.registerPreset(Container.presets)
      Aglyn.components.registerPreset(List.presets)
      Aglyn.components.registerPreset(ListItem.presets)
      Aglyn.components.registerPreset(ListItemText.presets)
      Aglyn.components.registerPreset(Stack.presets)
    },
    destroy(): void {
      Aglyn.components.unregisterPreset(AppBar.presets.map((i) => i.$id))
      Aglyn.components.unregisterPreset(Toolbar.presets.map((i) => i.$id))
      Aglyn.components.unregisterPreset(Typography.presets.map((i) => i.$id))
      Aglyn.components.unregisterPreset(Button.presets.map((i) => i.$id))
      Aglyn.components.unregisterPreset(Container.presets.map((i) => i.$id))
      Aglyn.components.unregisterPreset(List.presets.map((i) => i.$id))
      Aglyn.components.unregisterPreset(ListItem.presets.map((i) => i.$id))
      Aglyn.components.unregisterPreset(ListItemText.presets.map((i) => i.$id))
      Aglyn.components.unregisterPreset(Stack.presets.map((i) => i.$id))

      Aglyn.components.unregisterComponent(AppBar.ID)
      Aglyn.components.unregisterComponent(Toolbar.ID)
      Aglyn.components.unregisterComponent(Typography.ID)
      Aglyn.components.unregisterComponent(Button.ID)
      Aglyn.components.unregisterComponent(Container.ID)
      Aglyn.components.unregisterComponent(List.ID)
      Aglyn.components.unregisterComponent(ListItem.ID)
      Aglyn.components.unregisterComponent(ListItemText.ID)
      Aglyn.components.unregisterComponent(Stack.ID)
    },
  })
}
