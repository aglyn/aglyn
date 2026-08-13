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
'use client'

import type { ConfirmationContextConfig } from '@aglyn/shared-ui-jsx'
import { useEffect, useState } from 'react'
import {
  deleteConfirmationLead,
  SCAN_PENDING_NOTE,
} from './media-delete-copy'
import {
  deleteConfirmationNote,
  type MediaScanCoverage,
} from './media-usage-copy'

export interface MediaDeleteConfirmScan {
  coverage: MediaScanCoverage
  names: string[]
}

export interface MediaDeleteConfirmDescriptionProps {
  fileName: string
  /**
   * The usage scan, ALREADY IN FLIGHT. Passing the promise rather than the
   * result is the whole point: the caller starts the scan and opens the
   * dialog in the same tick, and this component is what turns the answer into
   * a sentence whenever it lands.
   */
  scan: Promise<MediaDeleteConfirmScan | null>
}

/**
 * The body of the delete confirmation, filled in live (AGL-1461).
 *
 * `/api/media/references` walks up to a 1,500-document budget across every
 * site in the org (`utils/server/scan-media-references.ts`). Awaiting it
 * before calling `confirm()` meant the dialog appeared roughly a scan later —
 * long enough to read as a dead button, which invites a second click on a
 * destructive control. The scan is worth keeping and worth showing; it is not
 * worth holding the dialog closed for.
 *
 * Rendered inside MUI's `DialogContentText`, which is a `<p>`, so everything
 * here stays inline — a block element would be invalid nesting and React
 * would say so at runtime.
 */
export function MediaDeleteConfirmDescription(
  props: MediaDeleteConfirmDescriptionProps,
) {
  const { fileName, scan } = props
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    // A rejected scan is the same fact from the author's side as one that
    // could not finish, and `deleteConfirmationNote(null)` is the sentence
    // that says so (AGL-1413). Never left blank.
    scan.then(
      (result) => {
        if (live) setNote(deleteConfirmationNote(result))
      },
      () => {
        if (live) setNote(deleteConfirmationNote(null))
      },
    )
    return () => {
      live = false
    }
  }, [scan])

  return (
    <>
      <span>{deleteConfirmationLead(fileName)}</span>
      {/* Announced when it lands: a sighted author sees the sentence appear,
          and this is the equivalent for one who does not. */}
      <span aria-live="polite">{note ?? SCAN_PENDING_NOTE}</span>
    </>
  )
}
MediaDeleteConfirmDescription.displayName = 'MediaDeleteConfirmDescription'

/** What a usage scan answers with, structurally. */
export interface MediaDeleteScanResult {
  coverage: MediaScanCoverage
  items: readonly { name: string }[]
}

/** Everything the confirmation needs that the library owns. */
export interface MediaDeleteConfirmRequest {
  /** The file the author is about to delete. */
  fileName: string
  /** The asset the scan runs against. */
  mediaId: string
  /** The scan itself — the FUNCTION, so this is the tick it starts on. */
  scanReferences: (mediaId: string) => Promise<MediaDeleteScanResult>
  /** The confirmation provider's `confirm`. */
  confirm: (options: ConfirmationContextConfig) => Promise<unknown>
}

/**
 * Ask before deleting, with the usage scan running behind the dialog
 * (AGL-1461, extracted AGL-1482).
 *
 * A function rather than four lines inside `handleDelete` because the property
 * that matters here is one of CONTROL FLOW, and control flow can only be
 * proved by running it. `media-delete-wiring.spec.ts` used to assert
 * `not.toContain('await scanReferences')` over the library's source — a claim
 * about when the dialog opens, expressed as a claim about a keyword, and
 * satisfied by any rewrite that awaits the scan under another name. With the
 * flow in a module, `media-delete-confirm.spec.tsx` hands it a scan that never
 * settles and watches the dialog open anyway.
 *
 * So: the scan starts, and `confirm` is called in the SAME tick. Nothing may
 * be awaited above it. The scan walks up to a 1,500-document budget across
 * every site in the org, and awaiting it here is what made ⋮ → Delete look
 * like a dead button — long enough that the natural response was to click a
 * destructive control a second time.
 *
 * A scan that rejects becomes `null`, which
 * {@link MediaDeleteConfirmDescription} renders as the AGL-1413 "could not
 * check everywhere" sentence rather than as silence.
 *
 * @returns whether the author confirmed. A dismissed dialog rejects, and that
 *   is a `false`, not a failure.
 */
export function confirmMediaDelete(
  request: MediaDeleteConfirmRequest,
): Promise<boolean> {
  const { fileName, mediaId, scanReferences, confirm } = request
  const scan = scanReferences(mediaId).then(
    (result) => ({
      coverage: result.coverage,
      names: result.items.map((reference) => reference.name),
    }),
    () => null,
  )
  return confirm({
    title: 'Delete this file?',
    description: (
      <MediaDeleteConfirmDescription fileName={fileName} scan={scan} />
    ),
    confirmationText: 'Delete',
    confirmationButtonProps: { color: 'error' },
  }).then(
    () => true,
    () => false,
  )
}

export default MediaDeleteConfirmDescription
