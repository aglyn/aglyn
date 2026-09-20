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
 * The components a plugin's module registers, however that module states them.
 *
 * Two shapes, and a tool that reads bundles has to accept both:
 *
 *  - **`<NAME>_BUNDLE`**, an array built at import time. Every feature bundle
 *    is one, because it holds a handful of components a page either uses or
 *    does not.
 *  - **`load<Name>Bundle()`**, awaited. A bundle whose components load on
 *    demand cannot state them as an array without importing all of them,
 *    which is the cost it exists to avoid (AGL-3141) — so it states where
 *    each one comes from and resolves them when asked. `mui` is one: sixty
 *    elements, of which a published page places about nineteen.
 *
 * Both answer the same list of `{ component, schema, presets? }`, which is
 * what a generator reading the palette or rendering a page actually wants.
 */
export async function pluginBundleEntries(mod, file) {
  const array = Object.keys(mod).find((name) => name.endsWith('_BUNDLE'))
  if (array) return mod[array]
  const loader = Object.keys(mod).find((name) => /^load[A-Za-z]*Bundle$/.test(name))
  if (loader) return await mod[loader]()
  throw new Error(`${file} exports no *_BUNDLE and no load*Bundle()`)
}
