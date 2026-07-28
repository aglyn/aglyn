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

import { Box, Dialog } from '@mui/material'
import ListingDetailEditor from './listing-detail-editor.component'

export interface EditListingDialogProps {
  orgId: string
  /** The listing being edited (a `communityListings` doc with `$id`). */
  listing: Record<string, any> | null
  open: boolean
  onClose: () => void
  /** Firebase user, for the ID token on the update requests. */
  user: unknown
}

/**
 * Listings-tab entry point to the listing editor (AGL-862/869). A thin dialog
 * wrapper around the same full editor the detail page uses ({@link
 * ListingDetailEditor}) — one implementation, so the WYSIWYG body, DAM image
 * pickers, and field set are identical on both surfaces.
 */
export function EditListingDialog(props: EditListingDialogProps) {
  const { orgId, listing, open, onClose, user } = props
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      {/* The editor is a full form, taller than any viewport (AGL-987). The
          dialog paper caps at the screen, so without a scroller of its own
          everything below the body — including Save — was unreachable. */}
      {/* flex:1 + minHeight:0 inside the paper's column, or the child just
          grows past the capped paper instead of scrolling within it. */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {listing ? (
          <ListingDetailEditor
            orgId={orgId}
            listingId={listing.$id}
            listing={listing}
            user={user}
            onDone={onClose}
          />
        ) : null}
      </Box>
    </Dialog>
  )
}

EditListingDialog.displayName = 'EditListingDialog'

export default EditListingDialog
