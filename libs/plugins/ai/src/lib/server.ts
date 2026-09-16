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
import { AI_JOBS_BEAT_PATH } from './jobs/ai-jobs-beat'
import { registerAiJobPlan } from './jobs/ai-job-plan-step'
import { registerAiComponentJob } from './jobs/ai-job-component-step'
import { registerAiLayoutJob } from './jobs/ai-job-layout-step'
import { registerAiTemplateJob } from './jobs/ai-job-template-step'
import { registerAiFormJob } from './jobs/ai-job-form-step'
import { registerAiPageJob } from './jobs/ai-job-page-step'
import { registerAiEmailJob } from './jobs/ai-job-email-step'
import { registerAiCampaignJob } from './jobs/ai-job-campaign-step'
import { registerAiSiteJob } from './jobs/ai-job-site-step'
import { ensureFirstPartyAiProviders } from './providers/registry'
import { aiAssistHandler } from './server/ai-assist'
import { POST as runAiJobsBeat } from './server/ai-jobs-beat-route'
import { POST as cancelAiJob } from './server/ai-jobs-cancel'
import { GET as aiJobEvents } from './server/ai-jobs-events-route'
import { POST as createAiSiteBatch } from './server/ai-jobs-batch'
import { GET as listAiJobs, POST as createAiJob } from './server/ai-jobs-route'
import { POST as resumeAiJob } from './server/ai-jobs-resume'
import { POST as aiGenerateComponent } from './server/ai-generate-component'
import { POST as applyAiSeoAudit } from './server/ai-seo-apply'
import { POST as assistChat } from './server/assist-chat'
import { POST as assistEditApplied } from './server/assist-edit-applied'
import { POST as assistFeedback } from './server/assist-feedback'
import { PATCH as aiHostPermissions } from './server/ai-host-permissions'
import { GET as aiAdminOrg } from './server/ai-admin-org'
import { GET as aiAdminOrgsSpend } from './server/ai-admin-orgs-spend'
import { GET as aiAdminSignals } from './server/ai-admin-signals'
import { GET as aiAdminUser } from './server/ai-admin-user'
import { POST as aiAdminOverage } from './server/ai-admin-overage'
import { GET as aiUsage } from './server/ai-usage'
import { GET as aiAllotments } from './server/ai-allotments'
import { GET as aiModels } from './server/ai-models'
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
 * Every job kind this plugin runs beyond the three the machine registers
 * itself (AGL-3025). Each is a CALL, never an import made for what the
 * module does as it loads: this package declares only this file
 * effect-ful, so a bundler honoring `sideEffects` deletes an import whose
 * exports go unused — and a step registered that way ran in every spec and
 * in neither app. `registrations-survive-a-bundler.spec.ts` holds this.
 *
 * The console surface is the only caller (AGL-3026): its doors run a job's
 * first step inline, and its beat runs every step after it. The tenant app
 * loads no server surface of this plugin at all, so nothing that serves a
 * published site can reach a provider.
 */
function registerAiJobKinds(): void {
  // The plan step every planned kind runs first (AGL-2935).
  registerAiJobPlan()
  // Components, layouts and templates (AGL-2908, AGL-2909).
  registerAiComponentJob()
  registerAiLayoutJob()
  registerAiTemplateJob()
  // Forms (AGL-2913).
  registerAiFormJob()
  // Pages, with the least time one pass needs (AGL-2907).
  registerAiPageJob()
  // Email designs and campaigns, whose drafts the email and marketing
  // plugins write on the resource-draft seam (AGL-2912).
  registerAiEmailJob()
  registerAiCampaignJob()
  // The site scaffold, which builds a whole site through the steps above
  // (AGL-2911).
  registerAiSiteJob()
}

/**
 * The console-side API (AGL-2939): every AI door, under the `ai` and
 * `assist` prefixes the plugin owns. The URLs the panel and the besigner
 * call are unchanged — `/api/assist/chat`, `/api/ai/assist`,
 * `/api/ai/jobs` — because the dispatcher serves them from the registry
 * exactly where the named routes used to; the two billing doors and the
 * per-member usage read (`ai/usage`) live under the plugin's own prefix.
 * The jobs beat is the one path outside them, for the reason
 * `AI_JOBS_BEAT_PATH` gives.
 */
export function registerAiConsoleApi(): void {
  registerAiDeclarations()
  registerFirstPartyProviders()
  registerAiJobKinds()
  registerPluginApiRoute('assist/chat', { web: assistChat })
  registerPluginApiRoute('assist/feedback', { web: assistFeedback })
  // The applied-edit record (AGL-2906): counts of a proposal the author
  // applied in their editor, written to the site's activity log.
  registerPluginApiRoute('assist/edit-applied', { web: assistEditApplied })
  // A collaborator's AI toggles on one site (AGL-2927), set from the site's
  // collaborators card through this plugin's column there.
  registerPluginApiRoute('ai/host-permissions', { web: aiHostPermissions })
  registerPluginApiRoute('ai/assist', aiAssistHandler)
  registerPluginApiRoute('ai/jobs', {
    web: (request) => (request.method === 'GET' ? listAiJobs(request) : createAiJob(request)),
  })
  // The agency batch (AGL-2911): one brief, one `site` job per named site,
  // under one batch id. Before the `:jobId` routes, which it is not one of.
  registerPluginApiRoute('ai/jobs/batch', { web: createAiSiteBatch })
  registerPluginApiRoute('ai/jobs/:jobId/cancel', {
    web: (request, context) =>
      cancelAiJob(request, { params: Promise.resolve({ jobId: String(context.params['jobId']) }) }),
  })
  registerPluginApiRoute('ai/jobs/:jobId/resume', {
    web: (request, context) =>
      resumeAiJob(request, { params: Promise.resolve({ jobId: String(context.params['jobId']) }) }),
  })
  registerPluginApiRoute('ai/jobs/:jobId/events', {
    web: (request, context) =>
      aiJobEvents(request, { params: Promise.resolve({ jobId: String(context.params['jobId']) }) }),
  })
  // The jobs beat (AGL-3026): every step the doors leave queued, run every
  // minute by the console's scheduler on the cron secret, on the one surface
  // that holds the provider's key.
  registerPluginApiRoute(AI_JOBS_BEAT_PATH, { web: runAiJobsBeat })
  // A site SEO audit's "Apply all" (AGL-2910): content fixes as new
  // unpublished versions, listing values staged for their SEO cards.
  registerPluginApiRoute('ai/seo/apply', { web: applyAiSeoAudit })
  // Save the selection as a reusable component, with AI (AGL-2908): the
  // second entry point of the component job, from the besigner's Attributes
  // panel. It proposes, and the person's Apply writes.
  registerPluginApiRoute('ai/generate/component', { web: aiGenerateComponent })
  registerPluginApiRoute('ai/billing/credits', { web: billingCredits })
  registerPluginApiRoute('ai/billing/overage', { web: billingOverage })
  registerPluginApiRoute('ai/usage', { web: aiUsage })
  // The allotments a manager sets, and the options the model switch lists
  // (AGL-2942). One handler answers the allotments' GET and POST.
  registerPluginApiRoute('ai/allotments', { web: aiAllotments })
  registerPluginApiRoute('ai/models', { web: aiModels })
  // The staff doors (AGL-2928, AGL-2930, AGL-2252): one org's AI in full,
  // one account's usage across its workspaces, and the fleet's Assist
  // signals behind the Assist signal staff page.
  registerPluginApiRoute('ai/admin/org', { web: aiAdminOrg })
  registerPluginApiRoute('ai/admin/orgs-spend', { web: aiAdminOrgsSpend })
  registerPluginApiRoute('ai/admin/user', { web: aiAdminUser })
  registerPluginApiRoute('ai/admin/signals', { web: aiAdminSignals })
  // One workspace's overage standing and the four acts staff have over it
  // (AGL-3011): the ceiling override, lifting a pause — the only way a
  // dispute pause comes off — and resetting the step. Every act audited.
  registerPluginApiRoute('ai/admin/overage', { web: aiAdminOverage })
}
