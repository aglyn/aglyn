/**
 * @license
 * Copyright 2022 Aglyn LLC
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
 * Platform-brand configuration, read in the ONE form that satisfies both rules
 * this repo enforces (AGL-2153).
 *
 *  - Next inlines `NEXT_PUBLIC_*` by substituting the **dot** member
 *    expression `process.env.NAME`. The bracket form is never substituted and
 *    reads `undefined` in the browser — the AGL-2037 bug.
 *  - `libs/shared/ui/json-editor` and `libs/shared/ui/color-picker` compile
 *    with `noPropertyAccessFromIndexSignature: true`, and they transitively
 *    compile THIS lib. Under that flag TypeScript refuses dot access on
 *    `ProcessEnv`'s index signature and tells you to use brackets — i.e. the
 *    compiler pushes you straight into the runtime bug.
 *
 * The inline cast resolves it, and the shape below is not arbitrary: it was
 * checked against the emitted JavaScript rather than assumed.
 *
 *     (process.env as PlatformBrandEnv).NEXT_PUBLIC_X  →  process.env.NEXT_PUBLIC_X   ✅
 *     const env = process.env as PlatformBrandEnv; env.NEXT_PUBLIC_X
 *                                                  →  env.NEXT_PUBLIC_X               ❌
 *
 * The cast is erased and the member expression survives, so the substitution
 * matches. Hoisting `process.env` into a local — the obvious tidy-up — breaks
 * it silently: the code still compiles, still reads fine, and inlines nothing.
 * Do not hoist it.
 *
 * The env NAMES are the shared contract with `libs/aglyn/.../platform-brand.ts`
 * and `apps/tenant/middleware.ts`; one value, one name (AGL-733). The literal
 * default is stated once here, in this lib, and nowhere else in it.
 */
interface PlatformBrandEnv {
  NEXT_PUBLIC_PLATFORM_BRAND_NAME?: string
  NEXT_PUBLIC_PLATFORM_BRAND_LEGAL_NAME?: string
}

const PLATFORM_BRAND_NAME =
  (process.env as PlatformBrandEnv).NEXT_PUBLIC_PLATFORM_BRAND_NAME?.trim() ||
  'Aglyn'

export const BRAND = {
  ORG_NAME: PLATFORM_BRAND_NAME,
  ORG_NAME_LEGAL:
    (process.env as PlatformBrandEnv).NEXT_PUBLIC_PLATFORM_BRAND_LEGAL_NAME?.trim() ||
    `${PLATFORM_BRAND_NAME} LLC`,
}

export const PRODUCT_NAME = {
  BESIGNER: 'Besigner',
}
