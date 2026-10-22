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

// The route table moved to `@aglyn/aglyn/app-utils/console-routes` (AGL-685).
// It lived here, inside the console app, which meant plugin libs physically
// could not reach it — so every console link a plugin emitted (Stripe return
// URLs, notification payloads, console cards) was hand-assembled, and each
// went dead at AGL-621/622 without anything failing to compile. The table is
// a dependency-free string module, so a lib is the correct home for it.
//
// This file stays as the console's import path so the ~60 existing
// `constants/route-links` imports are untouched.
export {
  buildRoute,
  Route,
  routeReplacePattern,
  type RoutePayload,
} from '@aglyn/aglyn/app-utils/console-routes'
