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

// Each registry from its own module, not the `@aglyn/aglyn/server` barrel:
// boot needs one registry, not the whole server surface.
import { registerPluginConsoleCron } from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import {
  listPluginMembershipDetachers,
  registerPluginMembershipDetacher,
} from '@aglyn/aglyn/plugin-manager/plugin-membership-detach'
import {
  listPluginOrgErasers,
  registerPluginOrgEraser,
} from '@aglyn/aglyn/plugin-manager/plugin-org-erasure'
import {
  listPluginLeadConversionListeners,
  registerPluginLeadConversionListener,
} from '@aglyn/aglyn/plugin-manager/plugin-lead-conversion'
import { registerPluginPersonEraser } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import {
  listPluginUserErasers,
  registerPluginUserEraser,
} from '@aglyn/aglyn/plugin-manager/plugin-user-erasure'
import { OUTREACH_PLUGIN_ID } from './constants/bundle-common'
import { OUTREACH_SEND_JOB_ID, OUTREACH_SYNC_JOB_ID } from './constants/runtime-jobs'

/**
 * Outreach's CONSOLE-ONLY server declarations (AGL-2978), named under
 * `consoleServerDeclarations` in `plugins.config.json` and run at the
 * console's boot.
 *
 * The erasers are registered here rather than from `serverDeclarations`,
 * which the tenant runtime also loads: the workspace eraser revokes each
 * rep's Google grant, and the account eraser (AGL-3106) revokes and deletes
 * the person's own, and both open a sealed token with `OUTREACH_TOKEN_KEY`,
 * which only the console holds. The tenant may not so much as bundle the code
 * that does (`outreach-credential-isolation.spec.ts`). Every erasure runs in
 * the console, so this is where the erasers are needed.
 *
 * The sending runtime (AGL-2981) is declared here too, for the same reason:
 * the send and sync jobs open each rep's sealed grant, so they run on the
 * console's `plugin-console-crons` tick and nowhere else, and the person
 * eraser removes the enrollments a workspace kept about someone it erases.
 *
 * Light at boot: every module that does the work is imported when a job, an
 * erasure or a tick first asks for it, so the boot cost is the registration.
 */
export function registerOutreachConsoleServerDeclarations(): void {
  // Idempotent against the REGISTRY, so a reset (a spec) registers again.
  if (!listPluginOrgErasers().includes(OUTREACH_PLUGIN_ID)) {
    registerPluginOrgEraser(
      async (request) => {
        const { createOutreachOrgEraser, defaultOutreachErasureDeps } = await import(
          './mailboxes/mailbox-erasure'
        )
        return createOutreachOrgEraser(defaultOutreachErasureDeps())(request)
      },
      { pluginId: OUTREACH_PLUGIN_ID },
    )
  }
  if (!listPluginUserErasers().includes(OUTREACH_PLUGIN_ID)) {
    registerPluginUserEraser(
      async (request) => {
        const { createOutreachUserEraser, defaultOutreachErasureDeps } = await import(
          './mailboxes/mailbox-erasure'
        )
        return createOutreachUserEraser(defaultOutreachErasureDeps())(request)
      },
      { pluginId: OUTREACH_PLUGIN_ID },
    )
  }
  // A person erased from a workspace takes their enrollments with them; the
  // do-not-contact entry stays, stripped of anything that names them.
  registerPluginPersonEraser(
    async (request) => (await runtime()).platformOutreachPersonEraser()(request),
    { pluginId: OUTREACH_PLUGIN_ID },
  )
  // A lead that converts takes its enrollments to the contact it became
  // (AGL-3234): the same document, now naming the contact — and every
  // enrollment made on it credits `converted` to its campaigns (AGL-3254).
  if (!listPluginLeadConversionListeners().includes(OUTREACH_PLUGIN_ID)) {
    registerPluginLeadConversionListener(
      async (request) => {
        const [{ followOutreachLeadToContact }, { creditOutreachLeadConversion }, platform] = await Promise.all([
          import('./runtime/lead-records'),
          import('./runtime/campaign-credit'),
          runtime(),
        ])
        const deps = platform.platformOutreachRuntimeDeps()
        const credited = await creditOutreachLeadConversion(deps, request)
        const followed = await followOutreachLeadToContact(deps.firestore(), request)
        return { ...followed, campaignsCredited: credited }
      },
      { pluginId: OUTREACH_PLUGIN_ID },
    )
  }
  // A deleted campaign comes off every sequence and enrollment naming it
  // (AGL-3254), before the marketing plugin removes the container.
  if (!listPluginMembershipDetachers().includes(OUTREACH_PLUGIN_ID)) {
    registerPluginMembershipDetacher(
      async (request) => {
        const [{ createOutreachCampaignDetacher }, platform] = await Promise.all([
          import('./runtime/campaign-detach'),
          runtime(),
        ])
        return createOutreachCampaignDetacher({ firestore: platform.platformOutreachRuntimeDeps().firestore })(
          request,
        )
      },
      { pluginId: OUTREACH_PLUGIN_ID },
    )
  }
  // The sending runtime, on the console's fifteen-minute tick.
  registerPluginConsoleCron(
    {
      id: OUTREACH_SEND_JOB_ID,
      label: 'Sequence sends',
      drives:
        'Sends every sequence step that has come due, from the rep’s own connected mailbox, and files each on the contact’s timeline. If it stops, no sequence sends anything and every task step waits.',
      run: async (context) => {
        const [{ runOutreachSendJob }, platform] = await Promise.all([import('./runtime/send-job'), runtime()])
        return runOutreachSendJob(platform.platformOutreachRuntimeDeps(), context)
      },
    },
    { pluginId: OUTREACH_PLUGIN_ID },
  )
  registerPluginConsoleCron(
    {
      id: OUTREACH_SYNC_JOB_ID,
      label: 'Sequence replies and bounces',
      drives:
        'Reads each connected mailbox for replies, out-of-office answers, opt-outs and bounces, and stops or postpones the sequence each one is about. If it stops, a person who replied or asked to be left alone keeps getting follow-ups, and a mailbox that bounces never pauses itself.',
      run: async (context) => {
        const [{ runOutreachSyncJob }, platform] = await Promise.all([import('./runtime/sync-job'), runtime()])
        return runOutreachSyncJob(platform.platformOutreachRuntimeDeps(), context)
      },
    },
    { pluginId: OUTREACH_PLUGIN_ID },
  )
}

/** The runtime's platform reach, loaded when a job or an erasure first runs. */
const runtime = () => import('./runtime/platform-runtime-deps')
