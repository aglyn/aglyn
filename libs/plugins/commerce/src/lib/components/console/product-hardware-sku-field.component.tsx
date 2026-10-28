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

import { MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useUser } from '@aglyn/tenant-feature-instance'
import { memo, useEffect, useId, useState } from 'react'
import type * as CommerceModel from '../../model'
import { posHardwareSaleStatus, type PosHardwareSaleStatus } from './pos/pos-hardware-sale-api'

type Patch = Partial<CommerceModel.HostProduct>

export interface ProductHardwareSkuFieldProps {
  hostId: string
  hardwareSku: string | undefined
  update: (patch: Patch) => void
}

/**
 * "Point of sale hardware" (AGL-4038): which card reader or accessory this
 * product is, on the platform's own store only. A sale of it at that
 * store's register becomes a hardware order for the buyer's workspace. On
 * every other store the server answers `seller: false` and this draws
 * nothing, so no merchant is shown a control that would do nothing.
 *
 * Loaded on its own, only by the editor's register section.
 */
function ProductHardwareSkuField(props: ProductHardwareSkuFieldProps) {
  const { hostId, hardwareSku, update } = props
  const { data: user } = useUser()
  const helpId = useId()
  const [status, setStatus] = useState<PosHardwareSaleStatus | null>(null)

  useEffect(() => {
    if (!user || !hostId) return
    let live = true
    posHardwareSaleStatus(user, hostId)
      .then((answer) => {
        if (live) setStatus(answer)
      })
      // A store that cannot be asked shows nothing, as one that is not the seller.
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [user, hostId])

  if (!status?.seller) return null
  const known = status.items.some((item) => item.sku === hardwareSku)
  return (
    <Stack spacing={0.5}>
      <TextField
        select
        size="small"
        label="Point of sale hardware"
        value={known ? hardwareSku : ''}
        onChange={(event) => update({ hardwareSku: event.target.value })}
        slotProps={{ htmlInput: { 'aria-describedby': helpId } }}
        sx={{ maxWidth: (theme) => theme.spacing(50) }}
      >
        <MenuItem value="">{'Not point of sale hardware'}</MenuItem>
        {status.items.map((item) => (
          <MenuItem key={item.sku} value={item.sku}>
            {item.name}
          </MenuItem>
        ))}
      </TextField>
      <Typography id={helpId} variant="body2" color="text.secondary">
        {known
          ? 'Selling this at the register makes a hardware order for the buyer’s workspace.'
          : 'Choose the card reader or accessory this product is, so a sale of it at the register reaches the buyer’s workspace.'}
      </Typography>
    </Stack>
  )
}

export default memo(ProductHardwareSkuField)
