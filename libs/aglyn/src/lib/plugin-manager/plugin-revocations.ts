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

import type { PluginRevocation } from '../app-utils/plugin-manifest'
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginService,
} from './plugin-services'

/**
 * The platform's kill switch, read by a plugin that is not the one that keeps
 * it (AGL-3080).
 *
 * An artifact installed from a distribution channel — an email design, a
 * component, a plugin — carries the listing it came from on its install
 * stamp (`app-utils/artifact-provenance.ts`). When the platform pulls that
 * listing, or one of its versions, the revocation (`PluginRevocation`, the
 * platform's own shape) is what every reader consults: the loader before it
 * runs a bundle, the send path before it mails a design that was installed
 * rather than written. The revocations are KEPT by the plugin that runs the
 * distribution channel, and a reader that is not that plugin asks through
 * this slot rather than reading its storage.
 *
 * ## Absent, and failed, are different answers
 *
 * No reader registered means nothing in this process distributes artifacts,
 * so nothing here could have been installed from a listing and there is
 * nothing to revoke: {@link readListingRevocation} answers `null` — after
 * running the app's boot step once, because a boot whose declarations
 * failed looks the same from here, and a kill switch that silently stopped
 * answering is the one failure it may not have. A reader
 * that FAILS throws through to the caller, which decides — a send that cannot
 * learn whether its design was pulled refuses rather than mails it, the
 * direction the read had before it was a seam.
 *
 * Server-side: reached by its own subpath, never through
 * `plugin-manager/index.ts`.
 */

export interface PluginRevocationReader {
  /** The listing's revocation, or `null` when it was never revoked. */
  revocation(listingId: string): Promise<PluginRevocation | null>
}

export const PLUGIN_REVOCATIONS = definePluginServiceContract<PluginRevocationReader>(
  'core.revocations',
  { multiple: false },
)

/**
 * Registers the plugin that keeps the revocations. The owner is the loader's
 * marker when a register fn is running, else `options.pluginId`; a second
 * plugin's reader is refused naming both.
 */
export function registerPluginRevocationReader(
  reader: PluginRevocationReader,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_REVOCATIONS, reader, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/**
 * A listing's revocation: `null` when it has none, or when nothing in this
 * process keeps revocations. Throws what a failing reader throws.
 */
export async function readListingRevocation(listingId: string): Promise<PluginRevocation | null> {
  const id = String(listingId ?? '').trim()
  if (!id) return null
  let reader = resolvePluginService(PLUGIN_REVOCATIONS)
  if (!reader) {
    await runPluginDeclarationsRepair().catch((error: unknown) => {
      console.error('[revocations] plugin declarations failed', error)
    })
    reader = resolvePluginService(PLUGIN_REVOCATIONS)
  }
  return reader ? reader.revocation(id) : null
}
