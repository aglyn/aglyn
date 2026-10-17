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

import {
  describeActivity,
  humanizeActivityCode,
  isActivityCode,
} from '@aglyn/aglyn/app-utils/activity-labels'

/**
 * Each entry with the words the console's feeds show for it (AGL-3892):
 * `actionLabel`, the act as a sentence (`Duplicated a component`), and
 * `targetLabel`, what it was done to. The native apps read the feed through
 * this route and have no copy of the plugins' declared labels, so the route
 * says it once for every reader. A code no plugin named reads as words
 * (`Billing: invoice paid`), never as the code.
 */
export function withActivityLabels<T extends object>(
  entries: T[],
): Array<T & { actionLabel: string; targetLabel: string | null }> {
  return entries.map((entry) => {
    const described = describeActivity(entry as Parameters<typeof describeActivity>[0])
    const action = described.action
    const actionLabel = isActivityCode(action) ? humanizeActivityCode(action) : action
    return {
      ...entry,
      actionLabel,
      targetLabel: described.target === '—' ? null : described.target,
    }
  })
}
