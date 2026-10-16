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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { isHostPluginEnabled, isPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import {
  listPluginFigureReaders,
  pluginFigureReaderPlugin,
  type PluginFigureReader,
  type ResolvedPluginFigureReader,
} from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { filterEnabledPluginsByReleaseFlags } from './release-flags'

/**
 * The figure readers a caller may read for one workspace or one site
 * (AGL-2915): the caller's half of the `plugin-figures` contract.
 *
 * The registry carries no authorization, so before a reader is read this
 * establishes that the workspace's plan includes the feature the figures are
 * sold under, and that the plugin whose records they are runs here: past its
 * release flag, on for the workspace and not switched off for the site. The
 * site belonging to the workspace, and the person's reach, are the caller's
 * own checks.
 */

/** Which of a set of plugins are past their release flags for an org; the platform's flags by default. */
export type ReleasedFigurePlugins = (pluginIds: string[], orgId: string) => Promise<string[]>

const releasedByFlags: ReleasedFigurePlugins = (pluginIds, orgId) =>
  filterEnabledPluginsByReleaseFlags(pluginIds, { orgId, authorization: null })

export interface FigureReaderContext {
  orgId: string
  /** The site the figures are about; `null` for the workspace as a whole. */
  hostId: string | null
  /** The org document. */
  org: object | null
  /** The site's host document, already checked to belong to the org; `null` with no site. */
  host: Record<string, unknown> | null
  /** Which readers the caller asks about at all, before the gates. */
  accept: (reader: PluginFigureReader) => boolean
  released?: ReleasedFigurePlugins
}

/** The readers that pass the gates, ordered by id so a list of them is the same on every call. */
export async function eligibleFigureReaders(
  context: FigureReaderContext,
): Promise<ResolvedPluginFigureReader[]> {
  const org = context.org as { enabledPlugins?: string[] } | null
  const candidates = listPluginFigureReaders().filter(({ reader }) => {
    if (!context.accept(reader)) return false
    // A site reader needs a site; a workspace reader reads with or without one.
    if (reader.scope === 'site' && !context.hostId) return false
    return !reader.feature || checkEntitlement(org as never, reader.feature)
  })
  const plugins = [
    ...new Set(candidates.map(pluginFigureReaderPlugin).filter((id): id is string => Boolean(id))),
  ]
  const released = new Set(
    plugins.length ? await (context.released ?? releasedByFlags)(plugins, context.orgId) : [],
  )
  return candidates.filter((resolved) => {
    const plugin = pluginFigureReaderPlugin(resolved)
    if (!plugin) return true
    if (!released.has(plugin)) return false
    return context.hostId
      ? isHostPluginEnabled(org, context.host as { disabledPlugins?: string[] } | null, plugin)
      : isPluginEnabled(org, plugin)
  })
}
