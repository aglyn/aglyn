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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'
import type * as CommerceModel from '../../model'

export interface OrderReceiptResendProps {
  hostId: string
  orderId: string
  order: Pick<CommerceModel.HostOrder, 'customerEmail' | 'customerPhone' | 'status'>
}

type Channel = 'email' | 'sms'

/**
 * "Resend receipt" (AGL-3610), for the order dialog's actions: the receipt
 * again, to the buyer's address or one the merchant types — by text too, but
 * only when the platform can send texts. The route answers which channels
 * exist (`GET /api/commerce/order-receipt-send`) when the dialog opens, so
 * "Text" is never offered on an install with no SMS provider.
 *
 * Kept out of `order-detail-dialog` on purpose: the dialog is shared by
 * several lanes, and this is one line there.
 */
export function OrderReceiptResend(props: OrderReceiptResendProps) {
  const { hostId, orderId, order } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [open, setOpen] = useState(false)
  const [channels, setChannels] = useState<{ email: boolean; sms: boolean } | null>(null)
  const [channel, setChannel] = useState<Channel>('email')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)

  const recipientFor = useCallback(
    (next: Channel) =>
      String((next === 'sms' ? order.customerPhone : order.customerEmail) ?? ''),
    [order.customerEmail, order.customerPhone],
  )

  const handleOpen = useCallback(async () => {
    setOpen(true)
    setChannel('email')
    setTo(recipientFor('email'))
    setChannels(null)
    try {
      const response = await authorizedFetch(
        user,
        `/api/commerce/order-receipt-send?hostId=${encodeURIComponent(hostId)}`,
      )
      const payload: any = await response.json().catch(() => ({}))
      setChannels(
        response.ok
          ? { email: payload.email === true, sms: payload.sms === true }
          : { email: true, sms: false },
      )
    } catch {
      setChannels({ email: true, sms: false })
    }
  }, [hostId, recipientFor, user])

  const handleSend = useCallback(async () => {
    setBusy(true)
    try {
      const response = await authorizedFetch(
        user,
        '/api/commerce/order-receipt-send',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, orderId, channel, to: to.trim() }),
        },
      )
      const payload: any = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload.error ?? 'The receipt could not be sent.', {
          variant: 'error',
        })
        return
      }
      enqueueSnackbar(channel === 'sms' ? 'Receipt texted' : 'Receipt sent', {
        variant: 'success',
        persist: false,
      })
      setOpen(false)
    } catch {
      enqueueSnackbar(
        'The request did not complete, so it is not known whether the ' +
          'receipt went. Check the order timeline before sending again.',
        { variant: 'error' },
      )
    } finally {
      setBusy(false)
    }
  }, [channel, enqueueSnackbar, hostId, orderId, to, user])

  if (order.status === 'pending') return null
  const emailOff = channels !== null && !channels.email && channel === 'email'

  return (
    <>
      <Button onClick={handleOpen}>{'Resend receipt'}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{'Resend receipt'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {channels?.sms ? (
            <RadioGroup
              row
              value={channel}
              onChange={(event) => {
                const next = event.target.value as Channel
                setChannel(next)
                setTo(recipientFor(next))
              }}
            >
              <FormControlLabel value="email" control={<Radio size="small" />} label="Email" />
              <FormControlLabel value="sms" control={<Radio size="small" />} label="Text" />
            </RadioGroup>
          ) : null}
          <TextField
            autoFocus
            size="small"
            label={channel === 'sms' ? 'Phone number' : 'Email address'}
            type={channel === 'sms' ? 'tel' : 'email'}
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
          {emailOff ? (
            <Typography variant="body2" color="text.secondary">
              {'Email is not set up on this platform, so receipts cannot be sent.'}
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            disabled={busy || !to.trim() || channels === null || emailOff}
            onClick={handleSend}
          >
            {'Send'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
OrderReceiptResend.displayName = 'OrderReceiptResend'

export default OrderReceiptResend
