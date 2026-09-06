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
  type AglynOrgBilling,
  checkEntitlement,
  CRM_COLLECTIONS,
  type CrmDealLineItem,
  DEAL_LINE_ITEM_NAME_MAX,
  DEAL_LINE_ITEM_QUANTITY_MAX,
  DEAL_LINE_ITEMS_MAX,
  lineItemsTotalCents,
  nameSearchToken,
  pluginDocsHelp,
  readDealLineItems,
} from '@aglyn/aglyn'
import { mdiDeleteOutline, mdiPlus } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, writeGuardedBySeed } from '@aglyn/tenant-feature-instance'
import {
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CrmOrgDoc } from '../hooks/use-crm-scope'
import {
  amountInputValue,
  type DealDoc,
  DEFAULT_DEAL_CURRENCY,
  formatMoney,
  parseAmountInput,
} from '../model/deal-board-model'

/** Catalog matches offered per keystroke; a longer list is a scroll, not a pick. */
const CATALOG_MATCHES = 8

/** One thing the catalog search offers: a product, or one variant of it. */
interface CatalogChoice {
  key: string
  productId: string
  label: string
  unitAmountCents: number
}

export interface DealProductsCardProps {
  deal: DealDoc
  orgId: string
  /**
   * The site whose catalog the search reads — the console's own, or
   * `null` at the organization level (AGL-2630), where the deal's own
   * capturing site is searched; a deal with none takes lines by hand only.
   */
  hostId: string | null
  org: CrmOrgDoc
  /** The listener's verdict on the deal, for the stale-seed guard. */
  fromCache: boolean
  unreadable: boolean
}

/**
 * The products behind a deal's amount (AGL-2620).
 *
 * ## The amount follows the lines
 *
 * Every write here stores `lineItems` AND `amountCents` as their sum, in
 * one update, so the board, the reports and the API keep reading the one
 * field they always read and no reader adds up lines. Once a deal has a
 * line, the drawer's Amount goes read-only and says why; remove the last
 * line and the amount is typed again, keeping the last sum rather than
 * dropping to nothing. The currency is the deal's — a line cannot be in
 * another, because their sum is one number.
 *
 * ## Two doors to a line
 *
 * **From the catalog** searches THIS site's products — a prefix on
 * `nameTokens` over active products, the query the products hub runs and
 * the `(status, nameTokens, nameLower)` index serves — and offers each
 * variant priced. The catalog is USD; a deal in another currency is told
 * so and can edit the unit amount after. **By hand** takes a name and a
 * price with no product behind them, which is also all a plan without
 * commerce gets: the catalog door is not drawn for it, because the site
 * has no catalog to search.
 *
 * Adding opens a dialog rather than a row of fields above the table, and
 * a quantity is edited in place and written on blur.
 */
export function DealProductsCard(props: DealProductsCardProps) {
  const { deal, orgId, hostId, org, fromCache, unreadable } = props
  const firestore = useFirestore()
  // The catalog searched: the mounted site's, or the deal's own.
  const catalogHostId = hostId ?? deal.hostId ?? null
  const { enqueueSnackbar } = useSnackbar()
  const currency = String(deal.currency || DEFAULT_DEAL_CURRENCY).toLowerCase()
  const items = useMemo(() => deal.lineItems ?? [], [deal.lineItems])
  const hasCommerce = checkEntitlement(
    (org ?? null) as Partial<AglynOrgBilling> | null,
    'commerce',
  )
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)

  /** The one write: the lines and their sum, together. */
  const save = useCallback(
    async (next: CrmDealLineItem[], done: string) => {
      const read = readDealLineItems(next, currency)
      if ('error' in read) {
        enqueueSnackbar(read.error, { variant: 'warning', persist: false })
        return false
      }
      setBusy(true)
      try {
        const verdict = await writeGuardedBySeed(
          { subject: 'deal', unreadable, fromCache },
          async () => {
            await updateDoc(doc(firestore, 'orgs', orgId, CRM_COLLECTIONS.deals, deal.$id), {
              lineItems: read.items,
              // The last sum stays on a deal whose lines were all removed:
              // the forecast should not drop to zero because a quote was
              // cleared to be retyped.
              ...(read.items.length ? { amountCents: lineItemsTotalCents(read.items) } : {}),
              updatedAt: new Date(),
            })
          },
        )
        if (!verdict.ok) {
          enqueueSnackbar(verdict.message, { variant: 'warning', persist: false })
          return false
        }
        enqueueSnackbar(done, { variant: 'success', persist: false })
        return true
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', { variant: 'error', allowDuplicate: true })
        return false
      } finally {
        setBusy(false)
      }
    },
    [currency, enqueueSnackbar, unreadable, fromCache, firestore, orgId, deal.$id],
  )

  const handleRemove = useCallback(
    (index: number) =>
      void save(
        items.filter((_item, at) => at !== index),
        'Line removed',
      ),
    [items, save],
  )
  const handleQuantity = useCallback(
    (index: number, quantity: number) => {
      if (quantity === items[index]?.quantity) return
      void save(
        items.map((item, at) => (at === index ? { ...item, quantity } : item)),
        'Quantity saved',
      )
    },
    [items, save],
  )
  const handleAdd = useCallback(
    async (line: CrmDealLineItem) => {
      const ok = await save([...items, line], 'Line added')
      if (ok) setAdding(false)
    },
    [items, save],
  )

  const total = lineItemsTotalCents(items)
  const full = items.length >= DEAL_LINE_ITEMS_MAX

  return (
    <>
      <CardDisplay
        header={'Products'}
        help={pluginDocsHelp('deals', { anchor: '#line-items' })}
        actions={
          <Tooltip title={full ? `A deal carries at most ${DEAL_LINE_ITEMS_MAX} lines` : ''}>
            <span>
              <Button
                size="small"
                startIcon={<MdiIcon path={mdiPlus.path} size={0.8} />}
                disabled={busy || full}
                onClick={() => setAdding(true)}
              >
                {'Add line'}
              </Button>
            </span>
          </Tooltip>
        }
        contentGutterX
        contentGutterY
      >
        {items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {hasCommerce
              ? 'No line items yet. Add products from your catalog or by hand; the amount becomes their sum.'
              : 'No line items yet. Add what the deal is for, priced by hand; the amount becomes their sum.'}
          </Typography>
        ) : (
          <Table size="small" aria-label="Line items">
            <TableHead>
              <TableRow>
                <TableCell>{'Item'}</TableCell>
                <TableCell align="right" sx={{ width: 110 }}>
                  {'Quantity'}
                </TableCell>
                <TableCell align="right">{'Unit'}</TableCell>
                <TableCell align="right">{'Total'}</TableCell>
                <TableCell sx={{ width: 48 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={`${index}:${item.productId ?? item.name}`}>
                  <TableCell>
                    <Typography variant="body2">{item.name}</Typography>
                    {item.productId ? (
                      <Typography variant="caption" color="text.secondary">
                        {'From the catalog'}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell align="right">
                    <QuantityField
                      value={item.quantity}
                      disabled={busy}
                      label={`Quantity of ${item.name}`}
                      onCommit={(quantity) => handleQuantity(index, quantity)}
                    />
                  </TableCell>
                  <TableCell align="right">{formatMoney(item.unitAmountCents, currency)}</TableCell>
                  <TableCell align="right">
                    {formatMoney(item.quantity * item.unitAmountCents, currency)}
                  </TableCell>
                  <TableCell padding="none" align="right">
                    <Tooltip title="Remove line">
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          disabled={busy}
                          aria-label={`Remove ${item.name}`}
                          onClick={() => handleRemove(index)}
                        >
                          <MdiIcon path={mdiDeleteOutline.path} size={0.8} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={3}>
                  <Typography variant="subtitle2">{'Amount'}</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="subtitle2" data-testid="line-items-total">
                    {formatMoney(total, currency)}
                  </Typography>
                </TableCell>
                <TableCell padding="none" />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardDisplay>
      <AddLineDialog
        open={adding}
        onClose={() => setAdding(false)}
        hostId={catalogHostId}
        currency={currency}
        catalog={hasCommerce && Boolean(catalogHostId)}
        busy={busy}
        onAdd={handleAdd}
      />
    </>
  )
}
DealProductsCard.displayName = 'DealProductsCard'

interface QuantityFieldProps {
  value: number
  disabled: boolean
  label: string
  onCommit: (quantity: number) => void
}

/** A quantity edited in place, committed on blur or Enter, refused below one. */
function QuantityField(props: QuantityFieldProps) {
  const { value, disabled, label, onCommit } = props
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const quantity = Number(draft)
    if (Number.isInteger(quantity) && quantity >= 1 && quantity <= DEAL_LINE_ITEM_QUANTITY_MAX) {
      onCommit(quantity)
    } else {
      setDraft(String(value))
    }
  }
  return (
    <TextField
      size="small"
      type="number"
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          ;(event.target as HTMLInputElement).blur()
        }
      }}
      sx={{ width: 88 }}
      slotProps={{
        htmlInput: {
          min: 1,
          max: DEAL_LINE_ITEM_QUANTITY_MAX,
          step: 1,
          'aria-label': label,
          style: { textAlign: 'right' },
        },
      }}
    />
  )
}
QuantityField.displayName = 'QuantityField'

interface AddLineDialogProps {
  open: boolean
  onClose: () => void
  /** The site whose catalog is searched; `null` draws no catalog door. */
  hostId: string | null
  currency: string
  /** Whether the catalog door is drawn — the plan has commerce. */
  catalog: boolean
  busy: boolean
  onAdd: (line: CrmDealLineItem) => Promise<void>
}

type Door = 'catalog' | 'manual'

function AddLineDialog(props: AddLineDialogProps) {
  const { open, onClose, hostId, currency, catalog, busy, onAdd } = props
  const firestore = useFirestore()
  const [door, setDoor] = useState<Door>(catalog ? 'catalog' : 'manual')
  const [picked, setPicked] = useState<CatalogChoice | null>(null)
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState('')
  const [search, setSearch] = useState('')
  const [choices, setChoices] = useState<CatalogChoice[]>([])

  useEffect(() => {
    if (!open) return
    setDoor(catalog ? 'catalog' : 'manual')
    setPicked(null)
    setName('')
    setQuantity('1')
    setUnit('')
    setSearch('')
    setChoices([])
  }, [open, catalog])

  /*
   * THE CATALOG SEARCH: the first typed word as a prefix token over active
   * products, ordered by name, debounced so a name typed at speed is one
   * query rather than one per letter. Each variant is its own choice,
   * priced from `priceUsd` in cents.
   */
  useEffect(() => {
    if (!open || door !== 'catalog' || !hostId) return
    const token = nameSearchToken(search)
    if (!token) {
      setChoices([])
      return
    }
    let active = true
    const timer = setTimeout(() => {
      void getDocs(
        query(
          collection(firestore, 'hosts', hostId, 'products'),
          where('status', '==', 'active'),
          where('nameTokens', 'array-contains', token),
          orderBy('nameLower'),
          limit(CATALOG_MATCHES),
        ),
      )
        .then((snapshot) => {
          if (!active) return
          const next: CatalogChoice[] = []
          for (const entry of snapshot.docs) {
            const productName = String(entry.get('name') ?? '')
            const variants = (entry.get('variants') as Array<Record<string, unknown>> | undefined) ?? []
            const priced = variants.length
              ? variants
              : [{ id: '', priceUsd: entry.get('priceUsd') }]
            for (const variant of priced) {
              const options = Object.values((variant['options'] as Record<string, string>) ?? {})
              const label = options.length ? `${productName} — ${options.join(' / ')}` : productName
              next.push({
                key: `${entry.id}:${String(variant['id'] ?? '')}`,
                productId: entry.id,
                label,
                unitAmountCents: Math.max(0, Math.round((Number(variant['priceUsd']) || 0) * 100)),
              })
            }
          }
          setChoices(next)
        })
        .catch(() => {
          if (active) setChoices([])
        })
    }, 200)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [firestore, open, door, hostId, search])

  const unitCents = parseAmountInput(unit)
  const quantityNumber = Number(quantity)
  const lineName = (door === 'catalog' ? (name || picked?.label || '') : name).trim()
  const problem = !lineName
    ? door === 'catalog'
      ? 'Pick a product.'
      : 'A line needs a name.'
    : !Number.isInteger(quantityNumber) || quantityNumber < 1
      ? 'The quantity has to be a whole number of one or more.'
      : unitCents === null
        ? 'The unit amount has to be a number of zero or more.'
        : null

  const handleAdd = () => {
    if (problem || unitCents === null) return
    void onAdd({
      ...(door === 'catalog' && picked ? { productId: picked.productId } : {}),
      name: lineName.slice(0, DEAL_LINE_ITEM_NAME_MAX),
      quantity: quantityNumber,
      unitAmountCents: unitCents,
      currency,
    })
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{'Add a line'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {catalog ? (
            <ToggleButtonGroup
              exclusive
              size="small"
              color="primary"
              value={door}
              onChange={(_event, next) => {
                if (next) setDoor(next as Door)
              }}
              aria-label="Where the line comes from"
            >
              <ToggleButton value="catalog">{'From the catalog'}</ToggleButton>
              <ToggleButton value="manual">{'By hand'}</ToggleButton>
            </ToggleButtonGroup>
          ) : null}
          {door === 'catalog' ? (
            <Autocomplete<CatalogChoice, false, false, false>
              options={choices}
              value={picked}
              inputValue={search}
              onInputChange={(_event, next, reason) => {
                if (reason !== 'reset') setSearch(next)
              }}
              onChange={(_event, choice) => {
                setPicked(choice)
                setName(choice?.label ?? '')
                setUnit(choice ? amountInputValue(choice.unitAmountCents) : '')
              }}
              getOptionLabel={(choice) => choice.label}
              isOptionEqualToValue={(option, value) => option.key === value.key}
              // The match is the query's own prefix over `nameTokens`, never
              // MUI's substring filter over labels.
              filterOptions={(options) => options}
              renderOption={(optionProps, choice) => (
                <li {...optionProps} key={choice.key}>
                  <Stack direction="row" spacing={1} sx={{ width: '100%', alignItems: 'baseline' }}>
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {choice.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatMoney(choice.unitAmountCents, 'usd')}
                    </Typography>
                  </Stack>
                </li>
              )}
              noOptionsText={search.trim() ? 'No active product matches' : 'Type a product name'}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Product"
                  placeholder="Search this site's catalog"
                  autoFocus
                  helperText={
                    currency !== 'usd'
                      ? `Catalog prices are in USD; this deal is in ${currency.toUpperCase()}. Check the unit amount.`
                      : undefined
                  }
                />
              )}
            />
          ) : (
            <TextField
              label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              fullWidth
              slotProps={{ htmlInput: { maxLength: DEAL_LINE_ITEM_NAME_MAX } }}
            />
          )}
          <Stack direction="row" spacing={1}>
            <TextField
              label="Quantity"
              type="number"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              sx={{ width: 120 }}
              slotProps={{ htmlInput: { min: 1, max: DEAL_LINE_ITEM_QUANTITY_MAX, step: 1 } }}
            />
            <TextField
              label={`Unit amount (${currency.toUpperCase()})`}
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              placeholder="0.00"
              sx={{ flex: 1 }}
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
          </Stack>
          {problem && (lineName || unit) ? (
            <Typography variant="caption" color="warning.main">
              {problem}
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button variant="contained" disabled={busy || Boolean(problem)} onClick={handleAdd}>
          {'Add line'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
AddLineDialog.displayName = 'AddLineDialog'

export default DealProductsCard
