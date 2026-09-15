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

export * from './lib/constants/api-routes'
export * from './lib/constants/bundle-common'
export * from './lib/plugin'
export * from './lib/components/outreach-console-sections'
// The document model both halves share (AGL-2974): collection names and the
// mailbox, sequence, enrollment and credential shapes.
export * from './lib/model/outreach.types'
// A mailbox's settings rules — cap, ramp, window, health — and the mailbox
// routes' contract (AGL-2978). Client-safe; the routes themselves are server-only.
export * from './lib/mailboxes/mailbox-settings'
export * from './lib/mailboxes/mailbox-api'
