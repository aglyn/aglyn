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

import { mdiChevronDown } from '@aglyn/shared-data-mdi'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Box from '@mui/material/Box'
import SvgIcon from '@mui/material/SvgIcon'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import type { OptionPresentation } from './product-detail'

/*
 * THE PRODUCT PAGE'S DETAILS AND SHIPPING & RETURNS FOLDS, in their own chunk
 * (split out of the Product detail block for AGL-4205): both are off by
 * default, so a page that shows neither never downloads them.
 */

/** What the Details panel lists: only facts the product record holds. */
export function productDetailFacts(
  product: { type?: string; tags?: string[] },
  variant: { sku?: string } | undefined,
  presented: readonly OptionPresentation[],
): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = []
  if (product.type === 'digital')
    facts.push({ label: 'Format', value: 'Digital product' })
  if (product.type === 'service')
    facts.push({ label: 'Format', value: 'Service' })
  for (const option of presented) {
    if (option.mode !== 'hidden') {
      facts.push({ label: option.name, value: option.values.join(', ') })
    }
  }
  if (variant?.sku) facts.push({ label: 'SKU', value: variant.sku })
  if (product.tags?.length)
    facts.push({ label: 'Tags', value: product.tags.join(', ') })
  return facts
}

/**
 * What the Shipping & returns panel says, from the product's kind and the
 * store's own return settings — never a policy the store has not set.
 */
export function productShippingLines(
  product: { type?: string },
  returns: { windowDays: number } | undefined,
): string[] {
  const lines: string[] = []
  if (product.type === 'digital')
    lines.push('Delivered digitally after purchase — nothing ships.')
  else if (product.type === 'service') lines.push('A service — nothing ships.')
  else lines.push('Shipping is calculated at checkout.')
  if (returns && returns.windowDays > 0) {
    lines.push(
      `Returns accepted within ${returns.windowDays} ` +
        `${returns.windowDays === 1 ? 'day' : 'days'} of shipping — ` +
        'request one from your order status page.',
    )
  }
  return lines
}

/**
 * One fold of the panels under the buy box: a flat, divided accordion in the
 * theme's own colours — the way a designer storefront stacks Details and
 * Shipping under the description.
 */
function ProductDetailPanel({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <Accordion
      disableGutters
      elevation={0}
      square
      sx={{
        bgcolor: 'transparent',
        borderTop: 1,
        borderColor: 'divider',
        '&:last-of-type': { borderBottom: 1, borderColor: 'divider' },
        '&::before': { display: 'none' },
      }}
    >
      <AccordionSummary
        expandIcon={
          <SvgIcon fontSize="small">
            <path d={mdiChevronDown.path} />
          </SvgIcon>
        }
        sx={{ px: 0 }}
      >
        <Typography variant="subtitle1" component="h2">
          {title}
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0, pb: 2 }}>
        {children}
      </AccordionDetails>
    </Accordion>
  )
}

export interface ProductDetailPanelsProps {
  product: { type?: string; tags?: string[] }
  variant: { sku?: string } | undefined
  presented: readonly OptionPresentation[]
  /** The store's return window, when it takes returns of this kind. */
  returns: { windowDays: number } | undefined
  showDetails: boolean
  showShipping: boolean
}

/** The folds under the buy box: the facts the product holds, and how it ships. */
export function ProductDetailPanels(props: ProductDetailPanelsProps) {
  const { product, variant, presented, returns, showDetails, showShipping } =
    props
  const detailFacts = showDetails
    ? productDetailFacts(product, variant, presented)
    : []
  const shippingLines = showShipping
    ? productShippingLines(product, returns)
    : []
  return (
    <>
      {detailFacts.length || shippingLines.length ? (
        <Box sx={{ mt: 3 }}>
          {detailFacts.length ? (
            <ProductDetailPanel title="Details">
              <Box
                component="dl"
                sx={{
                  m: 0,
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  columnGap: 2,
                  rowGap: 0.75,
                }}
              >
                {detailFacts.map((fact) => (
                  <Box key={fact.label} sx={{ display: 'contents' }}>
                    <Typography
                      component="dt"
                      variant="body2"
                      sx={{ fontWeight: 600 }}
                    >
                      {fact.label}
                    </Typography>
                    <Typography
                      component="dd"
                      variant="body2"
                      color="text.secondary"
                      sx={{ m: 0 }}
                    >
                      {fact.value}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </ProductDetailPanel>
          ) : null}
          {shippingLines.length ? (
            <ProductDetailPanel title="Shipping & returns">
              {shippingLines.map((line) => (
                <Typography
                  key={line}
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 0.75 }}
                >
                  {line}
                </Typography>
              ))}
            </ProductDetailPanel>
          ) : null}
        </Box>
      ) : null}
    </>
  )
}

ProductDetailPanels.displayName = 'ProductDetailPanels'

export default ProductDetailPanels
