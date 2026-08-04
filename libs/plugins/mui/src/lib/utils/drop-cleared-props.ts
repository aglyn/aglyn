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
 */
export function dropClearedProps<T extends Record<string, any>>(props: T): T {
  let cleared = false
  for (const key in props) {
    const value = props[key]
    if (value === null || value === '') {
      cleared = true
      break
    }
  }
  if (!cleared) return props
  const next: Record<string, any> = {}
  for (const key in props) {
    const value = props[key]
    if (value === null || value === '') continue
    next[key] = value
  }
  return next as T
}

export default dropClearedProps
