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

import { validateProduct, type HostProduct } from './commerce'
import type { ProductModifierGroup } from './product-modifiers'

/*
 * THE PRODUCT BUILDER'S SAVE RULES (AGL-4205): a choice's or a variant's
 * picture and note, what a combo includes, and the free-mockup switch. Held at
 * SAVE by {@link validateProductForSave}, which every product write calls
 * (the console editor, the server writers, an import), apart from
 * `validateProduct` and `modifierGroupsProblem`, which the storefront also
 * runs. These fields are display only, so a page never needs them checked to
 * price a sale; keeping them out of the model barrel keeps them out of what
 * every page downloads (check:plugin-budgets). Import this file directly.
 */

/** The longest note a choice or variant card carries (AGL-4205). */
export const PRODUCT_CHOICE_NOTE_MAX = 160
/** The most items a combo lists, and the longest each may be (AGL-4205). */
export const PRODUCT_COMBO_MAX_ITEMS = 12
export const PRODUCT_COMBO_ITEM_MAX = 80
/** The longest picture address a card keeps. */
export const PRODUCT_CHOICE_IMAGE_URL_MAX = 2000

/**
 * Why a card's picture and note cannot be saved, or null when they can
 * (AGL-4205). Shared by a choice and a variant. `what` names it in the
 * message.
 */
export function choiceCardProblem(
  card: { imageUrl?: unknown; note?: unknown },
  what: string,
): string | null {
  if (card.imageUrl != null) {
    if (typeof card.imageUrl !== 'string' || card.imageUrl.length > PRODUCT_CHOICE_IMAGE_URL_MAX) {
      return `Choose the picture for “${what}” again`
    }
  }
  if (card.note != null) {
    if (typeof card.note !== 'string') return `The note on “${what}” must be text`
    if (card.note.length > PRODUCT_CHOICE_NOTE_MAX) {
      return `Keep the note on “${what}” to ${PRODUCT_CHOICE_NOTE_MAX} characters`
    }
  }
  return null
}

/** Why a combo's contents cannot be saved, or null when they can (AGL-4205). */
export function comboIncludesProblem(includes: unknown, what: string): string | null {
  if (includes == null) return null
  if (!Array.isArray(includes)) return `What “${what}” includes must be a list`
  if (includes.length > PRODUCT_COMBO_MAX_ITEMS) {
    return `“${what}” lists more than ${PRODUCT_COMBO_MAX_ITEMS} items`
  }
  for (const item of includes) {
    if (typeof item !== 'string' || !item.trim()) return `Name every item “${what}” includes`
    if (item.length > PRODUCT_COMBO_ITEM_MAX) {
      return `Keep each item “${what}” includes to ${PRODUCT_COMBO_ITEM_MAX} characters`
    }
  }
  return null
}

/** Why a product's add-on choices' cards cannot be saved, or null when they can. */
export function modifierCardsProblem(groups: unknown): string | null {
  if (!Array.isArray(groups)) return null
  for (const group of groups as ProductModifierGroup[]) {
    for (const option of Array.isArray(group?.options) ? group.options : []) {
      const problem =
        choiceCardProblem(option, option.name) ?? comboIncludesProblem(option.includes, option.name)
      if (problem) return problem
    }
  }
  return null
}

/** Why the product builder's fields on a product cannot be saved, or null when they can. */
export function productBuilderProblem(
  product: Pick<HostProduct, 'modifierGroups' | 'variants' | 'mockupRequests'>,
): string | null {
  if (product.mockupRequests != null && typeof product.mockupRequests !== 'boolean') {
    return 'Offering a free mockup is on or off'
  }
  for (const variant of product.variants ?? []) {
    const problem = choiceCardProblem(
      variant,
      Object.values(variant.options ?? {}).filter(Boolean).join(' / ') || 'Default',
    )
    if (problem) return problem
  }
  return modifierCardsProblem(product.modifierGroups)
}

/** {@link validateProduct} and the product builder's fields: the check every product write makes. */
export function validateProductForSave(product: HostProduct): string | null {
  return validateProduct(product) ?? productBuilderProblem(product)
}
