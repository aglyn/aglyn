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
 * WHICH PRODUCT A PRODUCT-PAGE TEMPLATE PREVIEWS (AGL-4211), in its own chunk:
 * only Preview of a Product detail block with no product pinned loads it.
 *
 * On a live site such a block takes its product from the `/products/{slug}`
 * address. Preview has none, so the template drew a skeleton that never
 * resolved. It shows the store's first listed product instead.
 */

/**
 * The slug of the store's first listed product, or `''` when it lists none
 * (the block then shows its sample). Reads the same public catalog a product
 * grid does, so a product Preview could not sell is never shown.
 */
export async function firstListedProductSlug(
  hostId: string,
  read: (input: string) => Promise<Response> = (input) => fetch(input),
): Promise<string> {
  try {
    const response = await read(`/api/commerce/catalog?hostId=${encodeURIComponent(hostId)}&limit=1`)
    if (!response.ok) return ''
    const payload = (await response.json()) as { items?: Array<{ slug?: unknown }> }
    const slug = payload?.items?.[0]?.slug
    return typeof slug === 'string' ? slug : ''
  } catch {
    return ''
  }
}
