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

/*==========================================
 * REGISTER MODIFIERS AND QUICK KEYS (AGL-3607).
 *
 * A modifier is a choice added to an item as it is rung up — "Oat milk",
 * "Extra shot +$0.75", "No onions" — that is not a stocked variant. Groups
 * live on the product (`modifierGroups`); the register sends the chosen
 * option ids with each line and the SERVER prices them from the product
 * document, so a register never names what a modifier costs.
 *
 * A chosen modifier is folded into the line's `variantLabel` as well as kept
 * structured in `modifiers`: every receipt, email, order view and export
 * already prints the label, so the choice reaches all of them without each
 * learning a new field.
 *=========================================*/

/** One choice in a modifier group. `priceCents` is added to the item, 0 for free. */
export interface ProductModifierOption {
  id: string
  name: string
  priceCents: number
}

/**
 * A set of choices offered together ("Milk", "Add-ons"). `min` of 1 or more
 * makes it required; `max` caps how many can be picked (1 = pick one).
 */
export interface ProductModifierGroup {
  id: string
  name: string
  min: number
  max: number
  options: ProductModifierOption[]
}

/** A modifier as the order line keeps it: names and price as sold. */
export interface OrderLineModifier {
  groupId: string
  optionId: string
  group: string
  name: string
  priceCents: number
}

/** What the register sends for a line: the option ids it picked, nothing priced. */
export interface ModifierSelection {
  groupId: string
  optionId: string
}

export const POS_MAX_MODIFIER_GROUPS = 10
export const POS_MAX_MODIFIER_OPTIONS = 20
/** $1,000 on one modifier: anything larger is a product, not an add-on. */
export const POS_MAX_MODIFIER_PRICE_CENTS = 100_000

/** Why a product's modifier groups cannot be saved, or null when they can. */
export function modifierGroupsProblem(groups: unknown): string | null {
  if (groups == null) return null
  if (!Array.isArray(groups)) return 'Modifiers must be a list'
  if (groups.length > POS_MAX_MODIFIER_GROUPS) {
    return `At most ${POS_MAX_MODIFIER_GROUPS} modifier groups per product`
  }
  const groupIds = new Set<string>()
  for (const group of groups as ProductModifierGroup[]) {
    if (!group?.id || groupIds.has(group.id)) return 'Modifier groups need unique ids'
    groupIds.add(group.id)
    if (!String(group.name ?? '').trim()) return 'Name every modifier group'
    const options = Array.isArray(group.options) ? group.options : []
    if (options.length === 0) return `Add a choice to “${group.name}”`
    if (options.length > POS_MAX_MODIFIER_OPTIONS) {
      return `“${group.name}” has more than ${POS_MAX_MODIFIER_OPTIONS} choices`
    }
    const optionIds = new Set<string>()
    for (const option of options) {
      if (!option?.id || optionIds.has(option.id)) return 'Modifier choices need unique ids'
      optionIds.add(option.id)
      if (!String(option.name ?? '').trim()) return `Name every choice in “${group.name}”`
      const price = option.priceCents
      if (!Number.isInteger(price) || price < 0 || price > POS_MAX_MODIFIER_PRICE_CENTS) {
        return `“${option.name}” needs a price of $0 to $1,000`
      }
    }
    const { min, max } = group
    if (!Number.isInteger(min) || min < 0) return `“${group.name}” needs a minimum of 0 or more`
    if (!Number.isInteger(max) || max < 1 || max > options.length) {
      return `“${group.name}” allows 1 to ${options.length} choices`
    }
    if (min > max) return `“${group.name}” requires more choices than it allows`
  }
  return null
}

/** The product's groups, or none when they are missing or malformed. */
export function productModifierGroups(product: {
  modifierGroups?: unknown
}): ProductModifierGroup[] {
  const groups = product?.modifierGroups
  if (!Array.isArray(groups) || modifierGroupsProblem(groups)) return []
  return groups as ProductModifierGroup[]
}

/** Whether a group must be answered before the item can be added. */
export function modifierGroupRequired(group: ProductModifierGroup): boolean {
  return group.min > 0
}

/**
 * Prices a line's chosen modifiers from the PRODUCT, in group order, and
 * checks every group's minimum and maximum. Unknown ids, a repeated choice
 * and a group answered past its maximum are refused with what to fix.
 */
export interface ResolvedLineModifiers {
  ok: boolean
  /** The chosen modifiers, in group order; empty when not `ok`. */
  modifiers: OrderLineModifier[]
  /** What they add to one unit, in cents. */
  extraCents: number
  /** What to fix, when not `ok`. */
  error?: string
}

export function resolveLineModifiers(
  product: { name?: string; modifierGroups?: unknown },
  raw: unknown,
): ResolvedLineModifiers {
  const refuse = (error: string): ResolvedLineModifiers => ({
    ok: false,
    modifiers: [],
    extraCents: 0,
    error,
  })
  const groups = productModifierGroups(product)
  const picks: ModifierSelection[] = (Array.isArray(raw) ? raw : [])
    .slice(0, POS_MAX_MODIFIER_GROUPS * POS_MAX_MODIFIER_OPTIONS)
    .map((entry: any) => ({
      groupId: String(entry?.groupId ?? ''),
      optionId: String(entry?.optionId ?? ''),
    }))
  const seen = new Set<string>()
  for (const pick of picks) {
    const key = `${pick.groupId}:${pick.optionId}`
    if (seen.has(key)) return refuse(`A choice on ${product.name} was picked twice.`)
    seen.add(key)
    const group = groups.find((entry) => entry.id === pick.groupId)
    if (!group || !group.options.some((option) => option.id === pick.optionId)) {
      return refuse(`A choice on ${product.name} is no longer offered. Remove it and add it again.`)
    }
  }
  const modifiers: OrderLineModifier[] = []
  for (const group of groups) {
    const chosen = group.options.filter((option) =>
      picks.some((pick) => pick.groupId === group.id && pick.optionId === option.id),
    )
    if (chosen.length < group.min) {
      return refuse(`Choose ${group.name.toLowerCase()} for ${product.name}.`)
    }
    if (chosen.length > group.max) {
      return refuse(`Choose at most ${group.max} for ${group.name.toLowerCase()} on ${product.name}.`)
    }
    for (const option of chosen) {
      modifiers.push({
        groupId: group.id,
        optionId: option.id,
        group: group.name,
        name: option.name,
        priceCents: option.priceCents,
      })
    }
  }
  return {
    ok: true,
    modifiers,
    extraCents: modifiers.reduce((sum, modifier) => sum + modifier.priceCents, 0),
  }
}

/** The label a line prints: the variant, then each modifier (`Large / Oat milk, Extra shot`). */
export function lineLabelWithModifiers(
  variantLabel: string | undefined,
  modifiers: readonly Pick<OrderLineModifier, 'name'>[],
): string {
  const added = modifiers.map((modifier) => modifier.name).join(', ')
  return [variantLabel, added].filter(Boolean).join(' / ')
}

/** Two lines merge only when they are the same item with the same choices. */
export function modifierSelectionKey(selection: readonly ModifierSelection[] | undefined): string {
  return [...(selection ?? [])]
    .map((pick) => `${pick.groupId}:${pick.optionId}`)
    .sort()
    .join('|')
}
