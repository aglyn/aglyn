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

import type * as Aglyn from '@aglyn/aglyn'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material'
import MediaLibraryComponent from './media-library.component'

export interface MediaPickerDialogProps {
  hostId: string
  open: boolean
  onClose: () => void
  /** Receives the chosen media (use `media.url` for image src props). */
  onPick: (media: Aglyn.AglynHostMedia) => void
}

/** Browse/upload-and-pick dialog around the media library (AGL-73). */
export function MediaPickerDialog(props: MediaPickerDialogProps) {
  const { hostId, open, onClose, onPick } = props
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{'Choose media'}</DialogTitle>
      <DialogContent>
        <MediaLibraryComponent
          hostId={hostId}
          onSelect={(media) => {
            onPick(media)
            onClose()
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
      </DialogActions>
    </Dialog>
  )
}
MediaPickerDialog.displayName = 'MediaPickerDialog'

export default MediaPickerDialog
