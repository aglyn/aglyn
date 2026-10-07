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

import { SCREEN_ROOT_PATH } from '@aglyn/aglyn/app-utils/screen-route'

/**
 * Whether a request is for the holding page (AGL-3594): the root of a site
 * whose routing map serves no page at all.
 *
 * A site born for the guided AI start has no page until its home is published
 * or the starter is added, and its root used to be the tenant's 404 — what
 * every new site answered before AGL-3408. Only the root, and only while the
 * map is empty: a site with any routed page answers an unmatched root, or any
 * other unmatched path, with the 404 as it always has.
 */
export function isHoldingPageRequest(
  path: string,
  pathsByScreenId: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  if (path !== SCREEN_ROOT_PATH) return false
  return !Object.values(pathsByScreenId ?? {}).some((value) => typeof value === 'string' && value)
}
