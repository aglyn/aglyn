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
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tooltip,
  Typography,
} from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import useFirestoreCollection from '../../hooks/use-firestore-collection'
import useHostOrgId from '../../hooks/use-host-org-id'
import MediaLibraryComponent from './media-library.component'

export interface MediaPickerDialogProps {
  hostId: string
  open: boolean
  onClose: () => void
  /** Receives the chosen media (use `media.url` for image src props). */
  onPick: (media: Aglyn.AglynHostMedia) => void
}

/**
 * Shared org images pickable beside the host library (AGL-237). Only
 * images surface here — the picker feeds src props.
 */
function OrgMediaStrip(props: {
  hostId: string
  onPick: MediaPickerDialogProps['onPick']
}) {
  const { hostId, onPick } = props
  const firestore = useFirestore()
  const orgId = useHostOrgId(hostId)
  const { data: items } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'orgs', orgId ?? '-pending-', 'media'),
        limit(100),
      ),
    [firestore, orgId],
    { idField: '$id' },
  )
  const images = (items ?? []).filter((item: any) =>
    String(item.contentType ?? '').startsWith('image/'),
  )
  if (!orgId || images.length === 0) return null
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {'Organization media (shared)'}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {images.map((item: any) => (
          <Tooltip key={item.$id} title={item.fileName}>
            <Box
              component="img"
              src={item.url}
              alt={item.fileName}
              onClick={() => onPick(item as Aglyn.AglynHostMedia)}
              sx={{
                width: 84,
                height: 84,
                objectFit: 'cover',
                borderRadius: 1,
                cursor: 'pointer',
                border: 1,
                borderColor: 'divider',
                '&:hover': { borderColor: 'secondary.main' },
              }}
            />
          </Tooltip>
        ))}
      </Box>
    </Box>
  )
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
        <OrgMediaStrip
          hostId={hostId}
          onPick={(media) => {
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
