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

import type { Metadata } from 'next'
import KioskPluginPage from '../../../../components/kiosk-plugin-page.component'
import { entityPageTitle } from '../../../entity-page-title'

interface KioskRouteParams {
  pluginId: string
  path: string[]
}

/**
 * A plugin's public device page (AGL-3608): `/kiosk/{pluginId}/{…path}`,
 * outside the authenticated `(app)` group, so it renders with the console's
 * theme and no workspace shell. See `ConsolePublicPage` for the contract and
 * `KioskPluginPage` for how it loads.
 *
 * The registry fills on the client, so the server titles the tab with the
 * path and the plugin id; the page's own title replaces the path once it has
 * resolved. Never indexed: the URL is a device's, not a page for the web.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<KioskRouteParams>
}): Promise<Metadata> {
  const { pluginId, path } = await params
  return {
    title: entityPageTitle({ subject: (path ?? []).join('/'), noun: pluginId }),
    robots: { index: false, follow: false },
  }
}

export default async function KioskRoute({
  params,
}: {
  params: Promise<KioskRouteParams>
}) {
  const { pluginId, path } = await params
  return (
    <KioskPluginPage pluginId={String(pluginId ?? '')} path={(path ?? []).join('/')} />
  )
}
