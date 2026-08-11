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
 * What the media library is allowed to TELL an author about where an asset is
 * used (AGL-1413).
 *
 * This is a separate module because the sentence is the safety control, not
 * the decoration on one. `/api/media/references` can now say how much of the
 * corpus it actually read, and the entire value of that flag is that these
 * strings respect it — a panel that reads `references.length === 0` and prints
 * "not used anywhere" throws the information away at the last step, which is
 * exactly what the endpoint did before this issue and what the delete
 * confirmation did by staying silent.
 *
 * Two surfaces consume this and they had drifted into two different rules for
 * the same question. One rule, in one file, with a spec that fails if the
 * unqualified claim ever becomes reachable from an incomplete scan.
 */

/**
 * How much of the corpus the scan read. Mirrors `MediaScanCoverage` in
 * `utils/server/scan-media-references` — the server type cannot be imported
 * into a client component, and duplicating three string literals is cheaper
 * than making that module client-safe.
 */
export type MediaScanCoverage = 'full' | 'published' | 'partial'

/**
 * Coerce whatever the response carried.
 *
 * An absent or unrecognized value is `partial`, and that default is the point:
 * an older deployment, a changed response shape, a proxy that dropped the
 * field. Every one of those has to degrade to "we could not determine this",
 * because the alternative is a delete confirmation promising an asset is
 * unused on the strength of a field that was not there.
 */
export const coverageOf = (value: unknown): MediaScanCoverage =>
  value === 'full' || value === 'published' ? value : 'partial'

/** Whether an empty result may be presented as "nothing uses it". */
export const provesUnused = (coverage: MediaScanCoverage) =>
  coverage !== 'partial'

/**
 * What the answer amounts to.
 *
 * * `used` — references were found; the count and names are the answer.
 * * `none` — the ONLY level that may state the asset is unused. Reachable
 *   from `full` coverage and nothing else.
 * * `none-published` — nothing a visitor can see uses it; history was not all
 *   read. A true and useful statement, and the common case for a site with
 *   deep version history.
 * * `unknown` — the scan failed or was cut short before it finished the live
 *   corpus. Says so, and says that this is not the same as nothing using it.
 */
export type MediaUsageAssurance =
  | 'used'
  | 'none'
  | 'none-published'
  | 'unknown'

export function mediaUsageAssurance(
  /** `null` for a scan that failed outright — same fact, from the author's
   * side, as one that could not finish. */
  scan: { coverage: MediaScanCoverage; count: number } | null,
): MediaUsageAssurance {
  if (!scan) return 'unknown'
  if (scan.count > 0) return 'used'
  if (!provesUnused(scan.coverage)) return 'unknown'
  return scan.coverage === 'published' ? 'none-published' : 'none'
}

/** The drawer's "Used on" panel, when the scan found nothing. */
export function usagePanelEmptyMessage(coverage: MediaScanCoverage): string {
  switch (mediaUsageAssurance({ coverage, count: 0 })) {
    case 'unknown':
      return (
        'We could not check everywhere this could be used. That is not the ' +
        'same as nothing using it — try again before deleting.'
      )
    case 'none-published':
      return (
        'Nothing published uses this file. Older and unpublished versions ' +
        'were not all checked.'
      )
    default:
      return (
        'Not used by any page, layout, component, site setting, or content ' +
        'entry.'
      )
  }
}

/**
 * The sentence appended to the delete confirmation.
 *
 * Deletion is irreversible and this dialog is the last thing between the
 * author and it, so silence has to be earned. Before AGL-1413 the dialog said
 * nothing whenever the scan came back empty — and the scan came back empty for
 * every asset held by a component, by a site setting, or by any version other
 * than the published one. Leading space because it joins an existing sentence.
 */
export function deleteConfirmationNote(
  scan: { coverage: MediaScanCoverage; names: string[] } | null,
): string {
  const assurance = mediaUsageAssurance(
    scan ? { coverage: scan.coverage, count: scan.names.length } : null,
  )
  switch (assurance) {
    case 'used': {
      const names = scan.names
      return (
        ` WARNING: it is referenced in ${names.length} ` +
        `place${names.length === 1 ? '' : 's'} (${names.join(', ')}).`
      )
    }
    case 'unknown':
      return (
        ' We could not check everywhere it might be used, so this is not a ' +
        'confirmation that nothing uses it.'
      )
    case 'none-published':
      return (
        ' Nothing published uses it. Older and unpublished versions were not ' +
        'all checked.'
      )
    default:
      return (
        ' Nothing on this site uses it — no page, layout, component, site ' +
        'setting, or content entry.'
      )
  }
}
