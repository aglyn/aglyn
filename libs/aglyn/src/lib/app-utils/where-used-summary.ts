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
 * The where-used scan's answer and its one-line summary, without the fetch
 * (AGL-3668): pure, so the native apps word a delete's warning as the
 * console does. `where-used.ts` re-exports it beside its client.
 */

export interface WhereUsedDependent {
  /**
   * `screen` or `layout` for a published page; otherwise the kind of record
   * the plugin that answered names (`variable`, `workflow`).
   */
  type: string
  id: string
  name: string
  via: Array<'id' | 'name'>
  /** Published version scanned (screens/layouts) — deep-link target. */
  versionId?: string
}

export interface WhereUsedResult {
  dependents: WhereUsedDependent[]
  total: number
  /** Dependents holding legacy name tokens — a rename breaks these. */
  legacyCount: number
}

/** One-line summary for confirm dialogs: `2 pages, 1 workflow`. */
export function summarizeDependents(result: WhereUsedResult): string {
  const counts = new Map<string, number>()
  for (const dependent of result.dependents) {
    // A `screen` is called a page wherever a person reads it.
    const label = dependent.type === 'screen' ? 'page' : dependent.type
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => `${count} ${label}${count === 1 ? '' : 's'}`)
    .join(', ')
}
