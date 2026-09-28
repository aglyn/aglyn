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

import type {
  OperatorAlertResult,
  RaiseOperatorAlertOptions,
} from '@aglyn/tenant-data-admin/server/operator-alerts'

/**
 * `raiseOperatorAlert` for a console route's failure branch (AGL-3377),
 * loaded on first use: a sweep that finds nothing wrong never loads the alert
 * pipeline, and a route's own suite mocks nothing it does not exercise.
 * Never throws — the failure being reported is the one that matters.
 */
export async function raiseConsoleOperatorAlert(
  type: string,
  options: RaiseOperatorAlertOptions = {},
): Promise<OperatorAlertResult | null> {
  try {
    const { raiseOperatorAlert } = await import(
      '@aglyn/tenant-data-admin/server/operator-alerts'
    )
    return await raiseOperatorAlert(type, options)
  } catch (error) {
    console.error(`[operator-alerts] ${type} could not be raised`, error)
    return null
  }
}
