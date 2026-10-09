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

import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import * as CommerceModel from '../../../model'
import { displayMoney } from '../pos-display/pos-display-api'

/** A cart line on the kiosk: what is sent, plus what the screen shows. */
export interface KioskCartLine extends CommerceModel.PosKioskLine {
  /** Merges the same item with the same choices. */
  key: string
  name: string
  label?: string
  /** The catalog's price per unit, modifiers included: an estimate until checkout. */
  unitCents: number
}

/** The lowest price a product sells at, for its tile. */
export function kioskFromCents(product: CommerceModel.PosKioskProduct): number {
  return product.variants.reduce(
    (low, variant) => Math.min(low, variant.priceCents),
    product.variants[0]?.priceCents ?? 0,
  )
}

export function kioskProductSoldOut(product: CommerceModel.PosKioskProduct): boolean {
  return product.variants.length > 0 && product.variants.every((variant) => variant.soldOut)
}

/**
 * The menu (AGL-3623): category chips, the product tiles, and the cart bar.
 * A category chip asks the server for that category; nothing is filtered
 * out of a list already loaded.
 */
export function KioskMenu({
  catalog,
  loading,
  categoryId,
  onCategory,
  onProduct,
  lines,
  currency,
  onReview,
  onQuantity,
  cartOpen,
  onCartOpen,
  busy,
}: {
  catalog: CommerceModel.PosKioskCatalog | null
  loading: boolean
  categoryId: string | null
  onCategory: (categoryId: string | null) => void
  onProduct: (product: CommerceModel.PosKioskProduct) => void
  lines: KioskCartLine[]
  currency: string
  onReview: () => void
  onQuantity: (key: string, quantity: number) => void
  cartOpen: boolean
  onCartOpen: (open: boolean) => void
  busy: boolean
}) {
  const count = lines.reduce((sum, line) => sum + line.quantity, 0)
  const estimate = lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0)
  const money = (cents: number) => displayMoney(cents, currency)
  const products = catalog?.products ?? []
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Box
        component="nav"
        aria-label="Categories"
        sx={{ display: 'flex', gap: 1, overflowX: 'auto', p: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Chip
          label="All"
          color={categoryId ? 'default' : 'primary'}
          variant={categoryId ? 'outlined' : 'filled'}
          aria-pressed={!categoryId}
          onClick={() => onCategory(null)}
          sx={(theme) => ({ minHeight: theme.spacing(6), px: 1, ...theme.typography.subtitle1 })}
        />
        {(catalog?.categories ?? []).map((category) => (
          <Chip
            key={category.id}
            label={category.name}
            color={categoryId === category.id ? 'primary' : 'default'}
            variant={categoryId === category.id ? 'filled' : 'outlined'}
            aria-pressed={categoryId === category.id}
            onClick={() => onCategory(category.id)}
            sx={(theme) => ({ minHeight: theme.spacing(6), px: 1, ...theme.typography.subtitle1 })}
          />
        ))}
      </Box>
      <Box sx={{ flex: 1, p: 2, pb: 14 }}>
        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
            <CircularProgress aria-label="Loading the menu" />
          </Box>
        ) : products.length === 0 ? (
          <Typography variant="h6" color="text.secondary" sx={{ textAlign: 'center', py: 8 }}>
            {'Nothing here yet. Try another category.'}
          </Typography>
        ) : (
          <Box
            sx={(theme) => ({
              display: 'grid',
              gap: 2,
              gridTemplateColumns: `repeat(auto-fill, minmax(${theme.spacing(22)}, 1fr))`,
            })}
          >
            {products.map((product) => {
              const soldOut = kioskProductSoldOut(product)
              const several = product.variants.length > 1
              return (
                <Card key={product.id} variant="outlined">
                  <CardActionArea
                    disabled={soldOut}
                    onClick={() => onProduct(product)}
                    sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                  >
                    {product.imageUrl ? (
                      <Box
                        component="img"
                        src={product.imageUrl}
                        alt=""
                        loading="lazy"
                        sx={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }}
                      />
                    ) : null}
                    <CardContent sx={{ flex: 1 }}>
                      <Typography variant="subtitle1" component="h2">
                        {product.name}
                      </Typography>
                      <Typography variant="body2" color={soldOut ? 'text.disabled' : 'text.secondary'}>
                        {soldOut
                          ? 'Sold out'
                          : `${several ? 'From ' : ''}${money(kioskFromCents(product))}`}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              )
            })}
          </Box>
        )}
      </Box>
      {count > 0 ? (
        <Box
          sx={(theme) => ({
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            p: 2,
            bgcolor: 'background.paper',
            borderTop: 1,
            borderColor: 'divider',
            display: 'flex',
            gap: 2,
            zIndex: theme.zIndex.appBar,
          })}
        >
          <Button
            variant="outlined"
            size="large"
            onClick={() => onCartOpen(true)}
            sx={(theme) => ({ minHeight: theme.spacing(8), ...theme.typography.h6 })}
          >
            {`Cart (${count})`}
          </Button>
          <Button
            variant="contained"
            size="large"
            disabled={busy}
            onClick={onReview}
            sx={(theme) => ({ flex: 1, minHeight: theme.spacing(8), ...theme.typography.h6 })}
          >
            {busy ? 'Getting your total…' : `Checkout · ${money(estimate)}`}
          </Button>
        </Box>
      ) : null}
      <Drawer
        anchor="right"
        open={cartOpen}
        onClose={() => onCartOpen(false)}
        slotProps={{ paper: { sx: (theme) => ({ width: `min(100vw, ${theme.spacing(60)})`, p: 2 }) } }}
      >
        <Stack spacing={2} sx={{ height: '100%' }}>
          <Typography variant="h5" component="h2">
            {'Your order'}
          </Typography>
          <Stack spacing={1} divider={<Divider flexItem />} sx={{ flex: 1, overflowY: 'auto' }}>
            {lines.map((line) => (
              <Stack key={line.key} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1">{line.name}</Typography>
                  {line.label ? (
                    <Typography variant="body2" color="text.secondary">
                      {line.label}
                    </Typography>
                  ) : null}
                  <Typography variant="body2">{money(line.unitCents * line.quantity)}</Typography>
                </Box>
                <IconButton
                  aria-label={`One fewer ${line.name}`}
                  onClick={() => onQuantity(line.key, line.quantity - 1)}
                  sx={(theme) => ({ width: theme.spacing(7), height: theme.spacing(7), border: 1, borderColor: 'divider' })}
                >
                  {'−'}
                </IconButton>
                <Typography variant="h6" component="span" aria-label="Quantity" sx={{ minWidth: (theme) => theme.spacing(4), textAlign: 'center' }}>
                  {line.quantity}
                </Typography>
                <IconButton
                  aria-label={`One more ${line.name}`}
                  disabled={line.quantity >= CommerceModel.POS_KIOSK_MAX_QUANTITY}
                  onClick={() => onQuantity(line.key, line.quantity + 1)}
                  sx={(theme) => ({ width: theme.spacing(7), height: theme.spacing(7), border: 1, borderColor: 'divider' })}
                >
                  {'+'}
                </IconButton>
              </Stack>
            ))}
            {lines.length === 0 ? (
              <Typography color="text.secondary">{'Your cart is empty.'}</Typography>
            ) : null}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {'Tax is added at checkout.'}
          </Typography>
          <Button
            variant="contained"
            size="large"
            disabled={busy || lines.length === 0}
            onClick={() => {
              onCartOpen(false)
              onReview()
            }}
            sx={(theme) => ({ minHeight: theme.spacing(8), ...theme.typography.h6 })}
          >
            {`Checkout · ${money(estimate)}`}
          </Button>
          <Button onClick={() => onCartOpen(false)} sx={(theme) => ({ minHeight: theme.spacing(7) })}>
            {'Keep ordering'}
          </Button>
        </Stack>
      </Drawer>
    </Box>
  )
}
