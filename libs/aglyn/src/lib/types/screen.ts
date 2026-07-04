/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import type {
  AglynLayoutVersion as AglynLayoutVersionBase,
  AglynScreenVersion as AglynScreenVersionBase,
} from '../foundation/definitions/workspace.types'
import type { NodeSchema } from './nodes'

export type {
  AglynLayout,
  AglynScreen,
  LayoutUid,
  ScreenSlug,
  ScreenUid,
  VersionUid,
} from '../foundation'

/** Hosted in tenants' host project */
export type AglynScreenVersion = AglynScreenVersionBase<NodeSchema>

/** CONCEPT: Shared layouts. Hosted in tenants' host project */
export type AglynLayoutVersion = AglynLayoutVersionBase<NodeSchema>
