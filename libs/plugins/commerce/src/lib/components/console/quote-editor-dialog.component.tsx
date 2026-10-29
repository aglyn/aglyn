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
import { posMoney } from '../../model/commerce-pos-ops'
import { commerceSitePermissionRefusal } from '../../model/plugin-permissions'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  useFirestore,
  useFirestoreDoc,
  useStoreSettingsHref,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
  type Theme,
} from '@mui/material'
import { doc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QuotePayLinkSection } from './quote-pay-link.component'

/** A quote as the list reads it: the order document and its id. */
export type QuoteRow = CommerceModel.HostOrder & { $id: string }

export interface QuoteEditorDialogProps {
  hostId: string
  /** The quote to edit, or `null` for a new one. */
  quote: QuoteRow | null
  /** The store's products, for the product picker. */
  products: readonly Record<string, any>[]
  /** Holds "Create and edit quotes" (`commerce.quotes`). */
  canEdit: boolean
  /** Holds "Send quotes and invoices to customers" (`commerce.quotes.send`). */
  canSend: boolean
  onClose: () => void
}

const REFUSAL = commerceSitePermissionRefusal('commerce.quotes')
const SEARCH_DEBOUNCE_MS = 250

const money = (cents: number): string => posMoney(cents)

/** Field widths on a wide screen, from the theme's spacing; full width on a phone. */
const narrowField = (theme: Theme) => ({ maxWidth: { sm: theme.spacing(16) } })
const mediumField = (theme: Theme) => ({ minWidth: { sm: theme.spacing(20) }, maxWidth: { sm: theme.spacing(24) } })

/** Dollars typed into a field, as whole cents, or `null` when it is not an amount. */
function centsOf(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return 0
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null
  return Math.round(Number(trimmed) * 100)
}

const dollarsOf = (cents: number | undefined): string =>
  cents ? (cents / 100).toFixed(2).replace(/\.00$/, '') : ''

type AddressForm = Record<'name' | 'line1' | 'line2' | 'city' | 'state' | 'postalCode' | 'country', string>

function addressForm(address: CommerceModel.OrderAddress | null | undefined): AddressForm {
  return {
    name: address?.name ?? '',
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    city: address?.city ?? '',
    state: address?.state ?? '',
    postalCode: address?.postalCode ?? '',
    country: address?.country ?? '',
  }
}

type LineForm =
  | {
      key: string
      kind: 'catalog'
      productId: string
      variantId: string
      quantity: string
      modifiers: CommerceModel.ModifierSelection[]
      description: string
      included: boolean
    }
  | {
      key: string
      kind: 'custom'
      name: string
      description: string
      sku: string
      price: string
      quantity: string
      ships: boolean
      included: boolean
    }

interface QuoteForm {
  lines: LineForm[]
  customer: { record: { kind: string; id: string } | null; name: string; company: string; email: string; phone: string }
  shipTo: AddressForm
  billTo: AddressForm
  discountKind: 'none' | 'amount' | 'percent'
  discountValue: string
  shipping: string
  notes: string
  terms: string
  requireProofApproval: boolean
}

let lineSequence = 0
const nextLineKey = () => `line-${++lineSequence}`

function formFromQuote(quote: QuoteRow | null, requireProofApproval: boolean): QuoteForm {
  const section = quote?.quote
  const discount = section?.discount ?? null
  return {
    lines: (quote?.lineItems ?? []).map((line): LineForm => {
      const request = CommerceModel.quoteLineRequestFromLine(line)
      return request.kind === 'custom'
        ? {
            key: nextLineKey(),
            kind: 'custom',
            name: request.name,
            description: request.description ?? '',
            sku: request.sku ?? '',
            price: dollarsOf(request.unitAmountCents),
            quantity: String(request.quantity),
            ships: request.ships !== false,
            included: request.included === true,
          }
        : {
            key: nextLineKey(),
            kind: 'catalog',
            productId: request.productId,
            variantId: request.variantId ?? '',
            quantity: String(request.quantity),
            modifiers: request.modifiers ?? [],
            description: request.description ?? '',
            included: request.included === true,
          }
    }),
    customer: {
      record: section?.customer?.record ?? null,
      name: section?.customer?.name ?? '',
      company: section?.customer?.company ?? '',
      email: section?.customer?.email ?? '',
      phone: section?.customer?.phone ?? '',
    },
    shipTo: addressForm(section?.shipTo),
    billTo: addressForm(section?.billTo),
    discountKind: discount?.kind ?? 'none',
    discountValue:
      discount?.kind === 'amount' ? dollarsOf(discount.amountCents) : discount?.kind === 'percent' ? String(discount.pct) : '',
    shipping: dollarsOf(section?.shipping?.amountCents),
    notes: section?.notes ?? '',
    terms: section?.terms ?? '',
    requireProofApproval: section ? section.requireProofApproval === true : requireProofApproval,
  }
}

function lineRequest(line: LineForm): CommerceModel.QuoteLineRequest {
  const quantity = Number(line.quantity)
  if (line.kind === 'catalog') {
    return {
      kind: 'catalog',
      productId: line.productId,
      ...(line.variantId ? { variantId: line.variantId } : {}),
      quantity,
      ...(line.modifiers.length ? { modifiers: line.modifiers } : {}),
      ...(line.included ? { included: true } : {}),
      ...(line.description.trim() ? { description: line.description.trim() } : {}),
    }
  }
  return {
    kind: 'custom',
    name: line.name.trim(),
    ...(line.description.trim() ? { description: line.description.trim() } : {}),
    ...(line.sku.trim() ? { sku: line.sku.trim() } : {}),
    unitAmountCents: line.included ? 0 : (centsOf(line.price) ?? Number.NaN),
    quantity,
    ships: line.ships,
    ...(line.included ? { included: true } : {}),
  }
}

function addressBody(address: AddressForm): Partial<AddressForm> | null {
  const entries = Object.entries(address).filter(([, value]) => value.trim())
  return entries.length ? Object.fromEntries(entries.map(([key, value]) => [key, value.trim()])) : null
}

/** What the server is sent: choices, never what a product costs. */
function quoteBody(form: QuoteForm): Record<string, unknown> {
  const discountCents = centsOf(form.discountValue)
  return {
    lines: form.lines.map(lineRequest),
    customer: {
      ...(form.customer.record ? { record: form.customer.record } : {}),
      name: form.customer.name,
      company: form.customer.company,
      email: form.customer.email,
      phone: form.customer.phone,
    },
    shipTo: addressBody(form.shipTo),
    billTo: addressBody(form.billTo),
    discount:
      form.discountKind === 'amount'
        ? { kind: 'amount', amountCents: discountCents ?? Number.NaN }
        : form.discountKind === 'percent'
          ? { kind: 'percent', pct: Number(form.discountValue || 0) }
          : null,
    shipping: form.shipping.trim() ? { amountCents: centsOf(form.shipping) ?? Number.NaN } : null,
    notes: form.notes,
    terms: form.terms,
    requireProofApproval: form.requireProofApproval,
  }
}

interface FoundCustomer {
  record: { kind: string; id: string }
  name: string
  company: string
  email: string | null
  phone: string | null
}

/**
 * The quote editor (AGL-4093): who it is for, its lines (products with their
 * options and add-ons, typed items, things included at no charge), discount,
 * shipping, notes and terms, with the totals worked out as it is edited. The
 * server prices and saves it; the totals here are the same function's answer
 * over the same inputs, and a connected tax service's figure arrives on save.
 */
export function QuoteEditorDialog(props: QuoteEditorDialogProps) {
  const { hostId, quote, products, canEdit, canSend, onClose } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const taxesHref = useStoreSettingsHref(hostId, 'taxes')
  const { data: store } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'settings', 'store'),
    [firestore, hostId],
  )
  const storeDefault = CommerceModel.quoteRequiresProofApprovalByDefault(store?.quotes)
  const [form, setForm] = useState<QuoteForm>(() => formFromQuote(quote, storeDefault))
  // The version this form was opened on. A change saved elsewhere while it is
  // open arrives on `quote`; the save still names this one, so the server
  // refuses rather than overwrite that change.
  const [baseUpdatedAtMs] = useState(() => quote?.quote?.updatedAtMs)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  /** Whether anything has been changed since the dialog opened. */
  const [edited, setEdited] = useState(false)
  /** Whether the proof-approval switch was set by hand. */
  const [approvalSet, setApprovalSet] = useState(false)
  // A new quote starts with the store's default, which may arrive after the
  // dialog opens; a switch set by hand keeps its setting.
  const requireProofApproval = quote || approvalSet ? form.requireProofApproval : storeDefault

  const update = useCallback((patch: Partial<QuoteForm>) => {
    setEdited(true)
    if ('requireProofApproval' in patch) setApprovalSet(true)
    setForm((prev) => ({ ...prev, ...patch }))
  }, [])
  const updateLine = useCallback((key: string, patch: Partial<LineForm>) => {
    setEdited(true)
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line) => (line.key === key ? ({ ...line, ...patch } as LineForm) : line)),
    }))
  }, [])

  /*
   * One attempt per change (AGL-1697's rule): a retried Save presents the same
   * key and is answered from the first, an edited quote is a new attempt.
   */
  const attemptKey = useRef('')
  useEffect(() => {
    attemptKey.current = ''
  }, [form])

  const productsById = useMemo(
    () => new Map(products.map((product) => [String(product.$id), product])),
    [products],
  )

  /** Each line priced as the server will price it, or why it cannot be. */
  const priced = useMemo(
    () =>
      form.lines.map((line) => {
        const request = lineRequest(line)
        if (request.kind === 'custom') {
          if (!request.name) return { error: 'Name the item.' }
          if (!Number.isInteger(request.unitAmountCents)) return { error: 'Enter a price.' }
          if (!(request.quantity >= 1)) return { error: 'Enter a quantity.' }
          return { line: CommerceModel.priceQuoteCustomLine(request) }
        }
        if (!request.productId) return { error: 'Choose a product.' }
        if (!(request.quantity >= 1)) return { error: 'Enter a quantity.' }
        const answer = CommerceModel.priceQuoteCatalogLine(productsById.get(request.productId) as never, request)
        return 'error' in answer ? { error: answer.error } : { line: answer.line }
      }),
    [form.lines, productsById],
  )

  const discountCents = centsOf(form.discountValue)
  const discount: CommerceModel.QuoteDiscount | null =
    form.discountKind === 'amount' && discountCents
      ? { kind: 'amount', amountCents: discountCents }
      : form.discountKind === 'percent' && Number(form.discountValue) > 0
        ? { kind: 'percent', pct: Math.min(100, Number(form.discountValue)) }
        : null
  const shippingCents = centsOf(form.shipping) ?? 0
  const taxBasis = CommerceModel.quoteTaxBasisFromSettings(store?.tax, {
    country: form.shipTo.country.trim().toUpperCase(),
    state: form.shipTo.state.trim(),
  })
  const pricedLines = priced.flatMap((entry) => ('line' in entry && entry.line ? [entry.line] : []))
  const totals = CommerceModel.computeQuoteTotals({ lines: pricedLines, discount, shippingCents, tax: taxBasis })
  const problems = priced.some((entry) => 'error' in entry)
  const savedService = quote?.quote?.tax?.kind === 'service' ? quote.quote.tax : null

  const save = useCallback(async () => {
    setBusy(true)
    try {
      if (!attemptKey.current) {
        attemptKey.current = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
      const response = await authorizedFetch(user, '/api/commerce/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attemptKey.current },
        body: JSON.stringify({
          action: quote ? 'update' : 'create',
          hostId,
          ...(quote ? { quoteId: quote.$id, baseUpdatedAtMs } : {}),
          quote: quoteBody({ ...form, requireProofApproval }),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'The quote could not be saved', { variant: 'error', allowDuplicate: true })
      }
      enqueueSnackbar(`${CommerceModel.formatQuoteNumber({ number: payload.number ?? undefined }, payload.quoteId)} saved`, {
        variant: 'success',
        persist: false,
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }, [user, quote, hostId, baseUpdatedAtMs, form, requireProofApproval, enqueueSnackbar, onClose])

  const remove = useCallback(async () => {
    if (!quote) return
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/commerce/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', hostId, quoteId: quote.$id }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'The quote could not be deleted', { variant: 'error', allowDuplicate: true })
      }
      enqueueSnackbar(`${CommerceModel.formatQuoteNumber(quote, quote.$id)} deleted`, { variant: 'success', persist: false })
      setConfirmingDelete(false)
      onClose()
    } finally {
      setBusy(false)
    }
  }, [user, quote, hostId, enqueueSnackbar, onClose])

  const readOnly = !canEdit || busy
  const paid = quote ? !CommerceModel.isUnpaidQuote(quote) : false
  const title = quote ? CommerceModel.formatQuoteNumber(quote, quote.$id) : 'New quote'
  const status = quote ? CommerceModel.quoteDisplayStatus(quote) : null
  const deletable = Boolean(quote) && !paid && (quote?.quote?.stage ?? 'draft') === 'draft'

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth scroll="paper" aria-labelledby="quote-editor-title">
      <DialogTitle id="quote-editor-title">
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <span>{title}</span>
          {status ? (
            <Chip size="small" variant="outlined" label={status.label} color={CommerceModel.QUOTE_STATUS_COLOR[status.key]} />
          ) : null}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          {paid ? (
            <Alert severity="success">
              {quote?.quote?.paidAtMs
                ? `Paid ${new Date(quote.quote.paidAtMs).toLocaleDateString()}. It is an order now and can no longer be changed.`
                : 'This quote has been paid, so it is an order now and can no longer be changed.'}
            </Alert>
          ) : null}
          {quote ? (
            <QuotePayLinkSection hostId={hostId} quoteId={quote.$id} quote={quote} canSend={canSend} edited={edited} />
          ) : null}
          {taxBasis.kind === 'none' && taxBasis.reason === 'undecided' ? (
            <PrerequisiteNotice href={taxesHref ?? undefined} actionLabel="Open Taxes">
              {'This store has not chosen how it handles sales tax, so this quote shows no tax. Choose it in Taxes.'}
            </PrerequisiteNotice>
          ) : null}

          <QuoteCustomerSection
            hostId={hostId}
            form={form}
            disabled={readOnly || paid}
            onChange={(customer) => update({ customer })}
          />

          <Stack spacing={1.5}>
            <Typography variant="subtitle2">{'Items'}</Typography>
            {form.lines.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {'Add products from your catalog, or type an item that is made to order.'}
              </Typography>
            ) : null}
            {form.lines.map((line, index) => (
              <QuoteLineEditor
                key={line.key}
                line={line}
                priced={priced[index]}
                products={products}
                disabled={readOnly || paid}
                onChange={(patch) => updateLine(line.key, patch)}
                onRemove={() => update({ lines: form.lines.filter((entry) => entry.key !== line.key) })}
              />
            ))}
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button
                size="small"
                disabled={readOnly || paid || products.length === 0}
                onClick={() =>
                  update({
                    lines: [
                      ...form.lines,
                      { key: nextLineKey(), kind: 'catalog', productId: '', variantId: '', quantity: '1', modifiers: [], description: '', included: false },
                    ],
                  })
                }
              >
                {'Add product'}
              </Button>
              <Button
                size="small"
                disabled={readOnly || paid}
                onClick={() =>
                  update({
                    lines: [
                      ...form.lines,
                      { key: nextLineKey(), kind: 'custom', name: '', description: '', sku: '', price: '', quantity: '1', ships: true, included: false },
                    ],
                  })
                }
              >
                {'Add custom item'}
              </Button>
            </Stack>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Discount"
              select
              size="small"
              value={form.discountKind}
              disabled={readOnly || paid}
              onChange={(event) => update({ discountKind: event.target.value as QuoteForm['discountKind'] })}
              sx={mediumField}
            >
              <MenuItem value="none">{'None'}</MenuItem>
              <MenuItem value="amount">{'Amount off'}</MenuItem>
              <MenuItem value="percent">{'Percent off'}</MenuItem>
            </TextField>
            {form.discountKind !== 'none' ? (
              <TextField
                label={form.discountKind === 'amount' ? 'Amount ($)' : 'Percent (%)'}
                size="small"
                value={form.discountValue}
                disabled={readOnly || paid}
                onChange={(event) => update({ discountValue: event.target.value })}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                error={form.discountKind === 'amount' ? centsOf(form.discountValue) === null : !(Number(form.discountValue) >= 0 && Number(form.discountValue) <= 100)}
              />
            ) : null}
            <TextField
              label="Shipping ($)"
              size="small"
              value={form.shipping}
              disabled={readOnly || paid}
              onChange={(event) => update({ shipping: event.target.value })}
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              error={centsOf(form.shipping) === null}
              helperText="Leave empty when nothing ships."
            />
          </Stack>

          <QuoteAddressFields
            label="Ship to"
            value={form.shipTo}
            disabled={readOnly || paid}
            helperText="Where the order goes. Store tax rates use its state and country."
            onChange={(shipTo) => update({ shipTo })}
          />
          <QuoteAddressFields
            label="Bill to"
            value={form.billTo}
            disabled={readOnly || paid}
            onChange={(billTo) => update({ billTo })}
          />

          <Stack spacing={2}>
            <TextField
              label="Notes for the customer"
              multiline
              minRows={2}
              value={form.notes}
              disabled={readOnly || paid}
              onChange={(event) => update({ notes: event.target.value })}
            />
            <TextField
              label="Terms"
              multiline
              minRows={2}
              value={form.terms}
              disabled={readOnly || paid}
              onChange={(event) => update({ terms: event.target.value })}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={requireProofApproval}
                  disabled={readOnly || paid}
                  onChange={(event) => update({ requireProofApproval: event.target.checked })}
                />
              }
              label="Customers approve the proof before they can pay"
            />
          </Stack>

          <Divider />
          <QuoteTotalsSummary
            totals={totals}
            tax={taxBasis}
            savedService={edited ? null : savedService}
            savedTotals={edited ? null : (quote?.totals ?? null)}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        {deletable ? (
          <BlockedControl blocked={!canEdit} reason={REFUSAL}>
            <Button color="error" disabled={busy} onClick={() => setConfirmingDelete(true)} sx={{ mr: 'auto' }}>
              {'Delete'}
            </Button>
          </BlockedControl>
        ) : null}
        <Button onClick={onClose} disabled={busy}>
          {paid || !canEdit ? 'Close' : 'Cancel'}
        </Button>
        {paid ? null : (
          <BlockedControl blocked={!canEdit} reason={REFUSAL}>
            <Button
              variant="contained"
              disabled={busy || form.lines.length === 0 || problems}
              onClick={() => void save()}
            >
              {quote ? 'Save' : 'Create quote'}
            </Button>
          </BlockedControl>
        )}
      </DialogActions>
      <Dialog open={confirmingDelete} onClose={() => setConfirmingDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{`Delete ${title}?`}</DialogTitle>
        <DialogContent>
          <DialogContentText>{'The quote and everything on it is removed. This can’t be undone.'}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmingDelete(false)} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button color="error" variant="contained" disabled={busy} onClick={() => void remove()}>
            {'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}
QuoteEditorDialog.displayName = 'QuoteEditorDialog'

/** Who the quote is for: a person the workspace keeps, or details typed here. */
function QuoteCustomerSection(props: {
  hostId: string
  form: QuoteForm
  disabled: boolean
  onChange: (customer: QuoteForm['customer']) => void
}) {
  const { hostId, form, disabled, onChange } = props
  const { data: user } = useUser()
  const [text, setText] = useState('')
  const [found, setFound] = useState<FoundCustomer[]>([])
  const [available, setAvailable] = useState(true)
  const ticket = useRef(0)
  const customer = form.customer

  useEffect(() => {
    const typed = text.trim()
    if (typed.length < 2 || !user) {
      // Only when something is listed, so an effect that re-runs settles.
      setFound((prev) => (prev.length ? [] : prev))
      return
    }
    const mine = ++ticket.current
    const timer = window.setTimeout(() => {
      void authorizedFetch(user, '/api/commerce/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'search-customers', hostId, text: typed }),
      })
        .then((response) => response.json().catch(() => ({})))
        .then((payload) => {
          if (mine !== ticket.current) return
          setAvailable(payload?.available !== false)
          setFound(Array.isArray(payload?.customers) ? payload.customers : [])
        })
        .catch(() => undefined)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [text, user, hostId])

  const pick = (person: FoundCustomer) => {
    onChange({
      record: person.record,
      name: person.name,
      company: person.company,
      email: person.email ?? '',
      phone: person.phone ?? '',
    })
    setText('')
    setFound([])
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2">{'Customer'}</Typography>
      {customer.record ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip
            color="primary"
            variant="outlined"
            label={customer.name || customer.email || 'Contact'}
            onDelete={disabled ? undefined : () => onChange({ ...customer, record: null })}
          />
          <Typography variant="caption" color="text.secondary">
            {'From your contacts'}
          </Typography>
        </Stack>
      ) : available ? (
        <Box>
          <TextField
            size="small"
            fullWidth
            label="Find a contact"
            placeholder="Name, email or phone"
            value={text}
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
          />
          {found.length ? (
            <Paper variant="outlined" sx={{ mt: 0.5 }}>
              <List dense disablePadding>
                {found.map((person) => (
                  <ListItemButton key={`${person.record.kind}:${person.record.id}`} onClick={() => pick(person)}>
                    <ListItemText
                      primary={person.name || person.email || 'Contact'}
                      secondary={[person.company, person.email, person.phone].filter(Boolean).join(' · ')}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Paper>
          ) : null}
        </Box>
      ) : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField size="small" fullWidth label="Name" value={customer.name} disabled={disabled} onChange={(event) => onChange({ ...customer, name: event.target.value })} />
        <TextField size="small" fullWidth label="Company" value={customer.company} disabled={disabled} onChange={(event) => onChange({ ...customer, company: event.target.value })} />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField size="small" fullWidth label="Email" type="email" value={customer.email} disabled={disabled} onChange={(event) => onChange({ ...customer, email: event.target.value })} />
        <TextField size="small" fullWidth label="Phone" value={customer.phone} disabled={disabled} onChange={(event) => onChange({ ...customer, phone: event.target.value })} />
      </Stack>
    </Stack>
  )
}

/** One address on the quote. */
function QuoteAddressFields(props: {
  label: string
  value: AddressForm
  disabled: boolean
  helperText?: string
  onChange: (value: AddressForm) => void
}) {
  const { label, value, disabled, helperText, onChange } = props
  const field = (key: keyof AddressForm, fieldLabel: string, extra: Record<string, unknown> = {}) => (
    <TextField
      size="small"
      fullWidth
      label={fieldLabel}
      value={value[key]}
      disabled={disabled}
      onChange={(event) => onChange({ ...value, [key]: event.target.value })}
      {...extra}
    />
  )
  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2">{label}</Typography>
      {helperText ? (
        <Typography variant="caption" color="text.secondary">
          {helperText}
        </Typography>
      ) : null}
      {field('name', 'Name')}
      {field('line1', 'Address')}
      {field('line2', 'Apartment, suite, unit')}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        {field('city', 'City')}
        {field('state', 'State or region')}
        {field('postalCode', 'Postal code')}
        {field('country', 'Country code', { placeholder: 'US', slotProps: { htmlInput: { maxLength: 2 } } })}
      </Stack>
    </Stack>
  )
}

/** One line of the quote: a product with its options and add-ons, or a typed item. */
function QuoteLineEditor(props: {
  line: LineForm
  priced: { line?: CommerceModel.PricedQuoteLine; error?: string } | undefined
  products: readonly Record<string, any>[]
  disabled: boolean
  onChange: (patch: Partial<LineForm>) => void
  onRemove: () => void
}) {
  const { line, priced, products, disabled, onChange, onRemove } = props
  const product = line.kind === 'catalog' ? products.find((entry) => String(entry.$id) === line.productId) : undefined
  const lifted = product ? CommerceModel.liftLegacyProduct(product) : null
  const groups = lifted ? CommerceModel.productModifierGroups(lifted) : []
  const lineCents = priced?.line ? CommerceModel.quoteLineCents(priced.line) : 0

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Stack spacing={1.5} sx={{ flex: 1, minWidth: 0 }}>
            {line.kind === 'catalog' ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Product"
                  select
                  size="small"
                  fullWidth
                  value={line.productId}
                  disabled={disabled}
                  onChange={(event) => onChange({ productId: event.target.value, variantId: '', modifiers: [] })}
                >
                  {products.map((entry) => (
                    <MenuItem key={String(entry.$id)} value={String(entry.$id)}>
                      {String(entry.name ?? entry.$id)}
                    </MenuItem>
                  ))}
                </TextField>
                {lifted && lifted.variants.length > 1 ? (
                  <TextField
                    label="Option"
                    select
                    size="small"
                    fullWidth
                    value={line.variantId || lifted.variants[0]?.id || ''}
                    disabled={disabled}
                    onChange={(event) => onChange({ variantId: event.target.value })}
                  >
                    {lifted.variants.map((variant) => (
                      <MenuItem key={variant.id} value={variant.id}>
                        {Object.values(variant.options ?? {}).join(' / ') || 'Default'}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : null}
              </Stack>
            ) : (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Item"
                  size="small"
                  fullWidth
                  value={line.name}
                  disabled={disabled}
                  onChange={(event) => onChange({ name: event.target.value })}
                />
                <TextField
                  label="SKU (optional)"
                  size="small"
                  value={line.sku}
                  disabled={disabled}
                  onChange={(event) => onChange({ sku: event.target.value })}
                />
              </Stack>
            )}
            {groups.map((group) => {
              const chosen = line.kind === 'catalog' ? line.modifiers.filter((pick) => pick.groupId === group.id).map((pick) => pick.optionId) : []
              return (
                <TextField
                  key={group.id}
                  label={CommerceModel.modifierGroupRequired(group) ? group.name : `${group.name} (optional)`}
                  select
                  size="small"
                  fullWidth
                  value={group.max > 1 ? chosen : (chosen[0] ?? '')}
                  disabled={disabled}
                  slotProps={{ select: { multiple: group.max > 1 } }}
                  onChange={(event) => {
                    const raw = event.target.value as unknown
                    const picked = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String)
                    if (line.kind !== 'catalog') return
                    onChange({
                      modifiers: [
                        ...line.modifiers.filter((pick) => pick.groupId !== group.id),
                        ...picked.map((optionId) => ({ groupId: group.id, optionId })),
                      ],
                    })
                  }}
                >
                  {group.max > 1 ? null : <MenuItem value="">{'None'}</MenuItem>}
                  {group.options.map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {option.priceCents ? `${option.name} (+${money(option.priceCents)})` : option.name}
                    </MenuItem>
                  ))}
                </TextField>
              )
            })}
            <TextField
              label="Description (optional)"
              size="small"
              fullWidth
              multiline
              value={line.description}
              disabled={disabled}
              onChange={(event) => onChange({ description: event.target.value })}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
              <TextField
                label="Quantity"
                size="small"
                value={line.quantity}
                disabled={disabled}
                onChange={(event) => onChange({ quantity: event.target.value.replace(/[^0-9]/g, '') })}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                sx={narrowField}
              />
              {line.kind === 'custom' ? (
                <TextField
                  label="Unit price ($)"
                  size="small"
                  value={line.included ? '' : line.price}
                  disabled={disabled || line.included}
                  onChange={(event) => onChange({ price: event.target.value })}
                  slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                  error={!line.included && centsOf(line.price) === null}
                  sx={mediumField}
                />
              ) : null}
              {line.kind === 'custom' ? (
                <FormControlLabel
                  control={<Switch checked={line.ships} disabled={disabled} onChange={(event) => onChange({ ships: event.target.checked })} />}
                  label="Ships"
                />
              ) : null}
              <FormControlLabel
                control={
                  <Switch checked={line.included} disabled={disabled} onChange={(event) => onChange({ included: event.target.checked })} />
                }
                label="Included at no charge"
              />
            </Stack>
          </Stack>
          <Stack sx={{ alignItems: 'flex-end', flexShrink: 0 }}>
            <Button size="small" color="inherit" disabled={disabled} onClick={onRemove}>
              {'Remove'}
            </Button>
            <Typography variant="body2" sx={{ fontWeight: 'fontWeightMedium' }}>
              {line.included ? 'Included' : money(lineCents)}
            </Typography>
            {priced?.line && !line.included && priced.line.quantity > 1 ? (
              <Typography variant="caption" color="text.secondary">
                {`${money(priced.line.unitAmountCents)} each`}
              </Typography>
            ) : null}
          </Stack>
        </Stack>
        {priced?.error ? (
          <Typography variant="caption" color="error">
            {priced.error}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  )
}

/** The quote's totals, as the customer will read them. */
function QuoteTotalsSummary(props: {
  totals: CommerceModel.QuoteTotals
  tax: CommerceModel.QuoteTaxBasis
  /** A saved quote's tax service answer, shown until the quote is edited. */
  savedService: CommerceModel.QuoteTaxBasis | null
  savedTotals: CommerceModel.OrderTotals | null
}) {
  const { totals, tax, savedService, savedTotals } = props
  const shown = savedService && savedTotals ? { ...totals, ...savedTotals } : totals
  const taxLabel = CommerceModel.describeQuoteTax(savedService ?? tax)
  const row = (label: string, value: string, strong = false) => (
    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
      <Typography variant={strong ? 'subtitle1' : 'body2'} color={strong ? 'text.primary' : 'text.secondary'}>
        {label}
      </Typography>
      <Typography variant={strong ? 'subtitle1' : 'body2'}>{value}</Typography>
    </Stack>
  )
  return (
    <Stack spacing={0.5} sx={(theme) => ({ alignSelf: { sm: 'flex-end' }, minWidth: { sm: theme.spacing(40) } })}>
      {row('Items', money(shown.itemsCents))}
      {shown.discountCents ? row('Discount', `−${money(shown.discountCents)}`) : null}
      {shown.shippingCents ? row('Shipping', money(shown.shippingCents)) : null}
      {tax.kind === 'at-payment' && !savedService ? (
        <Typography variant="body2" color="text.secondary">
          {taxLabel}
        </Typography>
      ) : (
        row(taxLabel, money(shown.taxCents))
      )}
      {row(totals.taxAtPayment && !savedService ? 'Total before tax' : 'Total', money(shown.totalCents), true)}
    </Stack>
  )
}

export default QuoteEditorDialog
