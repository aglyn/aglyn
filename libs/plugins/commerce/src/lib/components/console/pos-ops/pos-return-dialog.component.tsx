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
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useMemo, useRef, useState } from 'react'
import { posMoney, type PosTenderMethod } from '../../../model/commerce-pos-ops'
import { callPosOps, newPosAttemptKey, parsePosDollars } from './pos-ops-api'
import { PosPinPad, type PosStaffAssertion } from './pos-pin-pad.component'

/** One order as the return lookup lists it. */
interface ReturnOrder {
  id: string
  label: string
  status: string
  createdAtMs: number
  customerEmail: string | null
  customerName: string | null
  totalCents: number
  refundedCents: number
  returnable: boolean
  lines: Array<{
    index: number
    name: string
    variantLabel: string | null
    quantity: number
    returned: number
    valueCents: number
  }>
  tenders: Array<{
    id: string
    method: PosTenderMethod
    label: string
    amountCents: number
    refundableCents: number
  }>
}

interface ReturnResult {
  refundedCents: number
  outstandingCents: number
  partial: boolean
  cashOutCents: number
  restockedUnits: number
  tenders: Array<{ label: string; amountCents: number; status: string; error?: string }>
}

export interface PosReturnDialogProps {
  open: boolean
  hostId: string
  registerId: string
  cashierAssertion?: string
  onClose: () => void
  /** Ring the exchange: a new sale for the same customer. */
  onExchange?: (customer: { email: string | null; name: string | null }) => void
}

/** What returning `quantity` more of a line refunds, by the server's cumulative split. */
function lineRefundCents(line: ReturnOrder['lines'][number], quantity: number): number {
  if (!(quantity > 0)) return 0
  const { valueCents, quantity: total, returned } = line
  return Math.round((valueCents * (returned + quantity)) / total) - Math.round((valueCents * returned) / total)
}

/**
 * A return at the register (AGL-3609): find the sale by its number — typed or
 * scanned off the receipt's barcode — or by the customer's email, pick what
 * came back, and refund it to the payments the sale was made with. Above
 * the cashier's limit it asks for a manager's PIN, and when it is done it
 * says exactly how much cash to hand over.
 */
export function PosReturnDialog(props: PosReturnDialogProps) {
  const { open, hostId, registerId, cashierAssertion, onClose } = props
  const { data: user } = useUser()
  const [text, setText] = useState('')
  const [orders, setOrders] = useState<ReturnOrder[] | null>(null)
  const [order, setOrder] = useState<ReturnOrder | null>(null)
  const [picked, setPicked] = useState<Record<number, number>>({})
  const [restock, setRestock] = useState(true)
  const [reason, setReason] = useState('')
  const [splitByHand, setSplitByHand] = useState(false)
  const [split, setSplit] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ReturnResult | null>(null)
  const [managerPrompt, setManagerPrompt] = useState('')
  const attempt = useRef('')

  const reset = () => {
    setText('')
    setOrders(null)
    setOrder(null)
    setPicked({})
    setRestock(true)
    setReason('')
    setSplitByHand(false)
    setSplit({})
    setError('')
    setResult(null)
    setManagerPrompt('')
    attempt.current = ''
  }
  const close = () => {
    reset()
    onClose()
  }

  const find = async () => {
    if (!text.trim()) return
    setBusy(true)
    setError('')
    const answer = await callPosOps<{ orders?: ReturnOrder[] }>(user, 'pos-return', {
      hostId,
      action: 'find',
      text: text.trim(),
    })
    setBusy(false)
    if (!answer.ok) return setError(answer.body.error ?? 'Could not look the order up.')
    const found = answer.body.orders ?? []
    setOrders(found)
    if (found.length === 1) choose(found[0]!)
  }

  const choose = (next: ReturnOrder) => {
    setOrder(next)
    setPicked({})
    setSplit({})
    attempt.current = ''
  }

  const picks = useMemo(
    () =>
      Object.entries(picked)
        .map(([index, quantity]) => ({ index: Number(index), quantity }))
        .filter((pick) => pick.quantity > 0),
    [picked],
  )
  const refundCents = useMemo(() => {
    if (!order) return 0
    const asked = picks.reduce((sum, pick) => sum + lineRefundCents(order.lines[pick.index]!, pick.quantity), 0)
    return Math.min(asked, Math.max(0, order.totalCents - order.refundedCents))
  }, [order, picks])

  const submit = async (managerAssertion?: string) => {
    if (!order || !picks.length) return
    // One attempt per return: a retried tap or the manager's approval reuses it.
    if (!attempt.current) attempt.current = newPosAttemptKey()
    let tenders: Array<{ paymentId: string; amountCents: number }> | undefined
    if (splitByHand) {
      tenders = []
      for (const tender of order.tenders) {
        const cents = parsePosDollars(split[tender.id] ?? '')
        if (cents) tenders.push({ paymentId: tender.id, amountCents: cents })
      }
    }
    setBusy(true)
    setError('')
    const answer = await callPosOps<ReturnResult & { needsManager?: boolean }>(
      user,
      'pos-return',
      {
        hostId,
        registerId,
        action: 'refund',
        orderId: order.id,
        lines: picks,
        restock,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(tenders ? { tenders } : {}),
        ...(cashierAssertion ? { cashierAssertion } : {}),
        ...(managerAssertion ? { managerAssertion } : {}),
      },
      { idempotencyKey: attempt.current },
    )
    setBusy(false)
    if (answer.status === 403 && answer.body.needsManager) {
      setManagerPrompt(answer.body.error ?? "This refund needs a manager's PIN.")
      return
    }
    if (!answer.ok) {
      // A refusal moved no money; a new tap is a new attempt.
      attempt.current = ''
      return setError(answer.body.error ?? 'The return could not be refunded.')
    }
    setResult(answer.body)
  }

  const onManager = (assertion: PosStaffAssertion) => {
    setManagerPrompt('')
    void submit(assertion.assertion)
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : close} maxWidth="sm" fullWidth>
      <DialogTitle>{result ? 'Return refunded' : order ? `Return from ${order.label}` : 'Return or exchange'}</DialogTitle>
      <DialogContent>
        {result ? (
          <Stack spacing={1.5}>
            {result.cashOutCents > 0 ? (
              <Alert severity="info">{`Give the customer ${posMoney(result.cashOutCents)} from the drawer.`}</Alert>
            ) : null}
            {result.tenders.map((tender, index) => (
              <Stack key={index} direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="body2">{tender.label}</Typography>
                <Typography variant="body2" color={tender.status === 'failed' ? 'error' : 'text.primary'}>
                  {tender.status === 'failed' ? `Failed — ${tender.error ?? ''}` : posMoney(tender.amountCents)}
                </Typography>
              </Stack>
            ))}
            {result.partial ? (
              <Alert severity="warning">
                {`${posMoney(result.outstandingCents)} could not go back to the card. Pay it another way and note it on the order.`}
              </Alert>
            ) : null}
            {result.restockedUnits > 0 ? (
              <Typography variant="caption" color="text.secondary">
                {`${result.restockedUnits} ${result.restockedUnits === 1 ? 'unit' : 'units'} back in stock.`}
              </Typography>
            ) : null}
          </Stack>
        ) : order ? (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {[order.customerName, order.customerEmail, new Date(order.createdAtMs).toLocaleDateString()]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
            {!order.returnable ? (
              <Alert severity="warning">{`This order is ${order.status} and cannot be returned.`}</Alert>
            ) : null}
            {order.lines.map((line) => {
              const left = line.quantity - line.returned
              const quantity = picked[line.index] ?? 0
              return (
                <Stack key={line.index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Stack sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {line.name}
                      {line.variantLabel ? ` (${line.variantLabel})` : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {left > 0 ? `${left} of ${line.quantity} can be returned` : 'Already returned'}
                    </Typography>
                  </Stack>
                  <IconButton
                    aria-label={`One fewer ${line.name}`}
                    disabled={quantity <= 0}
                    onClick={() => setPicked({ ...picked, [line.index]: quantity - 1 })}
                  >
                    {'−'}
                  </IconButton>
                  <Typography variant="subtitle2" sx={{ minWidth: 24, textAlign: 'center' }}>
                    {quantity}
                  </Typography>
                  <IconButton
                    aria-label={`One more ${line.name}`}
                    disabled={quantity >= left || !order.returnable}
                    onClick={() => setPicked({ ...picked, [line.index]: quantity + 1 })}
                  >
                    {'+'}
                  </IconButton>
                </Stack>
              )
            })}
            <FormControlLabel
              control={<Checkbox checked={restock} onChange={(event) => setRestock(event.target.checked)} />}
              label="Put the items back in stock at this register's location"
            />
            <TextField
              size="small"
              label="Reason (optional)"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Stack spacing={0.5}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="subtitle2">{`Refund ${posMoney(refundCents)}`}</Typography>
                {order.tenders.length > 1 ? (
                  <FormControlLabel
                    control={<Switch size="small" checked={splitByHand} onChange={(event) => setSplitByHand(event.target.checked)} />}
                    label="Split by hand"
                  />
                ) : null}
              </Stack>
              {order.tenders.map((tender) =>
                splitByHand ? (
                  <TextField
                    key={tender.id}
                    size="small"
                    label={`${tender.label} (up to ${posMoney(tender.refundableCents)})`}
                    value={split[tender.id] ?? ''}
                    onChange={(event) => setSplit({ ...split, [tender.id]: event.target.value })}
                    inputMode="decimal"
                  />
                ) : (
                  <Typography key={tender.id} variant="caption" color="text.secondary">
                    {`${tender.label}: paid ${posMoney(tender.amountCents)}, ${posMoney(tender.refundableCents)} refundable`}
                  </Typography>
                ),
              )}
              {!splitByHand && order.tenders.length > 1 ? (
                <Typography variant="caption" color="text.secondary">
                  {'Cards are refunded first, then gift cards and room charges; cash comes out of the drawer last.'}
                </Typography>
              ) : null}
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <TextField
              autoFocus
              label="Order number, receipt barcode or customer email"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void find()
              }}
            />
            {orders && !orders.length ? (
              <Typography variant="body2" color="text.secondary">
                {'No order matches. Check the number on the receipt.'}
              </Typography>
            ) : null}
            {orders && orders.length > 1 ? (
              <List dense disablePadding>
                {orders.map((candidate) => (
                  <ListItemButton key={candidate.id} onClick={() => choose(candidate)}>
                    <ListItemText
                      primary={`${candidate.label} · ${posMoney(candidate.totalCents)}`}
                      secondary={`${new Date(candidate.createdAtMs).toLocaleDateString()} · ${candidate.status}`}
                    />
                  </ListItemButton>
                ))}
              </List>
            ) : null}
          </Stack>
        )}
        {error ? (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        {result ? (
          <>
            {props.onExchange ? (
              <Button
                onClick={() => {
                  props.onExchange?.({ email: order?.customerEmail ?? null, name: order?.customerName ?? null })
                  close()
                }}
              >
                {'Ring up the exchange'}
              </Button>
            ) : null}
            <Button variant="contained" onClick={close}>
              {'Done'}
            </Button>
          </>
        ) : order ? (
          <>
            <Button onClick={() => (orders && orders.length > 1 ? setOrder(null) : reset())} disabled={busy}>
              {'Back'}
            </Button>
            <Button
              variant="contained"
              disabled={busy || !picks.length || !order.returnable || !(refundCents > 0)}
              onClick={() => void submit()}
            >
              {`Refund ${posMoney(refundCents)}`}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={close}>{'Cancel'}</Button>
            <Button variant="contained" disabled={busy || !text.trim()} onClick={() => void find()}>
              {'Find order'}
            </Button>
          </>
        )}
      </DialogActions>
      <PosPinPad
        open={Boolean(managerPrompt)}
        hostId={hostId}
        registerId={registerId}
        purpose="manager"
        prompt={managerPrompt}
        onClose={() => setManagerPrompt('')}
        onVerified={onManager}
      />
    </Dialog>
  )
}

PosReturnDialog.displayName = 'PosReturnDialog'

export default PosReturnDialog
