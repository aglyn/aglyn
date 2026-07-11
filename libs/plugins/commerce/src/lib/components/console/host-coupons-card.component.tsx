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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, doc, limit, query, setDoc, updateDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useFirestoreCollection } from '@aglyn/tenant-feature-instance'

export interface HostCouponsCardProps {
  hostId: string
}

/**
 * Coupon codes (AGL-96), extracted from the retired Commerce Starter
 * card when the products hub landed (AGL-279). Percent-off codes at
 * `hosts/{hostId}/coupons/{CODE}`; the discounts engine (AGL-305)
 * supersedes these.
 */
export function HostCouponsCard(props: HostCouponsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { data: couponDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'coupons'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const coupons = [...(couponDocs ?? [])].sort((a: any, b: any) =>
    String(a.$id).localeCompare(String(b.$id)),
  )
  const [couponDraft, setCouponDraft] = useState<{
    code: string
    percentOff: string
    maxRedemptions: string
  } | null>(null)

  const handleCouponSave = useCallback(async () => {
    if (!couponDraft) return
    const code = couponDraft.code
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 40)
    const percentOff = Math.round(Number(couponDraft.percentOff))
    if (!code || !(percentOff > 0 && percentOff <= 100)) return
    await setDoc(doc(firestore, 'hosts', hostId, 'coupons', code), {
      percentOff,
      enabled: true,
      redemptions: 0,
      ...(couponDraft.maxRedemptions.trim()
        ? {
            maxRedemptions: Math.max(
              1,
              Math.round(Number(couponDraft.maxRedemptions)),
            ),
          }
        : {}),
      createdAt: Timestamp.now(),
    })
    setCouponDraft(null)
    enqueueSnackbar(`Coupon ${code} created`, {
      variant: 'success',
      persist: false,
    })
  }, [couponDraft, firestore, hostId, enqueueSnackbar])

  const handleCouponToggle = useCallback(
    (coupon: any) => () =>
      updateDoc(doc(firestore, 'hosts', hostId, 'coupons', coupon.$id), {
        enabled: coupon.enabled === false,
      }),
    [firestore, hostId],
  )

  return (
    <CardDisplay header={'Coupons'} contentGutterX contentGutterY>
      <Stack spacing={1}>
        {coupons.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Percent-off codes buyers can enter at checkout.'}
          </Typography>
        ) : (
          coupons.map((coupon: any) => (
            <Stack
              key={coupon.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                {`${coupon.$id} · ${coupon.percentOff}% off · ` +
                  `${coupon.redemptions ?? 0}${
                    coupon.maxRedemptions ? `/${coupon.maxRedemptions}` : ''
                  } used` +
                  (coupon.enabled === false ? ' · disabled' : '')}
              </Typography>
              <Button size="small" onClick={handleCouponToggle(coupon)}>
                {coupon.enabled === false ? 'Enable' : 'Disable'}
              </Button>
            </Stack>
          ))
        )}
        <Button
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() =>
            setCouponDraft({ code: '', percentOff: '', maxRedemptions: '' })
          }
        >
          {'Add coupon'}
        </Button>
      </Stack>
      <Dialog
        open={Boolean(couponDraft)}
        onClose={() => setCouponDraft(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'New coupon'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Code"
            value={couponDraft?.code ?? ''}
            onChange={(event) =>
              setCouponDraft((prev) =>
                prev ? { ...prev, code: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
            helperText="Letters/numbers; stored uppercase, e.g. LAUNCH20"
          />
          <TextField
            label="Percent off"
            type="number"
            value={couponDraft?.percentOff ?? ''}
            onChange={(event) =>
              setCouponDraft((prev) =>
                prev ? { ...prev, percentOff: event.target.value } : prev,
              )
            }
            size="small"
          />
          <TextField
            label="Max redemptions"
            type="number"
            placeholder="Blank = unlimited"
            value={couponDraft?.maxRedemptions ?? ''}
            onChange={(event) =>
              setCouponDraft((prev) =>
                prev ? { ...prev, maxRedemptions: event.target.value } : prev,
              )
            }
            size="small"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCouponDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={
              !couponDraft?.code.trim() ||
              !(Number(couponDraft?.percentOff) > 0) ||
              Number(couponDraft?.percentOff) > 100
            }
            onClick={handleCouponSave}
          >
            {'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostCouponsCard.displayName = 'HostCouponsCard'

export default HostCouponsCard
