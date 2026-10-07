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

import type { MobileScreenProps } from '@aglyn/mobile-plugin-host'
import { EmptyState } from '@aglyn/mobile-ui'
import { libraryFor } from './library-access'
import { MediaDetail } from './media-detail'

/** One asset pushed on its own (phones): `params.mediaId` in `params.library`/`params.scopeId`. */
export default function MediaItemScreen({ params, context }: MobileScreenProps) {
  const library = libraryFor(params, context)
  const mediaId = params['mediaId']
  if (!library || !mediaId) return <EmptyState icon="image-outline" title="This file could not be opened" />
  return <MediaDetail library={library} mediaId={mediaId} context={context} />
}
