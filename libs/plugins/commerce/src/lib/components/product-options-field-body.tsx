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

import * as Aglyn from '@aglyn/aglyn'
import { formFieldDataKey } from '../model/commerce-product-field'
import { encodeProductFieldValue, productFieldLabel } from '../model/commerce-quote-request'
import Box from '@mui/material/Box'
import FormControl from '@mui/material/FormControl'
import FormHelperText from '@mui/material/FormHelperText'
import FormLabel from '@mui/material/FormLabel'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ProductOptionsFieldProps } from './product-options-field'

/** A product as the store's public catalog lists it. */
interface ListedProduct {
  id: string
  name: string
  slug: string
}

/** A product as its public page reads it: its options and the variants they make. */
interface ProductDetail {
  id: string
  name: string
  options: Array<{ name: string; values: string[] }>
  variants: Array<{ id: string; options?: Record<string, string> }>
}

/** The most products the picker lists. */
const PICKER_LIMIT = 100

/** The variant whose options are exactly the ones picked, else none. */
export function variantForOptions(
  detail: Pick<ProductDetail, 'variants' | 'options'>,
  picked: Readonly<Record<string, string>>,
): string | null {
  if (!detail.options.length) return detail.variants[0]?.id ?? null
  if (detail.options.some((option) => !picked[option.name])) return null
  const match = detail.variants.find((variant) =>
    detail.options.every((option) => variant.options?.[option.name] === picked[option.name]),
  )
  return match?.id ?? null
}

/**
 * The Product and options field's body (AGL-4098): a picker of the store's
 * products (or the one the author chose), then one picker per option. It
 * posts the readable line under its name and the exact choice beside it; a
 * real, invisible input carries the line, so a required field with nothing
 * picked stops the form like any required field.
 *
 * On the canvas and in Preview it draws with the store's products but sends
 * nothing, like every form field there.
 */
const ProductOptionsFieldBody = forwardRef<HTMLDivElement, ProductOptionsFieldProps>((props, ref) => {
  const { name: rawName, label, productId: fixedProductId, required, ...rest } = props
  const name = String(rawName ?? '').trim() || 'product'
  const { hostId } = Aglyn.useSite()
  const inputId = useId()
  const answerRef = useRef<HTMLInputElement>(null)
  const [products, setProducts] = useState<ListedProduct[] | null>(null)
  const [productId, setProductId] = useState(fixedProductId ?? '')
  const [detail, setDetail] = useState<ProductDetail | null>(null)
  const [picked, setPicked] = useState<Record<string, string>>({})

  // The store's products, or the one the author chose.
  useEffect(() => {
    if (!hostId) return
    let active = true
    const query = new URLSearchParams({
      hostId,
      ...(fixedProductId ? { ids: fixedProductId } : { sort: 'name', limit: String(PICKER_LIMIT) }),
    })
    void fetch(`/api/commerce/catalog?${query.toString()}`)
      .then((response) => (response.ok ? response.json() : { items: [] }))
      .then((payload) => {
        if (!active) return
        const items = Array.isArray(payload?.items) ? (payload.items as ListedProduct[]) : []
        setProducts(items)
        if (fixedProductId) setProductId(items[0]?.id ?? '')
      })
      .catch(() => active && setProducts([]))
    return () => {
      active = false
    }
  }, [hostId, fixedProductId])

  // The chosen product's options.
  const slug = products?.find((product) => product.id === productId)?.slug ?? ''
  useEffect(() => {
    setDetail(null)
    setPicked({})
    if (!hostId || !slug) return
    let active = true
    void fetch(`/api/commerce/product?hostId=${encodeURIComponent(hostId)}&slug=${encodeURIComponent(slug)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!active || !payload?.product) return
        const product = payload.product as ProductDetail
        setDetail({ ...product, options: product.options ?? [], variants: product.variants ?? [] })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [hostId, slug])

  const variantId = detail ? variantForOptions(detail, picked) : null
  const complete = Boolean(detail && variantId)
  const answer = complete && detail ? productFieldLabel(detail.name, picked) : ''
  const value = complete && detail
    ? encodeProductFieldValue({
        productId: detail.id,
        ...(variantId && variantId !== 'default' ? { variantId } : {}),
        ...(Object.keys(picked).length ? { options: picked } : {}),
        // Add-ons are chosen on the storefront from slice 8 on: they ride here as `modifiers`.
      })
    : ''

  // Every change is announced, as a typed answer is, to anything listening on the form.
  const announced = useRef(answer)
  useEffect(() => {
    if (announced.current === answer) return
    announced.current = answer
    answerRef.current?.dispatchEvent(new Event('change', { bubbles: true }))
  }, [answer])

  const listed = useMemo(() => products ?? [], [products])
  // On the canvas there is no site to list from: it says what the visitor will pick from.
  const placeholder = !hostId
    ? 'Your store’s products'
    : products === null
      ? 'Loading products…'
      : listed.length
        ? 'Choose a product'
        : 'No products to choose from yet'

  return (
    <FormControl ref={ref} fullWidth required={Boolean(required)} {...rest}>
      <FormLabel htmlFor={inputId}>{label || 'Product'}</FormLabel>
      <Stack spacing={1.5} sx={{ mt: 1, position: 'relative' }}>
        {fixedProductId ? null : (
          <TextField
            id={inputId}
            select
            size="small"
            fullWidth
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            disabled={!listed.length}
            slotProps={{
              select: {
                displayEmpty: true,
                renderValue: (selected: unknown) =>
                  listed.find((product) => product.id === selected)?.name ?? (
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      {placeholder}
                    </Box>
                  ),
              },
            }}
          >
            {listed.map((product) => (
              <MenuItem key={product.id} value={product.id}>
                {product.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        {fixedProductId && detail ? <FormHelperText sx={{ mx: 0 }}>{detail.name}</FormHelperText> : null}
        {(detail?.options ?? []).map((option) => (
          <TextField
            key={option.name}
            select
            size="small"
            fullWidth
            label={option.name}
            value={picked[option.name] ?? ''}
            onChange={(event) => setPicked((current) => ({ ...current, [option.name]: event.target.value }))}
          >
            {option.values.map((choice) => (
              <MenuItem key={choice} value={choice}>
                {choice}
              </MenuItem>
            ))}
          </TextField>
        ))}
        {detail && Object.keys(picked).length === detail.options.length && detail.options.length && !variantId ? (
          <FormHelperText error sx={{ mx: 0 }}>
            {'That combination isn’t one we offer. Pick another.'}
          </FormHelperText>
        ) : null}
        {/* The answer the form sends and the browser checks, and the exact choice beside it. */}
        <Box
          component="input"
          ref={answerRef}
          type="text"
          name={name}
          value={answer}
          required={Boolean(required)}
          onChange={() => undefined}
          tabIndex={-1}
          aria-hidden="true"
          autoComplete="off"
          sx={{ position: 'absolute', left: 0, bottom: 0, width: 1, height: '1px', p: 0, border: 0, opacity: 0, pointerEvents: 'none' }}
        />
        {value ? <input type="hidden" name={formFieldDataKey(name)} value={value} readOnly /> : null}
      </Stack>
    </FormControl>
  )
})
ProductOptionsFieldBody.displayName = 'AglynProductOptionsFieldBody'

export default ProductOptionsFieldBody
