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

import { pluginRecordTimelineWriter } from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import { pluginTextGenerator } from '@aglyn/aglyn/plugin-manager/plugin-text-generation'
import { registerPluginApiRoute } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { resolveMx } from 'node:dns/promises'
import { OUTREACH_API_ROUTES } from '../constants/api-routes'
import { openOutreachMailboxClient } from '../mailboxes/mailbox-transport'
import { outreachOrgSubject } from '../mailboxes/register-mailbox-routes'
import { outreachShortLinkUrl } from '../runtime/click-link'
import { createOutreachCurateRoutes } from './curate-routes'
import { createOutreachDoNotContactDomainsRoute } from './do-not-contact-routes'
import { createOutreachEnrollRoutes, type OutreachEnrollRouteDeps } from './enroll-routes'
import { createOutreachEnrollmentActionRoute } from './enrollment-routes'
import { canonicalConsoleOrigin } from '../mailboxes/oauth-redirect'
import { createOutreachLinkDomainsRoute, type OutreachLinkDomainRouteDeps } from './link-domain-routes'
import { createOutreachPreviewRoute } from './preview-routes'
import type { OutreachRouteGateDeps } from './route-gate'
import { createOutreachSequenceRoutes } from './sequence-routes'
import { createOutreachSettingsRoute } from './settings-routes'
import { createOutreachStepTestRoute, type OutreachStepTestDeps } from './step-test-routes'

/**
 * Wires the settings, sequence and enrollment routes into the console
 * dispatcher (AGL-2980) with the platform's own dependencies. Specs build
 * their own.
 *
 * Every one names its organization (`orgId`, in the query or the JSON body)
 * and none names a site, so each declares the mailbox routes' subject reader:
 * the dispatcher's release gate then asks about that organization, and a
 * `release_outreach` override for one organization reaches these routes as it
 * reaches Mailboxes. Without it the gate reads the request as anonymous, which
 * only a fully enabled flag or a staff session passes.
 */

/** The platform's heavier modules, loaded the first time a request needs one. */
const platform = () => import('./platform-deps')

/** The gate's reach into the platform. */
export function defaultOutreachRouteGateDeps(): OutreachRouteGateDeps {
  return {
    verifyIdToken: (idToken) => firebaseAdmin.app().auth().verifyIdToken(idToken),
    resolveOrgPermissions: async (uid, context) => (await platform()).resolveOrgPermissions(uid, context),
    holdsOrgCatalogPermission: async (uid, orgId, key) =>
      (await platform()).holdsOrgCatalogPermission(uid, orgId, key),
    readOrg: async (orgId) => {
      const snapshot = await firebaseAdmin.app().firestore().collection('orgs').doc(orgId).get()
      return snapshot.exists ? (snapshot.data() ?? {}) : null
    },
    lockdownRefusal: async (options) => (await platform()).lockdownRefusal(options),
  }
}

export function defaultOutreachRouteDeps(): OutreachEnrollRouteDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore(),
    gate: defaultOutreachRouteGateDeps(),
    now: Date.now,
    random: Math.random,
    logOrgActivity: async (orgId, actor, action, target) =>
      (await platform()).logOrgActivity(orgId, actor, action, target),
    crmViewEmails: async (input) => (await platform()).crmViewEmails(input),
    stampRecordEmailState: async (stamp) => {
      await (await platform()).stampRecordEmailState(stamp)
    },
    creditCampaign: async ({ hostId, orgId, campaignIds, outcome, atMs }) => {
      await (await platform()).creditCampaignSequenceOutcome(
        { hostId, orgId, campaignIds, outcome, atMs },
        firebaseAdmin.app().firestore(),
      )
    },
    // The record system's writer (AGL-3274), resolved per call the way the
    // runtime resolves it: the CRM registers at boot, and a request that
    // arrives before it did files nothing rather than caching a `null`.
    timeline: () => pluginRecordTimelineWriter()?.writer ?? null,
    // The domain's MX (AGL-3326), from the console's own resolver.
    resolveMx: (domain) => resolveMx(domain),
    // The workspace's text generator (AGL-3324), resolved per call the same
    // way: the AI plugin registers at boot, and a request before it did is
    // told drafting is unavailable rather than caching a `null`.
    textGenerator: () => pluginTextGenerator()?.generator ?? null,
  }
}

/** The link domains route's reach (AGL-3306): the tracking-host store, loaded on first use. */
export function defaultOutreachLinkDomainDeps(): OutreachLinkDomainRouteDeps {
  return {
    hosts: async () => {
      const loaded = await platform()
      return {
        list: loaded.listTrackingHosts,
        setUp: loaded.setUpTrackingHost,
        verify: loaded.verifyTrackingHost,
        remove: loaded.removeTrackingHost,
      }
    },
    consoleOrigin: canonicalConsoleOrigin,
  }
}

/**
 * The test send's reach (AGL-3325): the mailbox's Gmail through the same
 * door the runtime and the Mailboxes test use, the platform's rate limit,
 * and the short links a real send would mint.
 */
export function defaultOutreachStepTestDeps(): OutreachStepTestDeps {
  return {
    openMailbox: (mailboxId) => openOutreachMailboxClient(firebaseAdmin.app().firestore(), { mailboxId }),
    consumeRateLimit: async (key, options) =>
      (await import('@aglyn/tenant-data-admin/server/rate-limit-store')).consumeRateLimit(key, options),
    clickLinkUrl: (linkId, trackingOrigin) =>
      outreachShortLinkUrl({ origin: canonicalConsoleOrigin(), linkId, trackingOrigin }),
    clickLinkOrigin: async ({ orgId, senderAddress }) =>
      (await platform()).resolveTrackingLinkOrigin(firebaseAdmin.app().firestore(), orgId, senderAddress),
  }
}

export function registerOutreachRoutes(
  deps: OutreachEnrollRouteDeps = defaultOutreachRouteDeps(),
): void {
  const sequences = createOutreachSequenceRoutes(deps)
  const enroll = createOutreachEnrollRoutes(deps)
  const curate = createOutreachCurateRoutes(deps)
  const orgSubject = { subject: outreachOrgSubject }
  registerPluginApiRoute(OUTREACH_API_ROUTES.settings, { web: createOutreachSettingsRoute(deps) }, orgSubject)
  registerPluginApiRoute(OUTREACH_API_ROUTES.sequencesSave, { web: sequences.save }, orgSubject)
  registerPluginApiRoute(OUTREACH_API_ROUTES.sequencesStatus, { web: sequences.status }, orgSubject)
  registerPluginApiRoute(OUTREACH_API_ROUTES.sequencesDelete, { web: sequences.remove }, orgSubject)
  registerPluginApiRoute(OUTREACH_API_ROUTES.enrollPreview, { web: enroll.preview }, orgSubject)
  registerPluginApiRoute(OUTREACH_API_ROUTES.enroll, { web: enroll.confirm }, orgSubject)
  registerPluginApiRoute(
    OUTREACH_API_ROUTES.enrollmentsAction,
    { web: createOutreachEnrollmentActionRoute(deps) },
    orgSubject,
  )
  registerPluginApiRoute(OUTREACH_API_ROUTES.preview, { web: createOutreachPreviewRoute(deps) }, orgSubject)
  registerPluginApiRoute(OUTREACH_API_ROUTES.curateDraft, { web: curate.draft }, orgSubject)
  registerPluginApiRoute(OUTREACH_API_ROUTES.curateSave, { web: curate.save }, orgSubject)
  registerPluginApiRoute(
    OUTREACH_API_ROUTES.stepTest,
    { web: createOutreachStepTestRoute(deps, defaultOutreachStepTestDeps()) },
    orgSubject,
  )
  registerPluginApiRoute(
    OUTREACH_API_ROUTES.doNotContactDomains,
    { web: createOutreachDoNotContactDomainsRoute(deps) },
    orgSubject,
  )
  registerPluginApiRoute(
    OUTREACH_API_ROUTES.linkDomains,
    { web: createOutreachLinkDomainsRoute(deps, defaultOutreachLinkDomainDeps()) },
    orgSubject,
  )
}
