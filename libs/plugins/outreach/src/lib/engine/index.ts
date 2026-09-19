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

/*
 * The Outreach engine (AGL-2979): pure decisions, no I/O, safe for the
 * console and the server alike. `./do-not-contact` is deliberately absent —
 * it hashes with `node:crypto` — and is imported by its own path.
 */
export * from './sequence-validation'
export * from './recipient-country'
export * from './gates'
export * from './schedule'
export * from './sending-capacity'
export * from './enrollment-state'
export * from './compose'
export * from './thread-message'
export * from './delivery-status'
export * from './opt-out-intent'
export * from './thread-classification'
export * from './mailbox-health'
