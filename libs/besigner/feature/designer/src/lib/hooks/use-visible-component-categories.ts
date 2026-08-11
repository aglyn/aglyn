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
import useAglynBesignerFlag from './use-aglyn-besigner-flag'

/** Bundle id of the email designer's blocks (AGL-395). */
const EMAIL_PLUGIN_ID = 'email'

function isLayoutOnlyPreset(preset: Aglyn.PresetSchema | undefined) {
  return preset?.data?.componentId === Aglyn.LAYOUT_SLOT_COMPONENT_ID
}

function isEmailComponent(item: { pluginId?: string } | undefined) {
  return item?.pluginId === EMAIL_PLUGIN_ID
}

/**
 * Component-drawer categories filtered by the site's plugin set and the
 * current canvas view type:
 *
 *  - A plugin disabled for this site (AGL-1014) contributes nothing, in
 *    either drawer — the palette and the picker read this one hook.
 *  - Editing an EMAIL document → only the email plugin's email-safe blocks;
 *    web/layout components would render inconsistently across mail clients.
 *  - Editing a screen or layout → email blocks are hidden (they belong to
 *    emails only); layout-only components (the LayoutSlot outlet) are also
 *    hidden while editing screens.
 *
 * Call inside an observer component — the category list is a MobX computed.
 */
export function useVisibleComponentCategories() {
  const [viewType] = useAglynBesignerFlag('viewType')
  // Per-site plugin enablement (AGL-1014). Enforcement, not decoration: the
  // preset registry is a module-global union across every plugin loaded this
  // session, so without this the drawer offers — and inserts — components
  // from a plugin the site has switched off, which the published site then
  // refuses to render. Undefined off host surfaces, which filters nothing.
  const enabled = Aglyn.useEnabledPlugins()

  if (viewType === Aglyn.HostViewType.EMAIL) {
    return Aglyn.components.schemasBySortedCategories
      .map((category) => ({
        ...category,
        items: category.items?.filter(
          (item) =>
            isEmailComponent(item) && Aglyn.isFromEnabledPlugin(item, enabled),
        ),
      }))
      .filter((category) => category.items?.length)
  }

  const isLayout = viewType === Aglyn.HostViewType.LAYOUT
  return Aglyn.components.schemasBySortedCategories
    .map((category) => ({
      ...category,
      items: category.items?.filter(
        (item) =>
          // A plugin this site has switched off offers nothing.
          Aglyn.isFromEnabledPlugin(item, enabled) &&
          // Email blocks never appear outside an email document.
          !isEmailComponent(item) &&
          // The LayoutSlot outlet is layout-only.
          (isLayout || !isLayoutOnlyPreset(item as Aglyn.PresetSchema)),
      ),
    }))
    .filter((category) => category.items?.length)
}

export default useVisibleComponentCategories
