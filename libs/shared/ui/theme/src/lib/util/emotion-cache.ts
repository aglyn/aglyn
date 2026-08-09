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
 * The one emotion cache key every App Router surface renders under (AGL-1266).
 *
 * Why a shared constant rather than each app's own literal — or, as it was,
 * nobody's literal at all:
 *
 * Emotion's class name is `${cache.key}-${hash}`. The hash is a function of
 * the STYLES, the key is a function of WHICH CACHE rendered them. So two
 * renders of identical styles under two different caches produce
 * `css-13b992c` and `mui-13b992c` — same hash, different prefix — and React
 * throws away the entire server tree at hydration over the difference. That is
 * AGL-1266: every tenant page re-rendered on the client, discarding the whole
 * point of the tenant's SSR/ISR.
 *
 * Three separate defaults were in play, none of them written down:
 *
 *  - `AppRouterCacheProvider` (@mui/material-nextjs) defaults to `mui`.
 *  - `StyledEngineProvider` (@mui/styled-engine) picks `mui` when
 *    `enableCssLayer` is on and `css` when it is off — so flipping one
 *    boolean silently renames every class on that surface.
 *  - Emotion itself falls back to `css`. This is the dangerous one: on the
 *    server, `withEmotionCache` sees a null cache context and quietly
 *    CREATES `createCache({ key: 'css' })` rather than failing (see
 *    `@emotion/react`'s non-browser branch). A server tree that loses the
 *    provider therefore renders perfectly — in the wrong key, unlayered, and
 *    with no error anywhere.
 *
 * Naming the key in one place means the layouts cannot drift from each other,
 * and `emotion-cache.spec.ts` pins the fallback so the silent branch above is
 * a documented, tested fact rather than something the next person rediscovers
 * from a hydration diff.
 *
 * Deliberately dependency-free: this module is imported by App Router root
 * layouts, which are Server Components, so it must not drag React, emotion or
 * the theme HOCs into the RSC graph (AGL-405).
 */
export const EMOTION_CACHE_KEY = 'mui'

/**
 * The exact options both root layouts hand `AppRouterCacheProvider`.
 *
 * `enableCssLayer` wraps MUI's rules in `@layer mui`, which is what lets site
 * and plugin CSS override them without a specificity war. It travels WITH the
 * key on purpose: the layered and unlayered caches must never share a key, or
 * an unlayered `.mui-xxx` rule wins over the layered one with the same hash.
 */
export const APP_EMOTION_CACHE_OPTIONS = {
  key: EMOTION_CACHE_KEY,
  enableCssLayer: true,
} as const
