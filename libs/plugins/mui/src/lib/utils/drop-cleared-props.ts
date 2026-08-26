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
 * Drops props an author CLEARED, so MUI's own defaults apply (AGL-1226).
 *
 * The besigner persists a cleared attribute as `null` (or `''`), and React
 * only falls back to a default for `undefined` — an explicit `null` is a
 * value. So `<Button color={null}>` does NOT become `color="primary"`; the
 * null travels all the way into MUI, which builds its class names with
 * `` `color${capitalize(color)}` `` and throws:
 *
 *     Minified MUI error #7 — capitalize(string) expects a string argument
 *
 * That is a SERVER-SIDE THROW during render, so the whole page 500s. It took
 * down every `/product/*` page on the public marketing site, uncached
 * (`x-vercel-cache: MISS` every time), for as long as one button carried a
 * cleared colour.
 *
 * Stripping the key instead is what the author meant by clearing it: fall
 * back to the component's default. Applied at the wrapper boundary rather
 * than fixing the two offending documents, because a data fix leaves every
 * other site one cleared dropdown away from the same 500.
 *
 * `0` and `false` are kept — those are real values an author can mean.
 *
 * `data-*` and `aria-*` are kept whatever their value. Only an authored
 * ATTRIBUTE can be cleared, and neither of those is one: they are stamped by
 * the renderer, and the canvas writes its flags PRESENCE-BASED — `''` for on,
 * `undefined` for off — which is the same empty string a cleared select
 * persists as. Dropping them took out every presence flag on every component
 * that funnels through here: `data-aglyn-revealed`, so a panel carrying the
 * hidden class could never be shown for designing; `data-aglyn-selected-within`,
 * which is how a nav menu and a drawer know to open while they are being
 * authored; and `data-aglyn-bound`, the outline on an element whose props
 * carry bindings. They are also incapable of the crash above — both go
 * straight to the DOM, where an empty attribute is ordinary HTML and nothing
 * calls `capitalize()` on the value.
 */
function isRendererAttribute(key: string): boolean {
  return key.startsWith('data-') || key.startsWith('aria-')
}

export function dropClearedProps<T extends Record<string, any>>(props: T): T {
  let cleared = false
  for (const key in props) {
    const value = props[key]
    if ((value === null || value === '') && !isRendererAttribute(key)) {
      cleared = true
      break
    }
  }
  if (!cleared) return props
  const next: Record<string, any> = {}
  for (const key in props) {
    const value = props[key]
    if ((value === null || value === '') && !isRendererAttribute(key)) continue
    next[key] = value
  }
  return next as T
}

export default dropClearedProps
