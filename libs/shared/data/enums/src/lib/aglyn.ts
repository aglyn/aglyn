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

/**
 * The name this software answers to when nothing has renamed it. Stated ONCE,
 * as the doc above promises, and read back by `TRADEMARK_NOTICE` rather than
 * spelled a second time — a second copy is how the two drift apart, and the
 * one that drifts is the one deciding whether a rebranded build claims our
 * marks.
 */
const DEFAULT_PLATFORM_BRAND_NAME = 'Aglyn'

const PLATFORM_BRAND_NAME =
  (process.env as PlatformBrandEnv).NEXT_PUBLIC_PLATFORM_BRAND_NAME?.trim() ||
  DEFAULT_PLATFORM_BRAND_NAME

export const BRAND = {
  ORG_NAME: PLATFORM_BRAND_NAME,
  ORG_NAME_LEGAL:
    (process.env as PlatformBrandEnv).NEXT_PUBLIC_PLATFORM_BRAND_LEGAL_NAME?.trim() ||
    `${PLATFORM_BRAND_NAME} LLC`,
}

export const PRODUCT_NAME = {
  BESIGNER: 'Besigner',
}

/**
 * The trademark attribution, or an empty string once the platform has been
 * rebranded.
 *
 * A self-hosted deployment running its own name must NOT claim Aglyn's marks —
 * the source is Apache-2.0 and yours to run, the names are not. See NOTICE.
 *
 * ## Why the marks are spelled out rather than interpolated (AGL-2486)
 *
 * This sentence is not product copy, so `PLATFORM_BRAND_NAME` is the wrong
 * substitution even though it holds the same characters on this branch. It is
 * an assertion about who owns two specific marks, and every name in it is
 * fixed:
 *
 *  - `Aglyn\u2122` is the mark itself. A build that renamed the product emits
 *    nothing here at all — that is what the ternary is for — so there is no
 *    branch on which a configured name belongs in its place.
 *  - `Aglyn LLC` is the OWNER, and must not become `BRAND.ORG_NAME_LEGAL`.
 *    That value falls back to `${PLATFORM_BRAND_NAME} LLC` but is separately
 *    settable, so a reseller who sets only `..._LEGAL_NAME` would publish
 *    "trademarks of Contoso Inc." — a false statement of ownership, produced
 *    by us, on their site.
 *
 * The brand-literal ratchet baselines these two occurrences for that reason.
 */
export const TRADEMARK_NOTICE =
  PLATFORM_BRAND_NAME === DEFAULT_PLATFORM_BRAND_NAME
    ? `Aglyn\u2122 and ${PRODUCT_NAME.BESIGNER}\u2122 are trademarks of Aglyn LLC.`
    : ''
