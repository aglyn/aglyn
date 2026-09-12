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

import type { DatasetModel } from '@aglyn/aglyn/server'

/**
 * Registers every plugin's custom field types before a record is validated
 * against `model` (AGL-434).
 *
 * A custom field type is registered when its plugin's server entry loads, and
 * `validateCustomFieldValue` answers "no error" for a type nobody registered.
 * That is the right answer for a plugin that is genuinely absent and the wrong
 * one for a plugin that has not been loaded yet. The record write routes do not
 * load plugins themselves, so without this a plugin's validator cannot be
 * relied on to run there, and a `rating` of 9 is stored as if it were valid.
 *
 * Only a model that names a custom type pays for the load. The loader is
 * imported here rather than at module scope because importing it builds the
 * console's plugin manifest; Node caches the module, so a later call is a map
 * lookup. A loader failure propagates: storing a value its validator never saw
 * is the defect this exists to prevent.
 */
export async function ensureCustomFieldTypes(
  model: Pick<DatasetModel, 'fields' | 'order'> | null | undefined,
): Promise<void> {
  const usesCustomType = (model?.order ?? []).some((fieldId) =>
    Boolean(model?.fields?.[fieldId]?.customType),
  )
  if (!usesCustomType) return
  const { serverPluginLoader } = await import('./server-plugin-loader')
  await serverPluginLoader.ensureAll(['consoleApi'])
}
