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

export interface WhereUsedDependent {
  type: 'screen' | 'layout' | 'workflow' | 'variable'
  id: string
  name: string
  via: Array<'id' | 'name'>
}

export interface WhereUsedResult {
  dependents: WhereUsedDependent[]
  total: number
  /** Dependents holding legacy name tokens — a rename breaks these. */
  legacyCount: number
}

const DEPENDENT_TYPE_LABELS: Record<WhereUsedDependent['type'], string> = {
  screen: 'screen',
  layout: 'layout',
  workflow: 'workflow',
  variable: 'variable',
}

/** One-line summary for confirm dialogs: `2 screens, 1 workflow`. */
export function summarizeDependents(result: WhereUsedResult): string {
  const counts = new Map<string, number>()
  for (const dependent of result.dependents) {
    const label = DEPENDENT_TYPE_LABELS[dependent.type]
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => `${count} ${label}${count === 1 ? '' : 's'}`)
    .join(', ')
}

/**
 * Calls the AGL-187 where-used scan for a variable/function/workflow.
 * Fail-open: scan errors return an empty result so delete/rename flows
 * degrade to their old (unwarned) behavior instead of blocking.
 */
export async function fetchWhereUsed(
  user: { getIdToken?: () => Promise<string> } | null | undefined,
  body: {
    hostId: string
    kind: 'variable' | 'function' | 'workflow'
    id: string
    name?: string
  },
): Promise<WhereUsedResult> {
  try {
    const idToken = await user?.getIdToken?.()
    const response = await fetch('/api/hosts/where-used', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`Scan failed (${response.status})`)
    return (await response.json()) as WhereUsedResult
  } catch (error) {
    console.error(error)
    return { dependents: [], total: 0, legacyCount: 0 }
  }
}
