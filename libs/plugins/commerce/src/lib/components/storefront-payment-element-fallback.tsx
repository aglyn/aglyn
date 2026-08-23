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
 * The spinner shown WHILE the Payment Element chunk loads (AGL-2486).
 *
 * It lives in its own module for one reason: a `lazy()` fallback that is
 * imported from the lazily-loaded module cancels the laziness. `cart.tsx` and
 * `product-detail.tsx` both used to do
 *
 * ```ts
 * import { StorefrontPaymentElementFallback } from './storefront-payment-element'
 * const StorefrontPaymentElement = lazy(() => import('./storefront-payment-element'))
 * ```
 *
 * — and a static import and a dynamic import of the same module resolve to the
 * same module, so the static one pulled the whole payment element (and, with
 * it, `@stripe/stripe-js`) straight into the eager bundle. The lazy boundary
 * was decorative. Keeping the fallback here is what makes it real.
 *
 * So: nothing in this file may import `@stripe/*`, and `stripe-stays-lazy.spec.ts`
 * asserts that it does not.
 */

import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'

/** Loading fallback for the lazy boundary the callers mount this behind. */
export function StorefrontPaymentElementFallback() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
      <CircularProgress size={24} />
    </Box>
  )
}
