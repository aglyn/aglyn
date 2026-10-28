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

/*
 * Kept out of `commerce.ts` on purpose: that module is in commerce's eager
 * console bundle, and only the kiosk route and the product editor, both
 * loaded on demand, ask this.
 */

/**
 * Whether the self-service kiosk offers a product, or one of its variants
 * (AGL-4038). Only an explicit `false` turns either off, so a product stored
 * before the choice existed is offered exactly as it was. A variant is
 * offered only when its product is: the product's choice is the outer one.
 * Nothing here is about a kind of product — what any merchant sells is
 * theirs to put on the kiosk or keep off it.
 */
export function productOfferedOnKiosk(
  product: { offerOnKiosk?: unknown; variants?: ReadonlyArray<{ id: string; offerOnKiosk?: unknown }> } | null | undefined,
  variantId?: string | null,
): boolean {
  if (!product || product.offerOnKiosk === false) return false
  if (!variantId) return true
  const variant = (product.variants ?? []).find((candidate) => candidate.id === variantId)
  return variant?.offerOnKiosk !== false
}
