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
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useRef, useState } from 'react'
import { displayMoney } from '../pos-display/pos-display-api'
import type { RegisterLine } from './pos-cart-panel.component'
import { posKioskCall, PosRequestError, type PosSaleSummary } from './pos-api'

type User = Parameters<typeof posKioskCall>[0]

interface QueueEntry {
  orderId: string
  number: number
  queuedAtMs: number
  totalCents: number
  itemCount: number
}

/** How often the register looks for orders a kiosk sent to the counter. */
export const POS_KIOSK_QUEUE_POLL_MS = 10_000

/**
 * "Pay at counter" orders from this register's self-service kiosks
 * (AGL-3623), oldest first. Each is an open sale the kiosk already priced;
 * Take payment loads it into the register's tender panel, where the cashier
 * takes payment exactly as on a sale they rang themselves. Draws nothing
 * when the queue is empty.
 */
export function PosKioskQueue({
  user,
  hostId,
  registerId,
  disabled,
  onTake,
  notify,
}: {
  user: User | null | undefined
  hostId: string
  registerId: string
  /** A sale is already open on the register. */
  disabled: boolean
  onTake: (sale: PosSaleSummary, lines: RegisterLine[]) => void
  notify: (message: string, variant: 'error' | 'info') => void
}) {
  const [entries, setEntries] = useState<QueueEntry[]>([])
  const [currency, setCurrency] = useState('usd')
  const [taking, setTaking] = useState<string | null>(null)
  const userRef = useRef(user)
  userRef.current = user
  const uid = (user as { uid?: string } | null | undefined)?.uid ?? ''

  const load = useCallback(async () => {
    const signedIn = userRef.current
    if (!signedIn || !registerId) return
    try {
      const result = await posKioskCall<{ entries: QueueEntry[]; currency: string }>(
        signedIn,
        { action: 'queue', hostId, registerId },
        'GET',
      )
      setEntries(result.entries ?? [])
      if (result.currency) setCurrency(result.currency)
    } catch {
      // A missed poll is retried on the next tick; the queue keeps what it showed.
    }
  }, [hostId, registerId])

  useEffect(() => {
    if (!uid || !registerId) {
      setEntries([])
      return undefined
    }
    void load()
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void load()
    }, POS_KIOSK_QUEUE_POLL_MS)
    return () => clearInterval(timer)
  }, [uid, registerId, load])

  // A sale closing on the register is the moment a queued one may have gone.
  useEffect(() => {
    if (!disabled) void load()
  }, [disabled, load])

  if (!registerId || entries.length === 0) return null

  const take = async (entry: QueueEntry) => {
    if (!user) return
    setTaking(entry.orderId)
    try {
      const result = await posKioskCall<{ sale: PosSaleSummary; lines: RegisterLine[] }>(user, {
        action: 'take',
        hostId,
        registerId,
        orderId: entry.orderId,
      })
      onTake(result.sale, result.lines ?? [])
    } catch (error) {
      notify(error instanceof PosRequestError ? error.message : 'That order could not be opened', 'error')
      void load()
    } finally {
      setTaking(null)
    }
  }

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardHeader
        title="Kiosk orders"
        subheader="Sent to the counter to pay"
        slotProps={{ title: { variant: 'subtitle1', component: 'h2' } }}
      />
      <CardContent sx={{ pt: 0 }}>
        <Stack divider={<Divider flexItem />} spacing={1}>
          {entries.map((entry) => (
            <Stack key={entry.orderId} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <Typography variant="h6" component="span" sx={{ minWidth: (theme) => theme.spacing(8) }}>
                {`#${entry.number}`}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                {`${entry.itemCount} ${entry.itemCount === 1 ? 'item' : 'items'} · ${displayMoney(entry.totalCents, currency)}`}
              </Typography>
              <Button
                variant="contained"
                size="small"
                disabled={disabled || Boolean(taking)}
                onClick={() => void take(entry)}
              >
                {taking === entry.orderId ? 'Opening…' : 'Take payment'}
              </Button>
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  )
}
