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
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import type { PublisherAgreementConsent } from '../model/publisher-agreement'
import {
  PublisherAgreementCheckbox,
  usePublisherAgreementConsent,
} from './publisher-agreement-checkbox.component'

export interface PublisherAgreementConfirmDialogProps {
  open: boolean
  title: string
  /** What the change does, in a sentence. */
  body: string
  confirmLabel: string
  /** In the error color: it takes a listing out of the marketplace. */
  destructive?: boolean
  /**
   * Makes the change with the agreement. Resolves to null when it went
   * through, which closes the dialog, or to the message to show when it was
   * refused, which keeps it open.
   */
  onConfirm: (consent: PublisherAgreementConsent) => Promise<string | null>
  onClose: () => void
}

/**
 * A one-click publisher change asked first, with the agreement box above its
 * button (AGL-4105): making a listing private or public, unpublishing or
 * republishing it. Those were menu items that saved on the click; a save in
 * the marketplace now agrees to the Publisher Agreement first, so the click
 * opens this, and the change is made from here.
 */
export function PublisherAgreementConfirmDialog(
  props: PublisherAgreementConfirmDialogProps,
) {
  const { open, title, body, confirmLabel, destructive = false, onConfirm, onClose } = props
  const agreement = usePublisherAgreementConsent()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { reset } = agreement

  // Every opening asks again.
  useEffect(() => {
    if (!open) return
    reset()
    setError(null)
  }, [open, reset])

  const confirm = async () => {
    if (!agreement.consent || busy) return
    setBusy(true)
    setError(null)
    try {
      const refused = await onConfirm(agreement.consent)
      if (refused) return void setError(refused)
      reset()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {body}
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <PublisherAgreementCheckbox
            checked={agreement.agreed}
            onChange={agreement.setAgreed}
            disabled={busy}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button
          size="small"
          variant="contained"
          color={destructive ? 'error' : 'primary'}
          disabled={busy || !agreement.agreed}
          onClick={() => void confirm()}
        >
          {busy ? 'Saving…' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

PublisherAgreementConfirmDialog.displayName = 'PublisherAgreementConfirmDialog'

export default PublisherAgreementConfirmDialog
