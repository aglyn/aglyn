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

import { registerPluginInstallPresetMapper } from '@aglyn/aglyn'
import { muiPluginInstallToPreset } from './components/plugin'
import * as Aglyn from '@aglyn/aglyn'
import { runInAction } from 'mobx'
import * as AppBar from './components/app-bar'
import * as Button from './components/button'
import * as Container from './components/container'
import * as LayoutSlot from './components/layout-slot'
import * as List from './components/list'
import * as ListItem from './components/list-item'
import * as ListItemText from './components/list-item-text'
import * as FunctionWidget from './components/function-widget'
import * as Product from './components/product'
import * as Blocks from './components/blocks'
import * as Collection from './components/collection'
import * as FormComponents from './components/form'
import * as Image from './components/image'
import * as Icon from './components/icon'
import * as LanguageSwitcher from './components/language-switcher'
import * as Video from './components/video'
import * as CommunityPlugin from './components/plugin'
import * as CustomHtml from './components/custom-html'
import * as ReusableInstance from './components/reusable-instance'
import * as SearchBox from './components/search-box'
import * as ScreenLink from './components/screen-link'
import * as Section from './components/section'
import * as Stack from './components/stack'
import * as ThemeModeSwitcher from './components/theme-mode-switcher'
import * as Toolbar from './components/toolbar'
import * as Typography from './components/typography'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * Registers the core MUI component library with the `@aglyn/aglyn` global
 * plugin registry (`AglynNodeRenderer`, `Aglyn.canvas`, ...). This is the
 * platform's core component bundle; feature bundles (commerce,
 * events-calendar, email) declare a dependency on it.
 */
export function registerMuiPlugin(): void {
  // Install→preset mapper (AGL-419): the console's drawer registration
  // consumes it through core, never importing this plugin.
  registerPluginInstallPresetMapper(muiPluginInstallToPreset)
  if (Aglyn.plugins.getDependency(BUNDLE_ID)) return

  // Single bundle manifest (AGL-140): one entry per component keeps
  // register/unregister symmetric — the old hand-maintained lists had
  // drifted (several components were never unregistered on destroy).
  const MUI_BUNDLE: Array<{
    component: any
    schema: Aglyn.ComponentSchema<any>
    presets?: Aglyn.PresetSchema[]
  }> = [
    { component: AppBar.default, schema: AppBar.schema, presets: AppBar.presets },
    { component: Toolbar.default, schema: Toolbar.schema, presets: Toolbar.presets },
    { component: Typography.default, schema: Typography.schema, presets: Typography.presets },
    { component: Button.default, schema: Button.schema, presets: Button.presets },
    { component: Container.default, schema: Container.schema, presets: Container.presets },
    { component: LayoutSlot.default, schema: LayoutSlot.schema, presets: LayoutSlot.presets },
    { component: List.default, schema: List.schema, presets: List.presets },
    { component: ListItem.default, schema: ListItem.schema, presets: ListItem.presets },
    { component: ListItemText.default, schema: ListItemText.schema, presets: ListItemText.presets },
    { component: FormComponents.Form, schema: FormComponents.formSchema, presets: FormComponents.formPresets },
    { component: FormComponents.FormField, schema: FormComponents.formFieldSchema },
    { component: Blocks.VideoEmbed, schema: Blocks.videoEmbedSchema, presets: Blocks.blockPresets },
    { component: Blocks.SocialLinks, schema: Blocks.socialLinksSchema },
    // Content collections (AGL-551): entries repeater + markdown entry body.
    { component: Collection.CollectionEntries, schema: Collection.collectionEntriesSchema, presets: Collection.collectionPresets },
    { component: Collection.CollectionEntryBody, schema: Collection.collectionEntryBodySchema },
    { component: Image.default, schema: Image.schema, presets: Image.presets },
    { component: Video.default, schema: Video.schema, presets: Video.presets },
    { component: Icon.default, schema: Icon.schema, presets: Icon.presets },
    // booking moved to @aglyn/plugins-bookings (AGL-395).
    // event-list moved to @aglyn/plugins-events-calendar (AGL-313).
    { component: LanguageSwitcher.default, schema: LanguageSwitcher.schema, presets: LanguageSwitcher.presets },
    { component: ReusableInstance.default, schema: ReusableInstance.schema, presets: ReusableInstance.presets },
    { component: ScreenLink.default, schema: ScreenLink.schema, presets: ScreenLink.presets },
    { component: FunctionWidget.default, schema: FunctionWidget.schema, presets: FunctionWidget.presets },
    { component: Product.default, schema: Product.schema, presets: Product.presets },
    { component: CommunityPlugin.default, schema: CommunityPlugin.schema, presets: CommunityPlugin.presets },
    { component: CustomHtml.default, schema: CustomHtml.schema, presets: CustomHtml.presets },
    { component: SearchBox.default, schema: SearchBox.schema, presets: SearchBox.presets },
    { component: Section.default, schema: Section.schema, presets: Section.presets },
    { component: Stack.default, schema: Stack.schema, presets: Stack.presets },
    { component: ThemeModeSwitcher.default, schema: ThemeModeSwitcher.schema, presets: ThemeModeSwitcher.presets },
  ]

  Aglyn.plugins.addDependency({
    $id: BUNDLE_ID,
    displayName: 'Material UI',
    description: 'Material UI elements',
    title: 'Material UI',
    dependencies: {},
    load(): void {
      // One mobx transaction (AGL-371): a single observer notification
      // for the whole bundle instead of one per component/preset.
      runInAction(() => {
        for (const entry of MUI_BUNDLE) {
          Aglyn.components.registerComponent(entry.component, entry.schema)
        }
        for (const entry of MUI_BUNDLE) {
          if (entry.presets?.length) {
            Aglyn.components.registerPreset(entry.presets)
          }
        }
      })
    },
    destroy(): void {
      runInAction(() => {
        for (const entry of MUI_BUNDLE) {
          if (entry.presets?.length) {
            Aglyn.components.unregisterPreset(
              entry.presets.map((preset) => preset.$id),
            )
          }
        }
        for (const entry of MUI_BUNDLE) {
          Aglyn.components.unregisterComponent(entry.schema.$id)
        }
      })
    },
  })
}
