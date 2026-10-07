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

import { emitHostEvent } from '@aglyn/tenant-runtime'

/**
 * The host event bus, loaded with the first commerce event rather than at
 * boot (AGL-3611): `order-event-triggers.ts` registers from the server
 * declarations, and the runtime it reaches through this module is the
 * automation engine's door, which a boot does not need.
 */
export async function emitCommerceHostEvent(
  hostId: string,
  type: string,
  payload: Record<string, string | number | boolean>,
): Promise<void> {
  await emitHostEvent(hostId, type as never, payload, { actor: { kind: 'platform' } })
}
