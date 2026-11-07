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
import Collapse from '@mui/material/Collapse'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useRef, useState, type ReactNode } from 'react'
import type { ModifierSelection, ProductModifierGroup } from '../model/product-modifiers'
import { ProductBuilderContext, type ProductBuilderPicks } from './product-builder-context'

/*
 * THE FREE MOCKUP ON A PRODUCT PAGE (AGL-4205), in its own chunk: only a
 * product that offers one, or the canvas, downloads it. The button opens
 * what the site builder dropped into the Product detail block, a request
 * form whose Product and options field reads the picks from the context.
 */

/** The free-mockup button's words when the site builder typed none. */
export const MOCKUP_LABEL_DEFAULT = 'Get a free mockup'

/**
 * The picks a request form in the block reads: ids and words only, and
 * whether every required choice is answered.
 */
export function productBuilderPicks(input: {
  product: { id: string; name: string; modifierGroups?: readonly ProductModifierGroup[] }
  variant: { id: string; options?: Record<string, string> } | undefined
  addOns: readonly ModifierSelection[]
  quantity: number
  ready: boolean
  problem?: string
  total?: string
}): ProductBuilderPicks {
  const { product, variant, addOns, quantity, ready, problem, total } = input
  const names: string[] = []
  for (const group of product.modifierGroups ?? []) {
    for (const option of group.options) {
      if (addOns.some((pick) => pick.groupId === group.id && pick.optionId === option.id)) {
        names.push(option.name)
      }
    }
  }
  const options = Object.fromEntries(
    Object.entries(variant?.options ?? {}).filter(([, value]) => Boolean(value)),
  )
  return {
    productId: product.id,
    productName: product.name,
    ...(variant && variant.id !== 'default' ? { variantId: variant.id } : {}),
    options,
    modifiers: addOns.map((pick) => ({ groupId: pick.groupId, optionId: pick.optionId })),
    addOnNames: names,
    quantity,
    ready: ready && Boolean(variant),
    ...(problem ? { problem } : {}),
    ...(total ? { total } : {}),
  }
}

export interface ProductBuilderMockupProps {
  picks: Parameters<typeof productBuilderPicks>[0]
  /** The button's words; the default when blank. */
  label?: string
  /** A priced product's button sits under Buy now; an unpriced one's is the main action. */
  priced: boolean
  /** On the canvas the form stays open, and an empty block says what to drop in. */
  canvas: boolean
  hasRequestForm: boolean
  children?: ReactNode
}

/** "Get a free mockup" and the request form it opens. */
export function ProductBuilderMockup(props: ProductBuilderMockupProps) {
  const { picks, label, priced, canvas, hasRequestForm, children } = props
  const [open, setOpen] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)
  const shown = open || canvas
  return (
    <Box sx={{ mb: 2 }}>
      <Button
        variant={priced ? 'text' : 'contained'}
        color="primary"
        size="large"
        aria-expanded={shown}
        onClick={() => {
          setOpen(true)
          // After the form has opened, so it is where the page scrolls to.
          window.setTimeout(() => formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 50)
        }}
      >
        {label?.trim() || MOCKUP_LABEL_DEFAULT}
      </Button>
      <Collapse in={shown} ref={formRef}>
        <Paper variant="outlined" sx={{ p: 2, mt: 1 }}>
          <ProductBuilderContext.Provider value={productBuilderPicks(picks)}>
            {hasRequestForm ? (
              children
            ) : (
              <Typography variant="body2" color="text.secondary">
                {'Drop a request form here: a form with a Product and options field, the ' +
                  'contact fields and a File upload for artwork. It opens with the shopper’s picks.'}
              </Typography>
            )}
          </ProductBuilderContext.Provider>
        </Paper>
      </Collapse>
    </Box>
  )
}

ProductBuilderMockup.displayName = 'ProductBuilderMockup'

export default ProductBuilderMockup
