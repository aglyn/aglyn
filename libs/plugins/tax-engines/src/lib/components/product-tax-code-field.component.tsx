'use client'

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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Button, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { TAX_ENGINES_API_ROUTES } from '../constants/api-routes'
import { normalizeTaxCode } from '../model/tax-engines'
import { useTaxEngineConnection, useTaxEnginesFetch } from './tax-engines-api'

/**
 * What commerce's `productEditor` zone hands a widget, restated: the site and
 * the product as the editor holds it. Only the id is read; a product nobody
 * has saved has none yet.
 */
export interface ProductTaxCodeFieldProps {
  hostId: string
  product: { id: string | null; name?: string }
}

/**
 * A product's tax code for the connected tax service (AGL-3631): the
 * category the service taxes it under (clothing, food, software). Kept by
 * this plugin, not on the product, and saved on its own button — the editor's
 * Save product is the product's write and this is not part of it.
 */
export function ProductTaxCodeField(props: ProductTaxCodeFieldProps) {
  const { hostId, product } = props
  const state = useTaxEngineConnection(hostId)
  const request = useTaxEnginesFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [saved, setSaved] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const productId = product.id
  const connected = Boolean(state.available && state.connection)

  useEffect(() => {
    if (!connected || !productId) return
    let live = true
    request<{ taxCode: string | null }>(TAX_ENGINES_API_ROUTES.productTaxCode, {
      query: { hostId, productId },
    })
      .then((answer) => {
        if (!live) return
        setSaved(answer.taxCode)
        setValue(answer.taxCode ?? '')
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [connected, hostId, productId, request])

  if (!connected || !state.connection) return null
  const provider = state.connection.providerLabel
  if (!productId) {
    return (
      <Typography variant="body2" color="text.secondary">
        {`Save the product to give it a ${provider} tax code.`}
      </Typography>
    )
  }
  const invalid = value.trim() !== '' && !normalizeTaxCode(value)

  const handleSave = async () => {
    setBusy(true)
    try {
      const answer = await request<{ taxCode: string | null }>(TAX_ENGINES_API_ROUTES.productTaxCode, {
        body: { hostId, productId, taxCode: value },
      })
      setSaved(answer.taxCode)
      setValue(answer.taxCode ?? '')
      enqueueSnackbar('Tax code saved', { variant: 'success', persist: false })
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error', persist: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
      <TextField
        size="small"
        label={`${provider} tax code`}
        value={value}
        onChange={(event) => setValue(event.target.value.toUpperCase())}
        error={invalid}
        helperText={
          invalid
            ? 'Letters, numbers, dots and dashes'
            : state.connection.defaultTaxCode
              ? `Blank uses the store’s default, ${state.connection.defaultTaxCode}`
              : 'Blank taxes it as general goods'
        }
      />
      <Button size="small" disabled={busy || invalid || (value.trim() || null) === saved} onClick={handleSave}>
        {'Save code'}
      </Button>
    </Stack>
  )
}

export default ProductTaxCodeField
