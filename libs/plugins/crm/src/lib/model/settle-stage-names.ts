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

import type { CrmDealStage } from '@aglyn/aglyn'

/**
 * The stages as they are stored: every name trimmed, as a save writes them.
 *
 * Its own module because only the stage editor needs it, and everything in
 * `deal-board-model` that a lazy surface reaches for is paid by every console
 * page that loads the plugin.
 */
export function settleStageNames(stages: readonly CrmDealStage[]): CrmDealStage[] {
  return stages.map((stage) => ({ ...stage, name: stage.name.trim() }))
}
