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
 * Offers back unsaved work a crash or reload took away (AGL-1256).
 *
 * It asks rather than restoring on its own. Silently replacing a document
 * with a local snapshot would be a worse bug than the one being fixed — and
 * the author is the only one who knows whether the version they are looking
 * at is the one they meant to be in.
 */
export function BesignerDraftAlertComponent(props: BesignerDraftAlertProps) {
  const { draft, noun } = props
  if (!draft.available) return null

  return (
    <Alert
      severity={draft.staleAgainstDocument ? 'warning' : 'info'}
      sx={{ borderRadius: 0, position: 'relative', zIndex: 'appBar' }}
      action={
        <Stack direction="row" spacing={1}>
          <Button color="inherit" size="small" onClick={draft.restore}>
            {'Restore'}
          </Button>
          <Button color="inherit" size="small" onClick={draft.discard}>
            {'Discard'}
          </Button>
        </Stack>
      }
    >
      {`Unsaved changes to this ${noun} from ` +
        `${describeDraftAge(draft.takenAt, Date.now())} were recovered from ` +
        'this browser. ' +
        (draft.staleAgainstDocument
          ? 'Someone else has saved since then, so restoring will not ' +
            'overwrite their work — you will be asked to reload before you ' +
            'can save.'
          : 'Restoring puts them back on the canvas without saving; you can ' +
            'undo it.')}
    </Alert>
  )
}

export default BesignerDraftAlertComponent
