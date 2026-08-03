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
 * `…/layouts/list` is the old home of the layout list; it now lives at the
 * bare `…/layouts`, matching components and screens.
 *
 * An alias rather than a redirect — see the sibling `screens/list/page.tsx`
 * for the full reasoning. Short version: the bare path answered a cached
 * **308** pointing here, so redirecting back would strand those browsers in
 * a redirect loop.
 *
 * Layouts is the milder case of the two: the bare path only started
 * redirecting yesterday (AGL-1174) and that fix never reached production, so
 * few browsers can hold the stale 308. Matching the screens treatment anyway
 * — an alias costs nothing and does not require being right about how far a
 * fix spread.
 *
 * The title comes from `../layout.tsx`, which wraps this segment too.
 */
export { default } from '../page'
