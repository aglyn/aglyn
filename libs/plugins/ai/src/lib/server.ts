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

import { registerPluginApiRoute } from '@aglyn/aglyn/server'
import { registerAiDeclarations } from './declarations'
// Registers the jobs beat at module scope (AGL-2904, AGL-435).
import './jobs/ai-jobs-beat'
import { ensureFirstPartyAiProviders } from './providers/registry'
import { aiAssistHandler } from './server/ai-assist'
import { POST as cancelAiJob } from './server/ai-jobs-cancel'
import { GET as aiJobEvents } from './server/ai-jobs-events-route'
import { GET as listAiJobs, POST as createAiJob } from './server/ai-jobs-route'
import { POST as assistChat } from './server/assist-chat'
import { POST as assistFeedback } from './server/assist-feedback'
import { GET as aiUsage } from './server/ai-usage'
import { GET as billingCredits } from './server/billing-credits'
import { POST as billingOverage } from './server/billing-overage'

export * from './providers/contract'
export * from './providers/catalog'
export * from './providers/registry'
export * from './providers/routing'
export * from './runtime/ai-runtime'

/**
 * The two first-party adapters, registered once per process. A marketplace
 * plugin registers its own against `AI_PROVIDER_CONTRACT` from its own
 * entry and never touches this.
 */
const registerFirstPartyProviders = ensureFirstPartyAiProviders

/**
 * The console-side API (AGL-2939): every AI door, under the `ai` and
 * `assist` prefixes the plugin owns. The URLs the panel and the besigner
 * call are unchanged — `/api/assist/chat`, `/api/ai/assist`,
 * `/api/ai/jobs` — because the dispatcher serves them from the registry
 * exactly where the named routes used to; the two billing doors and the
 * per-member usage read (`ai/usage`) live under the plugin's own prefix.
 */
export function registerAiConsoleApi(): void {
  registerAiDeclarations()
  registerFirstPartyProviders()
  registerPluginApiRoute('assist/chat', { web: assistChat })
  registerPluginApiRoute('assist/feedback', { web: assistFeedback })
  registerPluginApiRoute('ai/assist', aiAssistHandler)
  registerPluginApiRoute('ai/jobs', {
    web: (request) => (request.method === 'GET' ? listAiJobs(request) : createAiJob(request)),
  })
  registerPluginApiRoute('ai/jobs/:jobId/cancel', {
    web: (request, context) =>
      cancelAiJob(request, { params: Promise.resolve({ jobId: String(context.params['jobId']) }) }),
  })
  registerPluginApiRoute('ai/jobs/:jobId/events', {
    web: (request, context) =>
      aiJobEvents(request, { params: Promise.resolve({ jobId: String(context.params['jobId']) }) }),
  })
  registerPluginApiRoute('ai/billing/credits', { web: billingCredits })
  registerPluginApiRoute('ai/billing/overage', { web: billingOverage })
  registerPluginApiRoute('ai/usage', { web: aiUsage })
}

/**
 * The tenant-side surface (AGL-2939): the jobs beat, which the module
 * import above registers, and the providers the sweep runs steps on.
 */
export function registerAiApi(): void {
  registerAiDeclarations()
  registerFirstPartyProviders()
}
