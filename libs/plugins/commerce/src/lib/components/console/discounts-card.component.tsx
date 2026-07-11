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

import * as Aglyn from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteDoc,
  doc,
  limit,
  query,
  setDoc,
} from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useFirestoreCollection } from '@aglyn/tenant-feature-instance'

export interface DiscountsCardProps {
  hostId: string
}

/**
 * Discounts hub (AGL-305): code and automatic promotions with value,
 * min-subtotal, schedule, and usage-limit controls, resolved at
 * checkout/POS by the shared engine. Supersedes the simple coupons
 * card (which keeps working for existing codes).
 */
export function DiscountsCard(props: DiscountsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { data: discountDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'discounts'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const [draft, setDraft] = useState<
    (Partial<Aglyn.HostDiscount> & { id: string | null }) | null
  >(null)

  const handleSave = useCallback(async () => {
    if (!draft) return
    const { id, ...data } = draft
    const code = data.code?.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '')
    await setDoc(
      doc(
        firestore,
        'hosts',
        hostId,
        'discounts',
        id ?? Aglyn.createResourceUid(),
      ),
      {
        ...data,
        ...(code ? { code } : { code: null }),
        enabled: data.enabled !== false,
        redemptions: data.redemptions ?? 0,
      },
      { merge: true },
    )
    setDraft(null)
    enqueueSnackbar('Discount saved', { variant: 'success', persist: false })
  }, [draft, firestore, hostId, enqueueSnackbar])

  const describe = (discount: any) => {
    const value =
      discount.kind === 'percent'
        ? `${discount.valuePct}% off`
        : discount.kind === 'fixed'
          ? `$${((discount.valueCents ?? 0) / 100).toFixed(2)} off`
          : 'Free shipping'
    const extras = [
      discount.minSubtotalCents
        ? `min $${(discount.minSubtotalCents / 100).toFixed(0)}`
        : '',
      discount.maxRedemptions
        ? `${discount.redemptions ?? 0}/${discount.maxRedemptions} used`
        : '',
    ]
      .filter(Boolean)
      .join(' · ')
    return `${value}${extras ? ` · ${extras}` : ''}`
  }

  return (
    <CardDisplay header={'Discounts'} contentGutterX contentGutterY>
      <Stack spacing={1}>
        {(discountDocs ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Codes buyers enter at checkout, or automatic promotions that ' +
              'apply on their own.'}
          </Typography>
        ) : (
          (discountDocs ?? []).map((discount: any) => (
            <Stack
              key={discount.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Chip
                label={discount.code || discount.name || 'Automatic'}
                size="small"
                variant="outlined"
                color={discount.code ? 'secondary' : 'info'}
              />
              <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                {describe(discount)}
                {discount.enabled === false ? ' · disabled' : ''}
              </Typography>
              <Button
                size="small"
                onClick={() => setDraft({ id: discount.$id, ...discount })}
              >
                {'Edit'}
              </Button>
              <Button
                size="small"
                color="error"
                onClick={() =>
                  deleteDoc(
                    doc(firestore, 'hosts', hostId, 'discounts', discount.$id),
                  )
                }
              >
                {'Delete'}
              </Button>
            </Stack>
          ))
        )}
        <Button
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() =>
            setDraft({ id: null, kind: 'percent', valuePct: 10, enabled: true })
          }
        >
          {'Add discount'}
        </Button>
      </Stack>
      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{draft?.id ? 'Edit discount' : 'New discount'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Code (blank = automatic)"
            value={draft?.code ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, code: event.target.value } : prev,
              )
            }
            size="small"
            sx={{ mt: 1 }}
            placeholder="SAVE10"
          />
          {!draft?.code ? (
            <TextField
              label="Promotion name"
              value={draft?.name ?? ''}
              onChange={(event) =>
                setDraft((prev) =>
                  prev ? { ...prev, name: event.target.value } : prev,
                )
              }
              size="small"
              placeholder="Summer sale"
            />
          ) : null}
          <Stack direction="row" spacing={1}>
            <TextField
              label="Type"
              value={draft?.kind ?? 'percent'}
              onChange={(event) =>
                setDraft((prev) =>
                  prev
                    ? { ...prev, kind: event.target.value as Aglyn.DiscountKind }
                    : prev,
                )
              }
              size="small"
              select
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="percent">{'Percent off'}</MenuItem>
              <MenuItem value="fixed">{'Fixed amount off'}</MenuItem>
              <MenuItem value="free_shipping">{'Free shipping'}</MenuItem>
            </TextField>
            {draft?.kind === 'percent' ? (
              <TextField
                label="%"
                value={draft?.valuePct ?? ''}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          valuePct: Math.min(
                            100,
                            Math.max(0, Number(event.target.value) || 0),
                          ),
                        }
                      : prev,
                  )
                }
                size="small"
                sx={{ width: 90 }}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
              />
            ) : null}
            {draft?.kind === 'fixed' ? (
              <TextField
                label="$ off"
                value={
                  draft?.valueCents != null ? draft.valueCents / 100 : ''
                }
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          valueCents: Math.round(
                            (Number(event.target.value) || 0) * 100,
                          ),
                        }
                      : prev,
                  )
                }
                size="small"
                sx={{ width: 110 }}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
            ) : null}
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Min subtotal ($)"
              placeholder="None"
              value={
                draft?.minSubtotalCents != null
                  ? draft.minSubtotalCents / 100
                  : ''
              }
              onChange={(event) => {
                const raw = event.target.value.trim()
                setDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        minSubtotalCents:
                          raw === ''
                            ? undefined
                            : Math.round((Number(raw) || 0) * 100),
                      }
                    : prev,
                )
              }}
              size="small"
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
            <TextField
              label="Max uses"
              placeholder="Unlimited"
              value={draft?.maxRedemptions ?? ''}
              onChange={(event) => {
                const raw = event.target.value.trim()
                setDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        maxRedemptions:
                          raw === ''
                            ? undefined
                            : Math.max(1, Math.round(Number(raw))),
                      }
                    : prev,
                )
              }}
              size="small"
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Starts"
              type="date"
              value={
                draft?.startAtMs
                  ? new Date(draft.startAtMs).toISOString().slice(0, 10)
                  : ''
              }
              onChange={(event) =>
                setDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        startAtMs: event.target.value
                          ? Date.parse(`${event.target.value}T00:00:00Z`)
                          : undefined,
                      }
                    : prev,
                )
              }
              size="small"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Ends"
              type="date"
              value={
                draft?.endAtMs
                  ? new Date(draft.endAtMs).toISOString().slice(0, 10)
                  : ''
              }
              onChange={(event) =>
                setDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        endAtMs: event.target.value
                          ? Date.parse(`${event.target.value}T23:59:59Z`)
                          : undefined,
                      }
                    : prev,
                )
              }
              size="small"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={
              (draft?.kind === 'percent' && !((draft?.valuePct ?? 0) > 0)) ||
              (draft?.kind === 'fixed' && !((draft?.valueCents ?? 0) > 0))
            }
            onClick={handleSave}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
DiscountsCard.displayName = 'DiscountsCard'

export default DiscountsCard
