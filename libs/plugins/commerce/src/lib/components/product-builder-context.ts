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

import { createContext } from 'react'
import type { ModifierSelection } from '../model/product-modifiers'

/*
 * WHAT A PRODUCT PAGE'S SHOPPER HAS PICKED (AGL-4205).
 *
 * The Product detail block holds the picks; anything the site builder drops
 * into the block — a request form with a Product and options field, for a
 * free mockup — reads them here instead of asking the shopper again. Plain
 * ids and words only: every price is worked out again from the product when
 * a quote is started from the request.
 */
export interface ProductBuilderPicks {
  productId: string
  productName: string
  /** The variant the options make; absent for a product with one variant. */
  variantId?: string
  /** The options as picked, by option name. */
  options: Record<string, string>
  /** The add-ons picked, ids only. */
  modifiers: ModifierSelection[]
  /** The add-ons' names, in the order picked, for the readable line. */
  addOnNames: string[]
  quantity: number
  /** Every required choice is answered. */
  ready: boolean
  /** What is still to choose, when not ready. */
  problem?: string
  /** What the picks come to, formatted (`$1,250.00`); absent before a price is set. */
  total?: string
}

/** The picks of the Product detail block around a node; null outside one. */
export const ProductBuilderContext = createContext<ProductBuilderPicks | null>(null)
ProductBuilderContext.displayName = 'ProductBuilderContext'
