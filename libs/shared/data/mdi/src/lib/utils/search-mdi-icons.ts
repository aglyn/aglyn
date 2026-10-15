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

import type { Icon } from '../types'

/** How many icons a search answers at most; the picker narrows with more words rather than paging. */
export const MDI_ICON_SEARCH_LIMIT = 60

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)

/**
 * The icons a picker lists for what a person typed (AGL-3668).
 *
 * Every word typed has to start a word of the icon's name, an alias or a tag
 * (or be inside its id), so "account circle" finds Account Circle and "cart"
 * finds the shopping icons. A name hit ranks above an alias or tag hit, and
 * a name that starts with the first word ranks above one that only contains
 * it. With nothing typed the first icons are answered, in catalog order. The
 * native apps ask for this over a route instead of carrying six thousand
 * paths, and draw the SVG paths it answers.
 */
export function searchMdiIcons(
  icons: Iterable<Icon>,
  query: string,
  limit: number = MDI_ICON_SEARCH_LIMIT,
): Icon[] {
  const wanted = words(query)
  const cap = Math.max(1, Math.min(limit, MDI_ICON_SEARCH_LIMIT))
  if (!wanted.length) {
    const first: Icon[] = []
    for (const icon of icons) {
      first.push(icon)
      if (first.length >= cap) break
    }
    return first
  }
  const scored: Array<{ icon: Icon; score: number }> = []
  for (const icon of icons) {
    const nameWords = words(icon.name)
    const otherWords = [...(icon.as ?? []), ...(icon.tags ?? [])].flatMap(words)
    let score = 0
    let all = true
    for (const word of wanted) {
      if (nameWords.some((entry) => entry.startsWith(word))) score += 3
      else if (icon.id.includes(word)) score += 2
      else if (otherWords.some((entry) => entry.startsWith(word))) score += 1
      else {
        all = false
        break
      }
    }
    if (!all) continue
    if (nameWords[0]?.startsWith(wanted[0])) score += 1
    scored.push({ icon, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.icon.name.localeCompare(b.icon.name))
    .slice(0, cap)
    .map((entry) => entry.icon)
}
