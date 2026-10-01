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

import { ensureDeclaredCustomFieldTypes } from '@aglyn/aglyn/server'

/** A model's fields, as far as this check reads them. */
interface FieldModel {
  fields?: Record<string, { customType?: string } | undefined>
  order?: readonly string[]
}

/**
 * Makes sure every custom field type a dataset model names is registered
 * before a record is validated against it (AGL-434).
 *
 * `validateDocument` answers "no error" for a type nobody registered — right
 * for a plugin that is genuinely absent, wrong for one that has not loaded in
 * this process yet. A type is registered when its plugin's console server
 * surface loads, or from its server declarations, so a model that names one
 * asks the caller to load the surfaces (`loadPluginSurfaces`, handed in by
 * the `/v1` router and by a site restore) and then runs the platform's own
 * declarations repair. A model with no custom field pays for neither. A load
 * that fails propagates: storing a value its validator never saw is the
 * defect this exists to prevent.
 */
export async function loadCustomFieldTypes(
  model: FieldModel | null | undefined,
  loadPluginSurfaces?: () => Promise<void>,
): Promise<void> {
  const usesCustomType = (model?.order ?? []).some((fieldId) =>
    Boolean(model?.fields?.[fieldId]?.customType),
  )
  if (!usesCustomType) return
  if (loadPluginSurfaces) await loadPluginSurfaces()
  await ensureDeclaredCustomFieldTypes(model)
}
