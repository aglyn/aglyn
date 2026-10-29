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

import * as CommerceModel from '../../model'
import { commerceSitePermissionRefusal } from '../../model/plugin-permissions'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'

const SEND_REFUSAL = commerceSitePermissionRefusal('commerce.quotes.send')

export interface QuotePayLinkSectionProps {
  hostId: string
  quoteId: string
  quote: Pick<CommerceModel.HostOrder, 'status' | 'channel' | 'number'>
  /** Holds "Send quotes and invoices to customers" (`commerce.quotes.send`). */
  canSend: boolean
  /** The editor holds changes not saved yet, which the link does not show. */
  edited: boolean
}

/**
 * A quote's pay link (AGL-4094): the address the business sends the
 * customer, which opens the quote on the business's own site with a Pay
 * button. "Copy pay link" asks the server for it (it is signed there) and puts
 * it on the clipboard and on screen; "Replace link" makes a new one and the
 * one sent before stops opening the quote.
 */
export function QuotePayLinkSection(props: QuotePayLinkSectionProps) {
  const { hostId, quoteId, quote, canSend, edited } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmingReplace, setConfirmingReplace] = useState(false)
  const unpaid = CommerceModel.isUnpaidQuote(quote)

  const ask = useCallback(
    async (action: 'pay-link' | 'replace-link'): Promise<string | null> => {
      setBusy(true)
      try {
        const response = await authorizedFetch(user, '/api/commerce/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, hostId, quoteId }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || !payload?.url) {
          enqueueSnackbar(payload?.error ?? 'The pay link could not be made', { variant: 'error', allowDuplicate: true })
          return null
        }
        setUrl(String(payload.url))
        return String(payload.url)
      } finally {
        setBusy(false)
      }
    },
    [user, hostId, quoteId, enqueueSnackbar],
  )

  const copy = useCallback(
    async (link: string, done: string) => {
      try {
        await navigator.clipboard.writeText(link)
        enqueueSnackbar(done, { variant: 'success', persist: false })
      } catch {
        // The link is on screen to copy by hand when the clipboard is refused.
        enqueueSnackbar('Copy the link below to send it', { variant: 'info', persist: false })
      }
    },
    [enqueueSnackbar],
  )

  const copyLink = useCallback(async () => {
    const link = url || (await ask('pay-link'))
    if (link) await copy(link, 'Pay link copied')
  }, [url, ask, copy])

  const replaceLink = useCallback(async () => {
    const link = await ask('replace-link')
    setConfirmingReplace(false)
    if (link) await copy(link, 'New pay link copied. The earlier link no longer opens the quote.')
  }, [ask, copy])

  return (
    <Stack spacing={1.5}>
      <Stack spacing={0.5}>
        <Typography variant="subtitle2">{'Pay link'}</Typography>
        <Typography variant="body2" color="text.secondary">
          {unpaid
            ? 'Send this link to the customer. It opens the quote on your site, where they can pay it.'
            : 'The link opens the paid quote and the customer’s order.'}
        </Typography>
        {edited && unpaid ? (
          <Typography variant="body2" color="text.secondary">
            {'Save your changes first: the link opens the quote as it was last saved.'}
          </Typography>
        ) : null}
      </Stack>
      {url ? (
        <TextField
          label="Pay link"
          value={url}
          size="small"
          fullWidth
          slotProps={{ htmlInput: { readOnly: true }, inputLabel: { shrink: true } }}
          onFocus={(event) => event.target.select()}
        />
      ) : null}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <BlockedControl blocked={!canSend} reason={SEND_REFUSAL}>
          <Button variant="outlined" size="small" disabled={busy} onClick={() => void copyLink()}>
            {'Copy pay link'}
          </Button>
        </BlockedControl>
        {unpaid ? (
          <BlockedControl blocked={!canSend} reason={SEND_REFUSAL}>
            <Button size="small" disabled={busy} onClick={() => setConfirmingReplace(true)}>
              {'Replace link'}
            </Button>
          </BlockedControl>
        ) : null}
      </Stack>
      <Dialog open={confirmingReplace} onClose={() => setConfirmingReplace(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{'Replace the pay link?'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {'The link you sent before will stop working: it will tell the customer the quote was updated, ' +
              'and show nothing of it. Send them the new link.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmingReplace(false)} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button variant="contained" disabled={busy} onClick={() => void replaceLink()}>
            {'Replace link'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
QuotePayLinkSection.displayName = 'QuotePayLinkSection'

export default QuotePayLinkSection
