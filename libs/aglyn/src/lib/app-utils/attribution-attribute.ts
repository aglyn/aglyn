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
 * The attribute that marks an element the attribution guard keeps visible.
 *
 * A module of its own so the PAGE can name the attribute without taking the
 * guard with it (AGL-2706). The page renderer marks the credit badge and the
 * abuse-report control with this on every render; the guard that repairs
 * them runs from an effect, on the minority of sites that show them, and
 * arrives through a dynamic `import()`.
 *
 * Splitting the constant out and leaving the guard statically imported was
 * measured and came back HEAVIER — both modules shipped, plus a second
 * module's overhead. It is the pair of changes that pays: the constant here,
 * and `attribution-guard.component.tsx` reaching the installer lazily.
 *
 * `attribution-guard.ts` re-exports this, so `@aglyn/aglyn/server` still
 * offers the whole surface under one name.
 */
export const ATTRIBUTION_ATTRIBUTE = 'data-aglyn-attribution'
