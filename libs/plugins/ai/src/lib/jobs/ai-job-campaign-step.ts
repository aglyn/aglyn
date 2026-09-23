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

import { checkQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type {
  PluginDraftRecord,
  PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import type { AiJob, AiJobOutput } from '../model/ai-jobs.types'
import { aiModelForStep } from '../providers/routing'
import { readSiteInventory } from '../runtime/site-inventory'
import {
  aiCampaignAudienceNote,
  readAiListSendTime,
  resolveAiEmailProducts,
  suggestAiCampaignList,
} from './ai-email-bindings'
import { registerAiJobAdmission, type AiJobAdmission } from './ai-job-admission'
import { aiJobDraftId } from './ai-job-draft-ids'
import { aiSiteSubdomain } from './ai-job-drafts'
import {
  aiConfirmedPlan,
  aiDoctrineReview,
  aiGenerationSpent,
  aiLimitReview,
  aiUnspentOutcome,
} from './ai-job-generation'
import {
  AI_EMAIL_DESIGN_RESOURCE,
  AI_EMAIL_PLUGIN_ID,
  AI_EMAIL_SAVE_FAILURE_COPY,
  AI_JOB_EMAIL_STEP_BUDGETS,
  aiEmailDesignContent,
  aiEmailDesignOutput,
  aiJobInputName,
  generateAiEmail,
  type AiEmailCopy,
} from './ai-job-email-step'
import {
  aiPluginDraftAdmissionRefusal,
  aiPluginDraftWriter,
  type AiPluginDraftWriterLookup,
} from './ai-job-plugin-drafts'
import type { AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobStep } from './ai-jobs'

/**
 * The campaign step (AGL-2912): one brief becomes an email design AND the
 * draft campaign that would send it.
 *
 * A campaign is an unplanned kind — there is one thing to build and a plan
 * over it would be a plan of one — so the job runs this step alone, and the
 * design it writes is the email step's, generated through `generateAiEmail`
 * so both kinds obey the same doctrine and the same email rules.
 *
 * ## Nothing is sent, and nothing is aimed
 *
 * The campaign is written `draft`, with no audience, no schedule and no
 * sender: a draft campaign is not a queued one, the scheduled processor
 * queries `status == 'scheduled'`, and the send route is the only thing that
 * mails a campaign. Choosing WHO receives it stays a person's decision, so
 * the model is never shown the org's lists, its contacts or what past sends
 * did. Code reads the list the brief names and the send time that list's own
 * history suggests, AFTER the answer, and both reach the person as the
 * output's `note` — never the prompt.
 *
 * ## Where campaign email begins
 *
 * A site whose plan sends no campaign email can still generate email designs;
 * the campaign is the part that needs somewhere to send. So the step gates on
 * the same entitlement the composer and the send route read, and stops the
 * job for a person rather than failing it. The refusal names no plan, because
 * the billing page is the one place that does.
 *
 * ## Run again and it finds its drafts
 *
 * Each write is keyed by the id the job recorded for its draft when it was
 * created, so a run cut off between them finds what it wrote: two drafts are
 * reported, a design alone is drafted into a campaign from the copy the
 * design already stores, and neither spends.
 */

/** The id the marketing plugin is registered under. */
export const AI_CAMPAIGN_PLUGIN_ID = 'marketing'

/** The resource the marketing plugin writes a draft campaign under. */
export const AI_CAMPAIGN_RESOURCE = 'campaign'

/** A campaign's name when neither the job nor its subject lines give one. */
export const AI_JOB_CAMPAIGN_DEFAULT_NAME = 'New campaign'

/** A job's failure when the site has no campaign writer. */
export const AI_CAMPAIGN_UNAVAILABLE_COPY = 'Campaigns are not available on this site.'

/** A job's failure when a campaign whose email was written could not be drafted. */
export const AI_CAMPAIGN_SAVE_FAILURE_COPY =
  'The email was written but the campaign could not be drafted. Try the job again.'

/**
 * What a person is told when their plan sends no campaign email. It names the
 * page that sells the answer rather than a plan, so the one place plan names
 * are written stays the one place they are read.
 */
export const AI_CAMPAIGN_PLAN_REFUSAL =
  'Campaign email is not included on this workspace’s plan. ' +
  'Upgrade in Billing to send campaigns, or generate an email design on its own.'

/** Whether this workspace may send campaign email at all: the composer's and the send route's check. */
export function aiCampaignPlanAllows(org: object | null): boolean {
  return checkQuota(org as Partial<AglynOrgBilling> | null, 'emailSendsPerMonth', 0).allowed
}

/** The campaign as the job's output, carrying what the person still decides. */
export function aiCampaignOutput(
  record: PluginDraftRecord,
  place: { hostId: string; hostSubdomain: string | null },
  note: string | null,
): AiJobOutput {
  return {
    resource: 'campaign',
    id: record.id,
    versionId: null,
    hostId: place.hostId,
    hostSubdomain: place.hostSubdomain,
    label: record.name,
    ...(note ? { note } : {}),
  }
}

/** The subject lines and preheaders a written design already stores. */
export function aiCampaignCopyFromDesign(record: PluginDraftRecord): AiEmailCopy {
  const lines = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
  const subject = String(record.facts?.['subject'] ?? '')
  const preheader = String(record.facts?.['preheader'] ?? '')
  const subjects = lines(record.facts?.['subjectVariants'])
  const preheaders = lines(record.facts?.['preheaderVariants'])
  return {
    subjects: subjects.length ? subjects : subject ? [subject] : [],
    preheaders: preheaders.length ? preheaders : preheader ? [preheader] : [],
  }
}

/** The campaign's content: the design it sends, and the copy the send fills its headers from. */
export function aiCampaignDraftContent(
  designId: string,
  copy: AiEmailCopy,
): Record<string, unknown> {
  return {
    templateScreenId: designId,
    subject: copy.subjects[0] ?? '',
    preheader: copy.preheaders[0] ?? '',
    subjectVariants: copy.subjects,
    preheaderVariants: copy.preheaders,
  }
}

/** A campaign job's name: what the member asked for, else its strongest subject line. */
export function aiCampaignName(job: Pick<AiJob, 'inputs'>, copy: AiEmailCopy): string {
  return aiJobInputName(job) || copy.subjects[0] || AI_JOB_CAMPAIGN_DEFAULT_NAME
}

/**
 * A campaign job is admitted for a site of its org with email and marketing
 * on, room for a design and a campaign, and a plan that sends campaign email.
 */
export const aiCampaignJobAdmission: AiJobAdmission = (context) =>
  aiPluginDraftAdmissionRefusal(context, {
    kind: 'campaign',
    drafts: [
      { resource: AI_EMAIL_DESIGN_RESOURCE, pluginId: AI_EMAIL_PLUGIN_ID, label: 'Email' },
      { resource: AI_CAMPAIGN_RESOURCE, pluginId: AI_CAMPAIGN_PLUGIN_ID, label: 'Marketing' },
    ],
    ownCheck: async () =>
      aiCampaignPlanAllows(context.org)
        ? null
        : { status: 403, error: AI_CAMPAIGN_PLAN_REFUSAL },
  })

export interface AiJobCampaignStepDeps {
  /** The inventory reader; specs hand in a fake. */
  readInventory?: typeof readSiteInventory
  /** How a resource's draft writer is found; the core's registry otherwise. */
  writerFor?: AiPluginDraftWriterLookup
}

/** Both drafts, or the refusal that stands in for a writer the site has not got. */
function writers(
  writerFor: AiPluginDraftWriterLookup,
): { design: PluginResourceDraftWriter; campaign: PluginResourceDraftWriter } | string {
  const design = writerFor(AI_EMAIL_DESIGN_RESOURCE)
  const campaign = writerFor(AI_CAMPAIGN_RESOURCE)
  if (!design) return AI_CAMPAIGN_UNAVAILABLE_COPY
  if (!campaign) return AI_CAMPAIGN_UNAVAILABLE_COPY
  return { design, campaign }
}

export function createAiJobCampaignStep(deps: AiJobCampaignStepDeps = {}): AiJobStepRunner {
  const readInventory = deps.readInventory ?? readSiteInventory
  const writerFor = deps.writerFor ?? aiPluginDraftWriter
  return async ({ job, now, signal, firestore, modelFor }): Promise<AiJobStepOutcome> => {
    const hostId = job.hostId
    if (!hostId) throw new Error('a campaign job names no site, and its admission refuses one')
    // The switch's answer for this job, else the routing table's (AGL-2942).
    const model = modelFor?.('job.campaign') ?? aiModelForStep('job.campaign')
    const found = writers(writerFor)
    if (typeof found === 'string') return { ...aiUnspentOutcome(model), failure: found }
    const { design, campaign } = found

    // What an earlier run of this same job already wrote, under the ids the job recorded.
    const designId = aiJobDraftId(job, 'email')
    const [writtenDesign, writtenCampaign, hostSubdomain] = await Promise.all([
      design.read({ hostId, id: designId }),
      campaign.read({ hostId, id: aiJobDraftId(job, 'campaign') }),
      aiSiteSubdomain(firestore, hostId),
    ])
    const place = { hostId, hostSubdomain }
    if (writtenDesign && writtenCampaign) {
      return aiUnspentOutcome(model, {
        outputs: [
          aiEmailDesignOutput(writtenDesign, place, null),
          aiCampaignOutput(writtenCampaign, place, null),
        ],
      })
    }

    const orgSnapshot = await firestore.collection('orgs').doc(job.orgId).get()
    const org = (orgSnapshot.data() ?? null) as Record<string, unknown> | null
    // Asked again here because a plan can change between admission and the run.
    if (!aiCampaignPlanAllows(org)) {
      return aiUnspentOutcome(model, { review: aiLimitReview(AI_CAMPAIGN_PLAN_REFUSAL) })
    }
    const context = { orgId: job.orgId, hostId, uid: job.createdBy, org, now }

    // Who it is for and when to send it: read from the site, told to the
    // person, and never sent to the model.
    const list = await suggestAiCampaignList({ hostId, brief: job.brief })
    const sendTime = list ? await readAiListSendTime(firestore, { orgId: job.orgId, hostId, listId: list.id }) : null
    const note = aiCampaignAudienceNote(list, sendTime)

    // A design an earlier run wrote is drafted into its campaign, unspent.
    if (writtenDesign) {
      return draftCampaign({
        campaign,
        context,
        job,
        copy: aiCampaignCopyFromDesign(writtenDesign),
        designId: writtenDesign.id,
        spent: aiUnspentOutcome(model),
        outputs: [aiEmailDesignOutput(writtenDesign, place, null)],
        place,
        note,
      })
    }

    const [inventory, products] = await Promise.all([
      readInventory(job.orgId, hostId, { firestore }),
      resolveAiEmailProducts(firestore, { hostId, brief: job.brief, inputs: job.inputs }),
    ])
    const refusal = await design.refusal(context)
    if (refusal) {
      return refusal.status === 403
        ? aiUnspentOutcome(model, { review: aiLimitReview(refusal.error) })
        : { ...aiUnspentOutcome(model), failure: refusal.error }
    }

    const asked = aiJobInputName(job)
    const generated = await generateAiEmail({
      job,
      step: 'job.campaign',
      model,
      heading: asked ? `Campaign name: ${asked}` : null,
      plan: aiConfirmedPlan(job),
      inventory,
      hostId,
      products,
      design,
      ...(signal ? { signal } : {}),
    })
    const { result } = generated
    const spent = aiGenerationSpent(result)
    if (result.status === 'refused') return { ...spent, refused: true }
    if (result.status === 'needs_input') return { ...spent, review: aiDoctrineReview(result) }
    if (!generated.copy || !generated.nodes) return { ...spent, failure: AI_EMAIL_SAVE_FAILURE_COPY }

    const { copy } = generated
    const name = aiCampaignName(job, copy)
    const write = await design.write({
      ...context,
      id: designId,
      name,
      content: aiEmailDesignContent(generated.nodes, copy),
    })
    if (write.ok === false) {
      return write.status === 403
        ? { ...spent, review: aiLimitReview(write.error) }
        : { ...spent, failure: AI_EMAIL_SAVE_FAILURE_COPY }
    }
    return draftCampaign({
      campaign,
      context,
      job,
      copy,
      designId: write.id,
      spent,
      outputs: [aiEmailDesignOutput(write, place, null)],
      place,
      note,
    })
  }
}

interface AiCampaignDraftInput {
  campaign: PluginResourceDraftWriter
  context: { orgId: string; hostId: string; uid: string; org: Record<string, unknown> | null; now: Date }
  job: AiJob
  copy: AiEmailCopy
  designId: string
  /** What the generation cost, or an unspent outcome for a run that reached no model. */
  spent: Pick<AiJobStepOutcome, 'outputs' | 'usage' | 'estCostUsd' | 'model' | 'stopReason'>
  /** The design's output, reported beside the campaign once it is drafted. */
  outputs: AiJobOutput[]
  place: { hostId: string; hostSubdomain: string | null }
  note: string
}

/**
 * Drafts the campaign around a design that exists. A campaign that cannot be
 * drafted reports NO outputs: the design on its own is not what the job was
 * asked for, and a run that names it would read as finished.
 */
async function draftCampaign(input: AiCampaignDraftInput): Promise<AiJobStepOutcome> {
  const write = await input.campaign.write({
    ...input.context,
    id: aiJobDraftId(input.job, 'campaign'),
    name: aiCampaignName(input.job, input.copy),
    content: aiCampaignDraftContent(input.designId, input.copy),
  })
  if (write.ok === false) {
    return write.status === 403
      ? { ...input.spent, review: aiLimitReview(write.error) }
      : { ...input.spent, failure: AI_CAMPAIGN_SAVE_FAILURE_COPY }
  }
  return {
    ...input.spent,
    outputs: [...input.outputs, aiCampaignOutput(write, input.place, input.note)],
  }
}

export const runAiJobCampaignStep = createAiJobCampaignStep()

/**
 * The least time one campaign step needs before it starts (AGL-3035): the
 * email generation it drafts the campaign's design with, on the campaign's own
 * routing row. Writing the draft campaign asks no model.
 */
export const AI_JOB_CAMPAIGN_STEP_MINIMUM_MS = AI_JOB_EMAIL_STEP_BUDGETS['job.campaign'].minimumMs

/** Registers the campaign step and the check a campaign job passes before it is created or resumed. */
export function registerAiCampaignJob(): void {
  registerAiJobStep('campaign', runAiJobCampaignStep, { minimumMs: AI_JOB_CAMPAIGN_STEP_MINIMUM_MS })
  registerAiJobAdmission('campaign', aiCampaignJobAdmission)
}
