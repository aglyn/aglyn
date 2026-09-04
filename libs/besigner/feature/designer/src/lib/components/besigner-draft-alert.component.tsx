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

import { Alert, Button, Stack } from '@mui/material'
import type { BesignerDraftState } from '../hooks/use-besigner-draft'

export interface BesignerDraftAlertProps {
  draft: BesignerDraftState
  /** 'screen', 'layout', 'component', 'template', 'email'. */
  noun: string
  /**
   * Someone else saved this document since it loaded, i.e. what
   * `BesignerConflictAlertComponent` says on its own (AGL-2486).
   *
   * Passed in so ONE banner covers the condition. Stacked, the two describe a
   * single event — a colleague's save — in two voices, and reassure in
   * opposite directions. An editor that renders this alert must render the
   * conflict alert only while this one is absent.
   */
  remoteChanged?: boolean
}

/** "3 minutes ago" — coarse on purpose; the exact second helps nobody. */
export function describeDraftAge(takenAt: number | null, now: number): string {
  if (!takenAt) return 'a moment ago'
  const minutes = Math.floor(Math.max(0, now - takenAt) / 60_000)
  if (minutes < 1) return 'less than a minute ago'
  if (minutes === 1) return '1 minute ago'
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours === 1) return 'about an hour ago'
  if (hours < 24) return `about ${hours} hours ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'about a day ago' : `about ${days} days ago`
}

/**
 * The message this alert carries, given what the draft can and cannot do.
 *
 * Exported for its spec: the copy is the product decision in AGL-2486 —
 * which of two "unsaved" states the author is looking at, and whether the
 * one in this browser may still be put back — so it is asserted directly
 * rather than through a rendered tree.
 */
export function describeDraftOffer(
  draft: BesignerDraftState,
  noun: string,
  now: number,
  remoteChanged = false,
): string {
  const age = describeDraftAge(draft.takenAt, now)
  /**
   * The SHARED working draft is a different sentence from the crash net, and
   * saying the crash net's one over it is the AGL-2508 defect: an author who
   * pressed Save draft, was told "Draft saved", and came back to
   * "Unsaved changes … were recovered from this browser" reads a save that
   * failed and a browser that rescued them. Both halves are wrong — it saved,
   * and it is on the server — and the reasonable conclusion is that the
   * editor loses work, which sends people re-doing edits they already have.
   *
   * The canvas loads the stored document and the draft is OFFERED rather than
   * applied, which is the right call and is not what changes here. What
   * changes is that the offer now says which of the two it is.
   */
  const found =
    draft.origin === 'shared'
      ? `This ${noun} has a saved draft from ${age} that has not been ` +
        'published. It is stored with the site, so anyone who opens this ' +
        `${noun} sees it offered. `
      : `Unsaved changes to this ${noun} from ${age} were recovered from ` +
        'this browser. '
  switch (draft.restoreBlockedBy) {
    case 'saved-since':
      // Whether saving is PAUSED is a different fact from whether the draft
      // may be put back, and only `remoteChanged` can answer it. A draft
      // stranded by a save that landed before this editor even opened blocks
      // nothing: the canvas holds the stored document, Save works, and there
      // is no conflict to reload out of. Claiming otherwise sent authors
      // reloading a document nobody had touched in days, looking for a
      // colleague who was not there.
      if (!remoteChanged) {
        return (
          `This ${noun} has been saved since the unsaved changes from ${age} ` +
          'in this browser were taken, so putting them back would undo that ' +
          'save — they are not offered. Nothing else is affected: this ' +
          'canvas holds the saved document and saving works as usual.'
        )
      }
      // One banner for one event. The conflict half comes first because it
      // is the thing that already happened; the draft half is what the
      // author is being told they cannot do about it.
      return (
        `Someone else saved this ${noun} while you were editing, so saving ` +
        'is paused until you reload — nothing on this canvas is lost until ' +
        `then. Unsaved changes from ${age} were also found in this browser, ` +
        'but they pre-date their save: putting them back would roll it ' +
        'back, so they are not offered.'
      )
    default:
      return (
        found +
        (remoteChanged
          ? `Someone else has also saved this ${noun} since it loaded, so ` +
            'saving is paused until you reload. Restoring puts your changes ' +
            'back on the canvas without saving; you can undo it.'
          : draft.origin === 'shared'
            ? 'Opening it puts it back on the canvas; publish when you are ' +
              'ready, or discard it to go back to what is live.'
            : 'Restoring puts them back on the canvas without saving; you ' +
              'can undo it.')
      )
  }
}

/**
 * Offers back unsaved work a crash or reload took away (AGL-1256), and says
 * when it may not be offered (AGL-2486).
 *
 * It asks rather than restoring on its own. Silently replacing a document
 * with a local snapshot would be a worse bug than the one being fixed — and
 * the author is the only one who knows whether the version they are looking
 * at is the one they meant to be in.
 *
 * When the room is SHARED this banner does not render at all. Discard never
 * touches the canvas, so nothing anybody is looking at changes when it is
 * pressed — but it does delete the draft, in both stores, and a prompt whose
 * only remaining button is a delete, over a document several people are
 * mid-edit in, is a question that should not be asked. See `roomIsShared` in
 * `use-besigner-draft`.
 *
 * What is left here is the case where this editor is alone and something
 * still stands in the way of a restore: a colleague SAVED while the draft
 * was stranded, or the mirror replayed work onto the canvas while presence
 * could not report the room. Restoring is a whole-map replace that the
 * co-edit mirror publishes verbatim, so the older "restoring will not
 * overwrite their work" was not true from the colleague's side of the
 * screen: their unsaved node was deleted on their own canvas, and a stale
 * restore survived the reload this banner asks for.
 */
export function BesignerDraftAlertComponent(props: BesignerDraftAlertProps) {
  const { draft, noun, remoteChanged = false } = props
  if (!draft.available) return null
  const blocked = draft.restoreBlockedBy !== null
  // The reload is the way out of a CONFLICT, so it is offered exactly while
  // this banner is standing in for the conflict one. A stranded draft with no
  // conflict behind it has nothing to reload for — the canvas already holds
  // the stored document — and a Reload button there reads as an instruction
  // to fix something that is not broken.
  const offerReload = remoteChanged

  return (
    <Alert
      severity={blocked || remoteChanged ? 'warning' : 'info'}
      sx={{ borderRadius: 0, position: 'relative', zIndex: 'appBar' }}
      action={
        <Stack direction="row" spacing={1}>
          {offerReload ? (
            <Button
              color="inherit"
              size="small"
              onClick={() => window.location.reload()}
            >
              {'Reload'}
            </Button>
          ) : null}
          {blocked ? null : (
            <Button color="inherit" size="small" onClick={draft.restore}>
              {/* A saved draft is OPENED; only unsaved work is restored. */}
              {draft.origin === 'shared' ? 'Open draft' : 'Restore'}
            </Button>
          )}
          <Button color="inherit" size="small" onClick={draft.discard}>
            {'Discard'}
          </Button>
        </Stack>
      }
    >
      {describeDraftOffer(draft, noun, Date.now(), remoteChanged)}
    </Alert>
  )
}

export default BesignerDraftAlertComponent
