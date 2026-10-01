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

import type { PluginUsageAxesDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-usage-axes'

/**
 * THE WORKFLOWS PLUGIN'S METERS (AGL-3080): workflow and action runs, in the
 * platform's cost model and utilization table. Compiled into core by the
 * manifest generator (`register.usageAxes`).
 *
 * ONE cost axis for both counters: a run is the same handful of reads, two
 * writes and a moment of compute whichever builder produced it, so both are
 * priced at `perRun` on one line. TWO bands, because each builder sells its
 * own.
 */
export function workflowsUsageAxes(): PluginUsageAxesDeclaration {
  return {
    costAxes: [
      {
        id: 'runs',
        order: 90,
        fields: ['workflowRuns', 'actionRuns'],
        rate: 'perRun',
      },
    ],
    bands: [
      {
        id: 'workflowRuns',
        label: 'Workflow runs',
        order: 100,
        fields: ['workflowRuns'],
        entitlement: 'workflowRunsPerMonth',
      },
      {
        id: 'actionRuns',
        label: 'Action runs',
        order: 110,
        fields: ['actionRuns'],
        entitlement: 'actionRunsPerMonth',
      },
    ],
  }
}
