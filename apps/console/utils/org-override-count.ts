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

/**
 * Count of explicit overrides on an org doc, for the row chip. A staff plan
 * comp rides the same map (AGL-3034) and is not counted: it is a plan, shown
 * beside the plan, not one more quota.
 *
 * Here rather than beside the staff row's actions, so the route that serves
 * the Organizations list and the grid that draws it count alike (AGL-3667).
 */
export const overrideCount = (org: any): number =>
  Object.keys(org?.entitlements ?? {}).filter(
    (key) => key !== 'features' && key !== 'planComp',
  ).length +
  Object.keys(org?.entitlements?.features ?? {}).length +
  Object.keys(org?.releaseFlags ?? {}).length
