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
// The sequence engine (AGL-2979): validation, gates, scheduling, composition,
// reply and bounce classification, mailbox health. The do-not-contact key
// hashes with `node:crypto` and is imported by its own path instead:
// `@aglyn/plugins-outreach/engine/do-not-contact`.
export * from './lib/engine'
