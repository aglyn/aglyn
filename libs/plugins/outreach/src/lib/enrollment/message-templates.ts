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

import { pluginRecordIndex } from '@aglyn/aglyn/plugin-manager/plugin-record-index'

/**
 * The body of an email template a step sends (AGL-2980), read through the
 * record system's `messageTemplate` index (AGL-3080) — never off its
 * storage. `null` for a template that is gone, and for a workspace whose
 * record system keeps none: a step whose template cannot be read sends its
 * own words or nothing, as the caller decides.
 */
export async function readOutreachTemplateBody(
  orgId: string,
  templateId: string | null | undefined,
): Promise<string | null> {
  const id = String(templateId ?? '').trim()
  const owner = id ? pluginRecordIndex('messageTemplate') : null
  if (!owner) return null
  const template = await owner.index.get({ orgId, id })
  const body = template?.facts['body']
  return typeof body === 'string' ? body : null
}
