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
'use client'

import type { ConsoleStaffPageProps } from '@aglyn/aglyn'
import PluginReviewDetail from './plugin-review-detail.component'
import PluginReviewsQueue from './plugin-reviews-queue.component'

/**
 * The review queue, or one submission of it (AGL-3080).
 *
 * The shell hands a staff page its `segments`; which page this is depends on
 * whether there are any. Held here rather than in either component so both
 * stay about their own job — a list that knew about detail routing, or a
 * detail page that rendered a list, is the coupling `ownsSubtree` exists to
 * avoid making necessary.
 *
 * Only reachable with segments because the `staffPages` entry declared
 * `ownsSubtree`; without that the shell 404s a deeper path before this
 * renders, so there is no branch here for a page that never claimed one.
 */
export function PluginReviewsSurface(props: ConsoleStaffPageProps) {
  return props.segments?.length ? (
    <PluginReviewDetail
      basePath={props.basePath}
      segments={props.segments}
      staffRole={props.staffRole}
      staffPaths={props.staffPaths}
    />
  ) : (
    <PluginReviewsQueue basePath={props.basePath} />
  )
}

PluginReviewsSurface.displayName = 'PluginReviewsSurface'

export default PluginReviewsSurface
