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

// The contract from its own module, not the plugin-manager barrel: boot needs
// the registry and nothing else, and the barrel reaches the client contexts.
import { registerPluginConsentGroupParticipant } from '@aglyn/aglyn/plugin-manager/plugin-consent-group-change'
import {
  registerPluginContactCaptureWriter,
  type PluginContactCaptureWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import { registerPluginLeadConversionListener } from '@aglyn/aglyn/plugin-manager/plugin-lead-conversion'
import { registerPluginPersonMatcher } from '@aglyn/aglyn/plugin-manager/plugin-person-matches'
import {
  registerPluginPersonRecords,
  type PluginPersonRecords,
} from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import {
  registerPluginRecordIndex,
  type PluginRecordIndex,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { registerPluginRecordEmailStateWriter } from '@aglyn/aglyn/plugin-manager/plugin-record-email-state'
import { registerPluginRecordOriginWriter } from '@aglyn/aglyn/plugin-manager/plugin-record-origin'
import {
  registerPluginRecordTimelineWriter,
  type PluginRecordTimelineWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import { registerPluginRecordWrittenListener } from '@aglyn/aglyn/plugin-manager/plugin-record-written'
import { registerServerStepExecutor } from '@aglyn/aglyn/plugin-manager/plugin-server-steps'
import { registerPluginUsageMeter } from '@aglyn/aglyn/plugin-manager/plugin-usage-meters'
import { BUNDLE_ID, CRM_RECORDS_METER_ID, CRM_STEP_TYPES } from './constants/bundle-common'
import { summarizeConsentGroupChange } from './model/consent-group-summary'

/**
 * The CRM as the plugin that keeps people.
 *
 * Light by construction, the way the workflows listener is: the capture
 * itself is imported when the first one arrives, not when the process
 * starts, so a process that never captures anybody pays for this object and
 * nothing else. That matters because this registers in EVERY server process,
 * including ones that will never touch the CRM.
 */
export const crmContactCaptureWriter: PluginContactCaptureWriter = {
  async capture(request) {
    const { captureContactForCrm } = await import('./server/capture-contact')
    return await captureContactForCrm(request)
  },
}

/**
 * The CRM as the plugin other plugins ask for people (AGL-3080), deferred
 * like the capture: `server/person-records.ts` and the Admin SDK it brings
 * load with the first question, not when the process starts.
 */
export const crmPersonRecordsService: PluginPersonRecords = {
  async find(request) {
    const { crmPersonRecords } = await import('./server/person-records')
    return crmPersonRecords.find(request)
  },
  async read(request) {
    const { crmPersonRecords } = await import('./server/person-records')
    return crmPersonRecords.read(request)
  },
  async fileUnder(request) {
    const { crmPersonRecords } = await import('./server/person-records')
    return crmPersonRecords.fileUnder(request)
  },
  async recordRefund(request) {
    const { crmPersonRecords } = await import('./server/person-records')
    return crmPersonRecords.recordRefund(request)
  },
  async peopleInView(request) {
    const { crmPersonRecords } = await import('./server/person-records')
    return crmPersonRecords.peopleInView(request)
  },
  async wroteIn(request) {
    const { crmPersonRecords } = await import('./server/person-records')
    return crmPersonRecords.wroteIn(request)
  },
}

/**
 * The `pipeline` record index, its reads loaded with the first one — see
 * `server/pipeline-record-index.ts` for what it answers.
 */
export const crmPipelineRecordIndex: PluginRecordIndex = {
  async list(request) {
    const { pipelineRecordIndex } = await import('./server/pipeline-record-index')
    return pipelineRecordIndex.list(request)
  },
  async get(request) {
    const { pipelineRecordIndex } = await import('./server/pipeline-record-index')
    return pipelineRecordIndex.get(request)
  },
}

/** One of `server/crm-record-indexes.ts`'s indexes, its reads loaded with the first one. */
function lazyCrmRecordIndex(kind: 'company' | 'messageTemplate'): PluginRecordIndex {
  return {
    async list(request) {
      const { crmRecordIndexes } = await import('./server/crm-record-indexes')
      return crmRecordIndexes()[kind].list(request)
    },
    async get(request) {
      const { crmRecordIndexes } = await import('./server/crm-record-indexes')
      return crmRecordIndexes()[kind].get(request)
    },
  }
}

/** The companies a person works for, as another plugin reads them (AGL-3080). */
export const crmCompanyRecordIndex = lazyCrmRecordIndex('company')

/** The email templates and snippets reps write, as another plugin reads them (AGL-3080). */
export const crmMessageTemplateRecordIndex = lazyCrmRecordIndex('messageTemplate')

/**
 * The CRM's writer on the record-timeline seam (AGL-2981), deferred: the
 * writer and the Admin SDK it brings load with the first entry filed.
 */
export const crmRecordTimelineWriter: PluginRecordTimelineWriter = {
  async logActivity(request) {
    const { createCrmRecordTimelineWriter, defaultCrmRecordTimelineDeps } =
      await import('./server/record-timeline')
    return createCrmRecordTimelineWriter(defaultCrmRecordTimelineDeps()).logActivity(request)
  },
  async createTask(request) {
    const { createCrmRecordTimelineWriter, defaultCrmRecordTimelineDeps } =
      await import('./server/record-timeline')
    return createCrmRecordTimelineWriter(defaultCrmRecordTimelineDeps()).createTask(request)
  },
  async recordEmailDelivery(request) {
    const { createCrmRecordTimelineWriter, defaultCrmRecordTimelineDeps } =
      await import('./server/record-timeline')
    return createCrmRecordTimelineWriter(defaultCrmRecordTimelineDeps()).recordEmailDelivery!(request)
  },
  // A delivery event for a message the CRM tagged (AGL-2615, AGL-3080).
  async recordTaggedDelivery(request) {
    const { createCrmRecordTimelineWriter, defaultCrmRecordTimelineDeps } =
      await import('./server/record-timeline')
    return createCrmRecordTimelineWriter(defaultCrmRecordTimelineDeps()).recordTaggedDelivery!(request)
  },
  // An automation's email to the person its event is about, filed on that
  // person's timeline with its delivery state (AGL-2615, AGL-3080).
  async prepareEmail(request) {
    const { prepareCrmRecordEmail } = await import('./server/automation-steps')
    return prepareCrmRecordEmail(request)
  },
}

/**
 * The plugin's SERVER declarations: what the server must know at boot, before
 * any door of the CRM has been called.
 *
 * ## Why a declaration and not a `tenantApi` registration
 *
 * The doors that meet a person mostly never load this plugin. A form
 * submission is a core route; an order and a booking are captured inside
 * STRIPE WEBHOOKS. None of them has a reason to load the CRM, and a registry
 * filled by a surface that did not load answers `null` — which
 * `capturePluginContact` defines as "this workspace has no record system", a
 * sentence that would be false and silent. Orders would stop creating
 * contacts with nothing red anywhere, which is the AGL-3025 shape.
 *
 * Running from both apps' generated server-declarations manifest at boot is
 * what makes the answer true in every process. It is also called from the
 * plugin's own API register functions, so a process whose boot did not run it
 * still registers the writer the first time a CRM door loads. Registering
 * twice replaces in place.
 *
 * ⚠️ The registry holds ONE writer: a workspace keeps one set of people. A
 * second plugin's is refused naming both, and the incumbent keeps serving.
 */
export function registerCrmServerDeclarations(): void {
  registerPluginContactCaptureWriter(crmContactCaptureWriter, {
    pluginId: BUNDLE_ID,
  })
  // The other half of keeping people (AGL-3080): another plugin that holds
  // an address, or a record the CRM handed it, asks here for the person —
  // a flow email's consent read, a refund, an automation filing somebody
  // under a campaign — and never opens the CRM's collections itself.
  registerPluginPersonRecords(crmPersonRecordsService, { pluginId: BUNDLE_ID })
  // The CRM's own share of a lead conversion (AGL-3254): the lead's
  // campaigns go onto the contact's facet. Through the seam every door
  // that converts a lead reaches, and deferred like the capture: the
  // module that writes is loaded when the first conversion arrives, and
  // it brings the Admin SDK with it — this file defers the plugin's OWN
  // module only. A library imported statically across the plugin cannot
  // also be lazy-loaded here: `enforce-module-boundaries` refuses every
  // static import of a library the project lazy-loads anywhere.
  registerPluginLeadConversionListener(
    async (request) => {
      const { carryLeadCampaignsOnConversion } =
        await import('./server/lead-campaign-carry')
      return carryLeadCampaignsOnConversion(request)
    },
    { pluginId: BUNDLE_ID },
  )
  // "Did this workspace already know this person?" (AGL-3289), asked by the
  // staff console's acquisition card. Deferred like the rest: the reads load
  // when a staff member first opens a card, not when the process starts.
  registerPluginPersonMatcher(
    async (request) => {
      const { matchCrmPeople } = await import('./server/person-matches')
      return matchCrmPeople(request)
    },
    { pluginId: BUNDLE_ID },
  )
  // The CRM's share of a consent group change (AGL-3320): a contact's
  // per-site refusal carried across a separation, and the records keyed by a
  // group re-homed after the flip. Registered whether or not a workspace has
  // the CRM switched on, because the contacts — and the refusals on them —
  // outlive the switch. Deferred like the rest; the summary is plain words
  // and answers synchronously.
  // The record email-state writer (AGL-3245), here as well as in the console
  // API so the tenant's doors reach it too: a form submission's capture is
  // checked for deliverability after its response (AGL-3328), and the "Would
  // bounce" that check finds is written through this seam. Deferred like the
  // rest; the console's own registration replaces this one with the same
  // writer, loaded eagerly.
  registerPluginRecordEmailStateWriter(
    {
      async stamp(request) {
        const { createCrmRecordEmailStateWriter, defaultCrmRecordEmailStateDeps } =
          await import('./server/record-email-state')
        return createCrmRecordEmailStateWriter(defaultCrmRecordEmailStateDeps()).stamp(request)
      },
      // A send's first opens and clicks, stamped on the contacts they name
      // (AGL-2616) — the campaign webhook's courtesy, deferred like the rest.
      async engaged(request) {
        const { createCrmRecordEmailStateWriter, defaultCrmRecordEmailStateDeps } =
          await import('./server/record-email-state')
        return createCrmRecordEmailStateWriter(defaultCrmRecordEmailStateDeps()).engaged!(request)
      },
      // A delivered campaign's leads, moved to Nurturing (AGL-3446).
      async reached(request) {
        const { createCrmRecordEmailStateWriter, defaultCrmRecordEmailStateDeps } =
          await import('./server/record-email-state')
        return createCrmRecordEmailStateWriter(defaultCrmRecordEmailStateDeps()).reached!(request)
      },
      // A lead that wrote back, moved to Working (AGL-3080).
      async replied(request) {
        const { createCrmRecordEmailStateWriter, defaultCrmRecordEmailStateDeps } =
          await import('./server/record-email-state')
        return createCrmRecordEmailStateWriter(defaultCrmRecordEmailStateDeps()).replied!(request)
      },
    },
    { pluginId: BUNDLE_ID },
  )
  // The record timeline writer (AGL-2981), here as well as in the API
  // surfaces so a door in either app reaches it: a booking confirmed on the
  // tenant, or by the payment webhook, files its meeting and follow-up
  // through it (AGL-2660). Deferred like the rest; an API registration
  // replaces this one with the same writer, loaded eagerly.
  registerPluginRecordTimelineWriter(crmRecordTimelineWriter, { pluginId: BUNDLE_ID })
  // Where a person came from (AGL-3519): a door the CRM does not run — the
  // platform's account sign-up, a sequence enrolling someone — names its
  // origin, and the CRM stamps the built-in Lead source on a record holding
  // none. Deferred like the rest.
  registerPluginRecordOriginWriter(
    {
      async stamp(request) {
        const { crmRecordOriginWriter } = await import('./server/record-origin')
        return crmRecordOriginWriter.stamp(request)
      },
    },
    { pluginId: BUNDLE_ID },
  )
  // Sharing rules (AGL-3336), re-evaluated after every server write of a
  // lead, a contact, a company or a deal: the core tells its record-written
  // listeners from the list-field restamp every such writer ends with, in
  // both apps — a form's capture on the tenant, an edit in the console.
  // Deferred like the rest: an org with no rules pays one cached read.
  registerPluginRecordWrittenListener(
    async (event) => {
      const { crmSharingRecordWritten } = await import('./server/crm-sharing')
      await crmSharingRecordWritten(event)
    },
    { pluginId: BUNDLE_ID, key: 'sharing' },
  )
  // The organization's pipelines and their stages, as another plugin reads
  // them (AGL-3080): an automation the AI drafts names the stage a deal
  // moves to. Deferred like the rest: the reads load with the first one.
  registerPluginRecordIndex('pipeline', crmPipelineRecordIndex, { pluginId: BUNDLE_ID })
  // The company a person works for, and the templates reps write, as a sales
  // sequence reads them (AGL-3080). Deferred like the rest.
  registerPluginRecordIndex('company', crmCompanyRecordIndex, { pluginId: BUNDLE_ID })
  registerPluginRecordIndex('messageTemplate', crmMessageTemplateRecordIndex, { pluginId: BUNDLE_ID })
  // The automation steps that write the CRM (AGL-2605, AGL-3080), run for the
  // workflows engine through the server-step seam and declared under
  // `serverSteps`. Deferred like the rest: the writes load with the first step.
  registerServerStepExecutor(
    CRM_STEP_TYPES,
    async (request) => (await import('./server/automation-steps')).runCrmAutomationStep(request),
    { pluginId: BUNDLE_ID },
  )
  registerPluginConsentGroupParticipant(
    {
      async preview(request) {
        const { consentGroupParticipant } = await import('./server/consent-group-participant')
        return consentGroupParticipant.preview(request)
      },
      async run(request) {
        const { consentGroupParticipant } = await import('./server/consent-group-participant')
        return consentGroupParticipant.run(request)
      },
      summarize: summarizeConsentGroupChange,
    },
    { pluginId: BUNDLE_ID },
  )
  // The records band in the monthly usage sweep, a core cron that never
  // loads a CRM door; declared in `usageAxes` so the sweep refuses to bill a
  // month without it. Deferred like the rest: the counts load with the
  // first sweep.
  registerPluginUsageMeter({
    pluginId: BUNDLE_ID,
    id: CRM_RECORDS_METER_ID,
    measure: async (context) => {
      const { measureCrmRecords } = await import('./server/crm-records-meter')
      return measureCrmRecords(context)
    },
  })
}

