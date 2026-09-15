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

/**
 * Loads the plugins' console API halves so an org erasure can revoke the
 * provider grants they hold (AGL-2978).
 *
 * A plugin that stores an OAuth grant — Outreach, for a rep's Google mailbox
 * — registers a revoker from its server half, and that half is what the
 * console's API dispatcher loads. An erasure runner is not the dispatcher and
 * loads nothing on its own, so `eraseOrg` asks for this, once, only for an
 * organization that holds a grant.
 *
 * Imported when called rather than at module load: the manifest reaches every
 * plugin's server bundle, and an erasure run for an organization with no
 * grant has no reason to pay for that.
 */
export async function loadPluginGrantRevokers(): Promise<void> {
  const { serverPluginLoader } = await import('../server-plugin-loader')
  await serverPluginLoader.ensureAll(['consoleApi'])
}
