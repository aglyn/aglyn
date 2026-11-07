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

/**
 * The canvas's sample for a Product detail block that shows picture cards
 * (AGL-4205): an add-on group with a combo, and a free mockup offered, so the
 * site builder sees every part the builder draws and can design the request
 * form. Its own chunk: only the canvas loads it.
 */
export const SAMPLE_BUILDER = {
  id: 'sample',
  name: 'Sample product',
  slug: '#',
  description: 'Drop this block on your product page template.',
  mediaUrls: [] as string[],
  options: [{ name: 'Size', values: ['Small', 'Medium', 'Large'] }],
  variants: [
    { id: 'a', options: { Size: 'Small' }, priceUsd: 299, soldOut: false, note: 'Fits one table' },
    { id: 'b', options: { Size: 'Medium' }, priceUsd: 399, soldOut: false, note: 'Fits two tables' },
    { id: 'c', options: { Size: 'Large' }, priceUsd: 549, soldOut: false, note: 'Fits a booth' },
  ],
  modifierGroups: [
    {
      id: 'g',
      name: 'Add-ons',
      min: 0,
      max: 2,
      online: true,
      options: [
        { id: 'o1', name: 'Side wall', priceCents: 8900, note: 'Blocks wind on one side' },
        { id: 'o2', name: 'Weekend kit', priceCents: 19900, includes: ['Side wall ×2', 'Weights ×4', 'Carry bag'] },
      ],
    },
  ],
  mockupRequests: true as const,
}
