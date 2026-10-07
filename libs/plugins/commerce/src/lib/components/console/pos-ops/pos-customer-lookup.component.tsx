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
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useEffect, useRef, useState } from 'react'
import { posMoney } from '../../../model/commerce-pos-ops'
import { callPosOps } from './pos-ops-api'

/** The customer a sale is rung for. `id` is empty when no record system keeps people. */
export interface PosSelectedCustomer {
  kind: string
  id: string
  name: string
  email: string | null
  phone: string | null
}

export interface PosCustomerLookupProps {
  hostId: string
  value: PosSelectedCustomer | null
  onChange: (customer: PosSelectedCustomer | null) => void
}

/** How long typing pauses before the register asks. */
const SEARCH_DEBOUNCE_MS = 250

/**
 * The customer at the register (AGL-3609): search the workspace's people by
 * name, email or phone, see what they have bought here before, attach them
 * to the sale — or add a new one in a few taps. Where the workspace keeps no
 * people, it falls back to an email typed for the receipt.
 */
export function PosCustomerLookup(props: PosCustomerLookupProps) {
  const { hostId, value, onChange } = props
  const { data: user } = useUser()
  const [text, setText] = useState('')
  const [results, setResults] = useState<PosSelectedCustomer[]>([])
  const [available, setAvailable] = useState(true)
  const [stats, setStats] = useState<{ orderCount: number; lifetimeSpendCents: number } | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', email: '', phone: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const latest = useRef(0)

  useEffect(() => {
    const typed = text.trim()
    if (typed.length < 2 || !user) {
      setResults([])
      return
    }
    const ticket = ++latest.current
    const timer = window.setTimeout(() => {
      void callPosOps<{ available?: boolean; customers?: PosSelectedCustomer[] }>(user, 'pos-customer', {
        hostId,
        action: 'search',
        text: typed,
      }).then((answer) => {
        if (ticket !== latest.current) return
        setAvailable(answer.body.available !== false)
        setResults(answer.ok ? (answer.body.customers ?? []) : [])
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [text, user, hostId])

  useEffect(() => {
    setStats(null)
    if (!value?.email || !user) return
    let active = true
    void callPosOps<{ orderCount?: number; lifetimeSpendCents?: number }>(user, 'pos-customer', {
      hostId,
      action: 'stats',
      email: value.email,
    }).then((answer) => {
      if (active && answer.ok) {
        setStats({
          orderCount: Number(answer.body.orderCount ?? 0),
          lifetimeSpendCents: Number(answer.body.lifetimeSpendCents ?? 0),
        })
      }
    })
    return () => {
      active = false
    }
  }, [value?.email, user, hostId])

  const pick = (customer: PosSelectedCustomer) => {
    onChange(customer)
    setText('')
    setResults([])
  }

  const typedEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim()) ? text.trim().toLowerCase() : ''

  const create = async () => {
    setBusy(true)
    setError('')
    const answer = await callPosOps<{ customer?: PosSelectedCustomer }>(user, 'pos-customer', {
      hostId,
      action: 'create',
      ...draft,
    })
    setBusy(false)
    if (!answer.ok || !answer.body.customer) return setError(answer.body.error ?? 'Could not add the customer.')
    pick(answer.body.customer)
    setAdding(false)
  }

  if (value) {
    return (
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip
          label={value.name || value.email || 'Customer'}
          onDelete={() => onChange(null)}
          color="primary"
          variant="outlined"
        />
        {value.name && value.email ? (
          <Typography variant="caption" color="text.secondary">
            {value.email}
          </Typography>
        ) : null}
        {stats ? (
          <Typography variant="caption" color="text.secondary">
            {stats.orderCount
              ? `${stats.orderCount} past ${stats.orderCount === 1 ? 'order' : 'orders'} · ${posMoney(
                  stats.lifetimeSpendCents,
                )} spent`
              : 'First order here'}
          </Typography>
        ) : null}
      </Stack>
    )
  }

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          label="Customer"
          placeholder={available ? 'Name, email or phone' : 'Email for the receipt'}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !available && typedEmail) {
              pick({ kind: 'none', id: '', name: '', email: typedEmail, phone: null })
            }
          }}
          sx={{ flex: 1 }}
        />
        <Button
          size="small"
          onClick={() => {
            setDraft({ name: '', email: typedEmail, phone: '' })
            setError('')
            setAdding(true)
          }}
        >
          {'New customer'}
        </Button>
      </Stack>
      {results.length ? (
        <List dense disablePadding>
          {results.map((customer) => (
            <ListItemButton key={`${customer.kind}:${customer.id}`} onClick={() => pick(customer)}>
              <ListItemText
                primary={customer.name || customer.email || 'Unnamed'}
                secondary={[customer.email, customer.phone].filter(Boolean).join(' · ')}
              />
            </ListItemButton>
          ))}
        </List>
      ) : null}
      {!available && typedEmail ? (
        <Button size="small" onClick={() => pick({ kind: 'none', id: '', name: '', email: typedEmail, phone: null })} sx={{ alignSelf: 'flex-start' }}>
          {`Use ${typedEmail}`}
        </Button>
      ) : null}
      <Dialog open={adding} onClose={() => setAdding(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{'New customer'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              autoFocus
              label="Name"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <TextField
              label="Email"
              type="email"
              value={draft.email}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
            <TextField
              label="Phone (optional)"
              type="tel"
              value={draft.phone}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            />
            <Typography variant="caption" color="text.secondary">
              {'Adding a customer does not sign them up for marketing email.'}
            </Typography>
            {error ? <Alert severity="warning">{error}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdding(false)}>{'Cancel'}</Button>
          <Button variant="contained" disabled={busy} onClick={create}>
            {'Add customer'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

PosCustomerLookup.displayName = 'PosCustomerLookup'

export default PosCustomerLookup
