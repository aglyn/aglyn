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

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { ArtifactUsageNote } from '../artifacts/artifact-delete-confirm.component'
import type { ArtifactUsageScan } from '../artifacts/artifact-usage-copy'

export interface CollectionDeleteDialogProps {
  open: boolean
  /** The collection being deleted, as the content scope holds it. */
  collection: { displayName?: string | null; slug?: string | null } | null
  /**
   * Why the delete is refused — `collectionDeleteDenial`'s answer — or null
   * when no entry or template screen still depends on the collection.
   */
  denial: { error: string } | null
  /**
   * What links to the collection's listing page: the where-used scan, ALREADY
   * IN FLIGHT when the dialog opens, for the reason
   * `ArtifactDeleteConfirmDescription` gives. Null until one has started.
   */
  scan: Promise<ArtifactUsageScan | null> | null
  /** The typed confirmation, which must equal the display name. */
  confirmText: string
  onConfirmTextChange: (value: string) => void
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}

/**
 * Delete collection (AGL-1324): a type-the-name confirmation, matching the
 * site delete.
 *
 * It refuses while a template screen still renders the collection or entries
 * still live under it, naming which, because deleting a collection must never
 * be the act that removes a published page.
 *
 * It also names the published screens, layouts and components that link to
 * the collection's listing page, the warning a screen delete gives about links
 * to the screen (AGL-2806). Those links are not a refusal — the pages holding
 * them keep rendering — but after the delete each renders with no address, so
 * this list is the one chance to see them before a visitor does. It shows
 * beside a refusal too: the links need repointing whichever blocker is cleared
 * first.
 */
export function CollectionDeleteDialog(props: CollectionDeleteDialogProps) {
  const {
    open,
    collection,
    denial,
    scan,
    confirmText,
    onConfirmTextChange,
    busy,
    onClose,
    onConfirm,
  } = props
  const name = collection?.displayName ?? ''
  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>{`Delete "${name}"?`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {denial ? (
            <Alert severity="warning">{denial.error}</Alert>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {`The collection and its /${collection?.slug ?? ''} route are ` +
                'permanently deleted. This cannot be undone.'}
            </Typography>
          )}
          {scan ? (
            <Typography variant="body2" color="text.secondary">
              <ArtifactUsageNote kind="collection" scan={scan} />
            </Typography>
          ) : null}
          <TextField
            label={`Type "${name}" to confirm`}
            value={confirmText}
            disabled={busy || denial !== null}
            onChange={(event) => onConfirmTextChange(event.target.value)}
            size="small"
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          color="error"
          disabled={busy || denial !== null || confirmText.trim() !== name}
          onClick={onConfirm}
        >
          {'Delete collection'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
CollectionDeleteDialog.displayName = 'CollectionDeleteDialog'

export default CollectionDeleteDialog
