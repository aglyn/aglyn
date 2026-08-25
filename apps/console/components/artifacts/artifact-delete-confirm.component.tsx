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

import { useEffect, useState } from 'react'
import {
  SCAN_PENDING_NOTE,
  deleteConfirmationLead,
  deleteConfirmationNote,
  scanIsComplete,
  type ArtifactUsageKind,
  type ArtifactUsageScan,
} from './artifact-usage-copy'

export interface ArtifactDeleteConfirmProps {
  kind: ArtifactUsageKind
  name: string
  /**
   * The usage scan, ALREADY IN FLIGHT. Passing the promise rather than the
   * result is the whole point, and it is the lesson AGL-1461 paid for on the
   * media side: awaiting the scan before calling `confirm()` means the dialog
   * appears a scan later, which reads as a dead button and invites a second
   * click on a destructive control. The scan is worth showing; it is not worth
   * holding the dialog closed for.
   */
  scan: Promise<ArtifactUsageScan | null>
}

/**
 * The body of an artifact delete confirmation, filled in live (AGL-703).
 *
 * Zach: *"When we delete anything we need to make sure we show the user where
 * it is referenced (used by) … Make sure the break friendly too."*
 *
 * Media has answered this since AGL-1461 and artifacts did not: the component
 * dialog said "existing instances render as empty placeholders" without ever
 * saying WHICH instances, on a site where the answer was one request away and
 * already rendered on the artifact's own detail page.
 *
 * Rendered inside MUI's `DialogContentText`, which is a `<p>`, so everything
 * here stays inline — a block element would be invalid nesting and React would
 * say so at runtime.
 */
export function ArtifactDeleteConfirmDescription(
  props: ArtifactDeleteConfirmProps,
) {
  const { kind, name, scan } = props
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    // A rejected scan is the same fact from the author's side as one that
    // could not finish, and `deleteConfirmationNote(null)` is the sentence
    // that says so. Never left blank, and never silently optimistic.
    scan.then(
      (result) => {
        if (live) setNote(deleteConfirmationNote(result, kind))
      },
      () => {
        if (live) setNote(deleteConfirmationNote(null, kind))
      },
    )
    return () => {
      live = false
    }
  }, [scan, kind])

  return (
    <>
      <span>{deleteConfirmationLead(kind, name)}</span>
      {/* Announced when it lands: a sighted author sees the sentence appear,
          and this is the equivalent for one who does not. */}
      <span aria-live="polite">{note ?? SCAN_PENDING_NOTE}</span>
    </>
  )
}
ArtifactDeleteConfirmDescription.displayName =
  'ArtifactDeleteConfirmDescription'

/**
 * Starts the where-used scan for a delete confirmation.
 *
 * ⚠️ Resolves to `null` on ANY failure rather than rejecting or throwing, and
 * the copy treats `null` as "could not check". That is deliberate and it is
 * the opposite of `UsedByCard`'s posture, which renders a failure as a
 * failure: there the card IS the answer, so a silent empty list would invite
 * the deletion it exists to prevent. Here the delete proceeds either way and
 * the sentence's job is to say honestly that it could not look.
 */
export async function fetchArtifactUsage(options: {
  hostId: string
  kind: ArtifactUsageKind
  id: string
  idToken?: string
}): Promise<ArtifactUsageScan | null> {
  const { hostId, kind, id, idToken } = options
  try {
    const response = await fetch('/api/hosts/where-used', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({ hostId, kind, id }),
    })
    if (!response.ok) return null
    const payload = await response.json()
    return {
      dependents: Array.isArray(payload?.dependents) ? payload.dependents : [],
      // Absent reads as INCOMPLETE — see `scanIsComplete`. An older deployment
      // that does not send the field must not be read as a clean bill.
      complete: scanIsComplete(payload?.complete),
    }
  } catch {
    return null
  }
}

export default ArtifactDeleteConfirmDescription
