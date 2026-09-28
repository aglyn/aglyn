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

import type { HostEventActor } from './host-event-listeners'

/** The capture sources in which the person captured is the one acting. */
const SELF_CAPTURE_SOURCES = new Set(['form', 'member', 'order', 'booking', 'newsletter'])

/**
 * Who a capture's `contactCreated` names as its cause (AGL-3376): the door's
 * own word when it gave one; otherwise the visitor themselves on a door where
 * the person captured is the one acting — a form, a sign-up, a purchase, a
 * booking. A door a member or a key drives (`manual`, `import`, `api`) passes
 * its actor, and one that does not is left unrecorded rather than guessed.
 */
export function contactCaptureActor(
  source: string | null | undefined,
  email: string | null | undefined,
  explicit?: HostEventActor,
): HostEventActor | undefined {
  if (explicit?.kind) return explicit
  if (!SELF_CAPTURE_SOURCES.has(String(source ?? ''))) return undefined
  return { kind: 'visitor', ...(email ? { email } : {}) }
}
