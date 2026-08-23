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

import {
  createEmotionCache,
  type CreateEmotionCacheOptions,
  type EmotionCache,
} from '../../vendor/emotion'
import { MUI_CSS_LAYER_NAME } from './emotion-cache'

/**
 * An emotion cache whose output is wrapped in `@layer mui`, for surfaces that
 * cannot use `AppRouterCacheProvider` (AGL-2486).
 *
 * ## Why this exists: "what you see is not what you publish"
 *
 * `enableCssLayer` is NOT an emotion option. It is implemented by
 * `AppRouterCacheProvider` monkey-patching `cache.insert` to wrap the
 * serialized styles string (`appRouterV13.mjs`), and that patch is the only
 * code in the dependency tree that emits `@layer mui`. So every surface that
 * builds its own cache with plain `createEmotionCache` is UNLAYERED, however
 * carefully its options were copied.
 *
 * The besigner canvas was exactly that surface. Measured 2026-08-23 against
 * rendered CSS on both halves:
 *
 *  - published tenant (`northwind-coffee.aglyn.app`): 72 `@layer mui` blocks,
 *    ZERO unlayered `.mui-*` rules;
 *  - besigner canvas shadow root: ZERO layer blocks, 183 unlayered `.msd-*`
 *    rules.
 *
 * Component defaults and author `sx` share one cache, so they enter or skip
 * the layer TOGETHER and their relative order survives either way — that part
 * was never broken. What diverged is CSS that never passes through the
 * emotion cache at all, principally a Custom HTML component's `css` attribute
 * (`custom-html.tsx` renders it as a raw `<style>`). Against a fully layered
 * document that CSS wins UNCONDITIONALLY, regardless of specificity, because
 * an unlayered normal declaration beats every layered one. Against the
 * unlayered canvas it merely competes on specificity. Measured on the same
 * two surfaces with a rule of specificity 0-0-1 pitched against an emotion
 * rule of 0-1-0: it won on the published page and lost on the canvas.
 *
 * That is a divergence in the product's central claim — "publish exactly what
 * you designed" — so the canvas is layered to match the published document
 * rather than the published document unlayered to match the canvas. Layering
 * the tenant is what lets site and plugin CSS override MUI without a
 * specificity war (see `emotion-cache.ts`); that behaviour is the intended
 * one and it is the editor that has to agree with it.
 *
 * ## Notes for whoever touches this next
 *
 * - Cascade layers are scoped to a TREE CONTEXT. A `@layer mui` inside a
 *   shadow root is a different layer from the document's, with its own
 *   ordering, so reusing the name across the boundary is safe — and it has to
 *   be the same name anyway, since the point is to reproduce the published
 *   cascade exactly.
 * - The `^@layer\s+[^{]*$` guard is MUI's, kept verbatim: a bare `@layer a, b;`
 *   ORDERING statement must not be wrapped in a layer block, or it stops
 *   declaring an order and starts declaring an empty nested layer.
 * - `!important` inverts layer precedence (a layered important declaration
 *   beats an unlayered one). The canvas's `.aglyn-hidden` override in
 *   `viewport-frame.component.tsx` is an important declaration that goes
 *   through this cache, whereas the tenant ships its `.aglyn-hidden` rule from
 *   a non-emotion `<style>`. Those two were already deliberately different
 *   rules (AGL-592, the canvas reveals hidden panels while selected), so this
 *   does not make an agreeing pair disagree.
 * - `cache.compat` is deliberately NOT set here. `AppRouterCacheProvider` sets
 *   it for its streaming-SSR `flush()` registry, which this client-only
 *   shadow-root cache has no equivalent of.
 */
export function createLayeredEmotionCache(
  options: CreateEmotionCacheOptions,
): EmotionCache {
  const cache = createEmotionCache(options)
  const prevInsert = cache.insert
  cache.insert = (...args: Parameters<EmotionCache['insert']>) => {
    const serialized = args[1]
    if (!serialized.styles.match(/^@layer\s+[^{]*$/)) {
      serialized.styles = `@layer ${MUI_CSS_LAYER_NAME} {${serialized.styles}}`
    }
    return prevInsert(...args)
  }
  return cache
}
