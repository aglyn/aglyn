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

import { scopeSharingOf, sharingFromChoice, visibleToHost } from '@aglyn/aglyn'
import type { SiteSharingValue } from '@aglyn/shared-ui-jsx/components/site-sharing-field.component'
import { type MediaScanCoverage, provesUnused } from './media-usage-copy'

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
 * What the usage check behind a "Limit who can use…" confirmation has found
 * (AGL-1045, AGL-4047).
 *
 * * `checking` — the scan is still running. The confirmation opens at once
 *   and says so, rather than nothing happening for the ten seconds a busy
 *   scan can take.
 * * `checked` — at least one scan answered. `names` are the sites it found
 *   using the files that the new sharing leaves out. `everywhere` is whether
 *   it read every site and page it could: a workspace with more sites than
 *   one scan reads (`HOSTS_PER_SCAN`) answers with what it read, and that is
 *   a check, not "was not checked".
 * * `failed` — no scan answered (an error, a refused request, a dropped
 *   connection).
 * * `tooMany` — more files than are checked at once; nothing was asked.
 */
export type LimitAccessUsage =
  | { state: 'checking' }
  | { state: 'checked'; names: readonly string[]; everywhere: boolean }
  | { state: 'failed' }
  | { state: 'tooMany'; limit: number }

/** One file's usage scan, as `/api/media/references` answers it. */
export interface LimitAccessScan {
  coverage: MediaScanCoverage
  items: readonly { hostId?: string | null; hostSubdomain?: string | null }[]
}

/**
 * What the scans of the files being narrowed found, `null` standing for a
 * scan that failed. A file found on a site that keeps it is no loss, and an
 * org-level reference (the org's own logo) names no site that a site scope
 * decides anything about.
 */
export function limitAccessUsageOf(
  scans: readonly (LimitAccessScan | null)[],
  nextScope: readonly string[],
): LimitAccessUsage {
  const answered = scans.filter((scan): scan is LimitAccessScan => scan !== null)
  if (!answered.length) return { state: 'failed' }
  const names = new Set<string>()
  for (const scan of answered) {
    for (const item of scan.items) {
      if (!item.hostId || visibleToHost(nextScope, item.hostId)) continue
      names.add(String(item.hostSubdomain ?? item.hostId))
    }
  }
  return {
    state: 'checked',
    names: [...names],
    everywhere:
      answered.length === scans.length && answered.every((scan) => provesUnused(scan.coverage)),
  }
}

/**
 * The sentence a "Limit who can use…" confirmation says about the sites that
 * use the files and lose them, for each state of the check above. Only a
 * check that did not happen says it was not checked.
 *
 * Shared with all sites except some, a page on a site left out stops showing
 * the file wherever it shows it from the library, and it is said that way: a
 * link to the file pasted into custom HTML there keeps loading, because the
 * CDN serves a bare workspace link for such a file to anyone (the plan's Media
 * URLs). A sentence that promised otherwise would be false.
 */
export function limitAccessDescription(input: {
  usage: LimitAccessUsage
  /** One file, or several. */
  count: number
  allExcept: boolean
}): string {
  const { usage, count, allExcept } = input
  const one = count === 1
  const it = one ? 'it' : 'them'
  const files = one ? 'this file' : 'these files'
  const whatHappens = allExcept
    ? `Pages on a site left out stop showing ${it}, except where a link to ${it} was ` +
      'pasted into custom HTML, which keeps loading.'
    : `Any site losing access will stop rendering ${it}.`
  switch (usage.state) {
    case 'checking':
      return `Checking which sites use ${files}… ${whatHappens}`
    case 'failed':
      return `Current usage was not checked. ${whatHappens}`
    case 'tooMany':
      return `Current usage is not checked for more than ${usage.limit} files at once. ${whatHappens}`
  }
  const { names, everywhere } = usage
  const notEverywhere = `Not every site could be checked, so other sites may use ${it} too.`
  if (!names.length) {
    return everywhere
      ? `No page on a site losing access uses ${it}, so nothing breaks today.`
      : `No page checked on a site losing access uses ${it}, but not every site could be ` +
          `checked. ${whatHappens}`
  }
  const subject = `${names.join(', ')} ${names.length === 1 ? 'uses' : 'use'} ${files}`
  const found = allExcept
    ? `${subject}. Pages there stop showing ${it}, except where a link to ${it} was ` +
      'pasted into custom HTML, which keeps loading.'
    : `${subject} and will stop rendering ${it}.`
  return `${found}${everywhere ? '' : ` ${notEverywhere}`} This does not delete anything.`
}

/**
 * What the sharing field says under "All sites except…". The same bare-link
 * truth as {@link limitAccessDescription}, said before anyone saves.
 */
export const ALL_EXCEPT_MEDIA_NOTE =
  'Sites left out can’t pick this from their media library, and their pages stop ' +
  'showing it. A link to it pasted into custom HTML keeps loading.'
