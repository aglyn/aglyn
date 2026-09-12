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
'use client'

import type { ResolvedConsoleNavSection } from '@aglyn/aglyn'
import { HubSections } from '@aglyn/shared-ui-next'
import type { ReactNode } from 'react'

export interface PluginHubRailProps {
  /** The hub's sections as `resolveHubSections` answered them, if it has any. */
  sections: readonly ResolvedConsoleNavSection[] | undefined
  /** What the shell renders in place of the plugin page. */
  children: ReactNode
}

/**
 * A body the SHELL renders for a plugin hub — its upgrade notice — beside the
 * hub's section rail (AGL-2851).
 *
 * A plugin page draws its own rail around the section it builds, so a body
 * the shell renders instead of that page would otherwise stand alone: a
 * locked section with no way to the sections beside it, and a hub whose
 * every section is locked with no sign of what it holds. Beside the rail the
 * locks the plan leaves are drawn where the reader is, and each links to the
 * notice for its own section. A surface with no sections is drawn as it was.
 */
export function PluginHubRail(props: PluginHubRailProps) {
  const { sections, children } = props
  if (!sections?.length) return <>{children}</>
  return <HubSections sections={sections}>{children}</HubSections>
}
PluginHubRail.displayName = 'PluginHubRail'

export default PluginHubRail
