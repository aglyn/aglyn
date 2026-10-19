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

import { registerDomainConnectDeclarations } from './server/domain-connect/declarations'

/**
 * Domains' console-server registrations (AGL-3962, AGL-3963): the lifecycle
 * sweep, its alerts and activity actions, and the platform events it hears.
 */
export function registerDomainsConsoleServerDeclarations(): void {
  registerDomainConnectDeclarations()
}
