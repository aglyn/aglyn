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
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { OUTREACH_API_ROUTES } from '../constants/api-routes'
import { outreachOrgSubject } from '../mailboxes/register-mailbox-routes'
import { createOutreachDoNotContactDomainsRoute } from './do-not-contact-routes'
import { createOutreachEnrollRoutes, type OutreachEnrollRouteDeps } from './enroll-routes'
import { createOutreachEnrollmentActionRoute } from './enrollment-routes'
import { createOutreachPreviewRoute } from './preview-routes'
import type { OutreachRouteGateDeps } from './route-gate'
import { createOutreachSequenceRoutes } from './sequence-routes'
import { createOutreachSettingsRoute } from './settings-routes'

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
  }
}

export function registerOutreachRoutes(
  deps: OutreachEnrollRouteDeps = defaultOutreachRouteDeps(),
): void {
  const sequences = createOutreachSequenceRoutes(deps)
  const enroll = createOutreachEnrollRoutes(deps)
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
  registerPluginApiRoute(
    OUTREACH_API_ROUTES.doNotContactDomains,
    { web: createOutreachDoNotContactDomainsRoute(deps) },
    orgSubject,
  )
}
