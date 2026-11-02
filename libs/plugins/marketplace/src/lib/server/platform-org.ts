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
 * The platform's own org, from the one place that may say so (AGL-4049): a
 * server-side env marker, trimmed, or `null` when this deployment names none.
 * Read per call, so the marker takes effect with the deployment that carries
 * it and a spec can set it.
 */
export function readPlatformOrgId(): string | null {
  const value = process.env['AGLYN_PLATFORM_ORG_ID']?.trim()
  return value ? value : null
}
