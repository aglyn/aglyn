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

import { hostCollectionKind } from '@aglyn/aglyn/app-utils/collection-kind'

/** A content collection as the field offers it. */
export interface AiTemplateCollectionOption {
  id: string
  name: string
}

/**
 * The content collections among a site's collection rows, by name, each
 * named as the template step names it: display name, name, slug, then id.
 */
export function aiTemplateCollectionOptions(
  rows: ReadonlyArray<Record<string, unknown> & { $id: string }>,
): AiTemplateCollectionOption[] {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  return rows
    .filter((row) => hostCollectionKind(row) === 'content')
    .map((row) => ({
      id: row.$id,
      name: text(row['displayName']) || text(row['name']) || text(row['slug']) || row.$id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
