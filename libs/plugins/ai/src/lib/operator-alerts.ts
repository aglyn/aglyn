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

import type { OperatorAlertDefinition } from '@aglyn/aglyn/app-utils/operator-alerts'
import { AI_PLUGIN_ID } from './constants'

/**
 * The AI plugin's operator alert (AGL-3377): the platform's provider account
 * refused its key or ran out of credit, so every AI feature on the install
 * fails. Provider-generic — each adapter classifies its own vendor's answer
 * as an `accountProblem`, and the runtime raises this with the provider's
 * label — so a self-hoster on any provider hears the same thing.
 */
export const AI_PROVIDER_UNAVAILABLE: OperatorAlertDefinition = {
  type: 'ai.providerUnavailable',
  pluginId: AI_PLUGIN_ID,
  label: 'Platform AI provider unavailable',
  description:
    'The platform’s AI provider refused its key or ran out of credit, so every AI feature on the install is failing until the key or the balance is fixed.',
  tier: 'should',
  category: 'ops',
  title: '{{provider}} is refusing requests',
  body:
    'The platform’s {{provider}} account refused a request because {{reason}}. AI features fail until it is fixed ({{keyEnv}}).',
  delivery: 'immediate',
  dedupeWindowMinutes: 6 * 60,
  defaultEnabled: true,
}
