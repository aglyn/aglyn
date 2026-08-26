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
   * Passed in so ONE banner covers the condition. looking
   * at both of them stacked over the canvas: they described a single event —
   * a colleague's save — in two voices, and reassured in opposite
   * directions. An editor that renders this alert must render the conflict
   * alert only while this one is absent.
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
  const found =
    `Unsaved changes to this ${noun} from ${age} were recovered from ` +
    'this browser. '
  switch (draft.restoreBlockedBy) {
    case 'saved-since':
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
          : 'Restoring puts them back on the canvas without saving; you can ' +
            'undo it.')
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
 * When the room is SHARED this banner does not render at all — `draft
 * .available` is false and there is nothing here to word (AGL-2486). should we even show them that alert,
 * that could remove the work numerous people are currently working on.
 * Discard is in fact local — it deletes this browser's snapshot and touches
 * neither the canvas nor anyone else, which is why it looked to him like it
 * did nothing — but a prompt whose only remaining button is a delete, over a
 * document several people are mid-edit in, is a question that should not be
 * asked. See `roomIsShared` in `use-besigner-draft`.
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
  // The reload is the way out of a conflict, so this banner offers it while
  // it is standing in for the conflict banner.
  const offerReload = draft.restoreBlockedBy === 'saved-since' || remoteChanged

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
              {'Restore'}
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
