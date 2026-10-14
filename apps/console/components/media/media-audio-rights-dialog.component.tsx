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

import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'
import { AUDIO_RIGHTS_STATEMENT } from '../../utils/media-audio-rights'

export interface MediaAudioRightsDialogProps {
  /** The audio files about to be uploaded, by name; empty closes the dialog. */
  fileNames: readonly string[]
  /** `true` once the box is ticked and Upload pressed; `false` on cancel. */
  onAnswer: (confirmed: boolean) => void
}

/**
 * The rights confirmation an audio upload needs (AGL-3716).
 *
 * Asked once for a batch: every audio file in it is named, and the one
 * sentence the uploader ticks is the sentence the server stores beside who
 * ticked it and when. Upload stays disabled until it is ticked, and the box
 * starts unticked every time — a confirmation carried over from an earlier
 * batch would be an answer to a question about different files.
 */
export function MediaAudioRightsDialog({ fileNames, onAnswer }: MediaAudioRightsDialogProps) {
  const open = fileNames.length > 0
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    if (open) setChecked(false)
  }, [open, fileNames])
  const one = fileNames.length === 1
  return (
    <Dialog
      open={open}
      onClose={() => onAnswer(false)}
      aria-labelledby="media-audio-rights-title"
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle id="media-audio-rights-title">
        {'Confirm your rights to this audio'}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          {one
            ? `You are uploading "${fileNames[0]}".`
            : `You are uploading ${fileNames.length} audio files: ${fileNames.join(', ')}.`}{' '}
          Only upload music you made, or have a license to publish. Tracks by other
          artists cannot be played on your site without their permission, and are taken
          down when the rights holder reports them.
        </Typography>
        <FormControlLabel
          control={
            <Checkbox
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
          }
          label={AUDIO_RIGHTS_STATEMENT}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onAnswer(false)}>Cancel</Button>
        <Button variant="contained" disabled={!checked} onClick={() => onAnswer(true)}>
          Upload
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default MediaAudioRightsDialog
