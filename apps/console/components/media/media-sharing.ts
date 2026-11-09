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

import { scopeSharingOf, sharingFromChoice } from '@aglyn/aglyn'
import type { SiteSharingValue } from '@aglyn/shared-ui-jsx/components/site-sharing-field.component'

/**
 * The workspace media library's sharing, as the console edits it (AGL-4047):
 * the drawer for one file, and the dialog for a selection or a folder.
 */

/**
 * How a file or folder is shared, as the choice the sharing field edits, or
 * null where it stores no sharing (AGL-1466, AGL-1480). The seed and the save
 * both read it from here, so a control nobody touched compares equal to its own
 * document and writes nothing.
 */
export function mediaSharingChoiceOf(doc: unknown): SiteSharingValue | null {
  const sharing = scopeSharingOf(doc as Record<string, unknown> | null)
  if (sharing.mode === 'all') return { mode: 'all' }
  if (sharing.mode === 'selected') return { mode: 'selected', hostIds: sharing.hostIds }
  if (sharing.mode === 'allExcept') return { mode: 'allExcept', exceptHostIds: sharing.exceptHostIds }
  return null
}

/** Two choices compare by what they pick, in any order. */
export function mediaSharingKey(choice: SiteSharingValue | null): string {
  if (!choice) return 'unset'
  if (choice.mode === 'all') return 'all'
  const picked = choice.mode === 'selected' ? choice.hostIds : choice.exceptHostIds
  return `${choice.mode}:${[...picked].sort().join(',')}`
}

/**
 * What a choice would write, or why it can't be: the answer the route gives
 * from the workspace's sites, which it reads for itself. The sites a choice
 * leaves out stay known here even where this member can't name them, so they
 * aren't taken for sites that are gone.
 */
export function mediaSharingPreview(
  choice: SiteSharingValue | null,
  orgHostIds: readonly string[],
): ReturnType<typeof sharingFromChoice> | null {
  if (!choice) return null
  const leftOut = choice.mode === 'allExcept' ? choice.exceptHostIds : []
  return sharingFromChoice(choice, [...orgHostIds, ...leftOut])
}

/**
 * The sentence a "Limit who can use…" confirmation says about the sites that
 * use the files and lose them.
 *
 * `names` are the sites a scan found using them that the new sharing leaves
 * out, `[]` when the scan found none, and null when nobody could check.
 *
 * Shared with all sites except some, a page on a site left out stops showing
 * the file wherever it shows it from the library, and it is said that way: a
 * link to the file pasted into custom HTML there keeps loading, because the
 * CDN serves a bare workspace link for such a file to anyone (the plan's Media
 * URLs). A sentence that promised otherwise would be false.
 */
export function limitAccessDescription(input: {
  names: readonly string[] | null
  /** One file, or several. */
  count: number
  allExcept: boolean
}): string {
  const { names, count, allExcept } = input
  const one = count === 1
  const it = one ? 'it' : 'them'
  if (names === null) {
    return allExcept
      ? `Current usage was not checked. Pages on a site left out stop showing ${it}, ` +
          `except where a link to ${it} was pasted into custom HTML, which keeps loading.`
      : `Current usage was not checked. Any site losing access will stop rendering ${it}.`
  }
  if (!names.length) {
    return `No page uses ${it} yet, so nothing breaks today.`
  }
  const subject = `${names.join(', ')} ${names.length === 1 ? 'uses' : 'use'} ${one ? 'this file' : 'these files'}`
  return allExcept
    ? `${subject}. Pages there stop showing ${it}, except where a link to ${it} was ` +
        'pasted into custom HTML, which keeps loading. This does not delete anything.'
    : `${subject} and will stop rendering ${it}. This does not delete anything.`
}

/**
 * What the sharing field says under "All sites except…". The same bare-link
 * truth as {@link limitAccessDescription}, said before anyone saves.
 */
export const ALL_EXCEPT_MEDIA_NOTE =
  'Sites left out can’t pick this from their media library, and their pages stop ' +
  'showing it. A link to it pasted into custom HTML keeps loading.'
