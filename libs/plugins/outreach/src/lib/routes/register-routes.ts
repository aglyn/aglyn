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
 */

/**
 * The gate's reach into the platform.
 *
 * The permission resolver, the lockdown verdict and the activity log are
 * imported when a request first needs them rather than when the bundle
 * registers: `org-permissions` reaches the whole tenant data barrel, and the
 * manifest loads this bundle into every console API process whether or not
 * an Outreach route is ever called.
 */
export function defaultOutreachRouteGateDeps(): OutreachRouteGateDeps {
  return {
    verifyIdToken: (idToken) => firebaseAdmin.app().auth().verifyIdToken(idToken),
    resolveOrgPermissions: async (uid, context) =>
      (await import('@aglyn/tenant-runtime/org-permissions')).resolveOrgPermissions(uid, context),
    holdsOrgCatalogPermission: async (uid, orgId, key) => {
      try {
        const organizations = await import('@aglyn/tenant-data-admin/server/organizations')
        const membership = await organizations.resolveOrgMembership(uid, orgId)
        if (!membership?.member) return false
        return (
          (await organizations.memberHasOrgPermission(
            orgId,
            membership.member,
            key as Parameters<typeof organizations.memberHasOrgPermission>[2],
          )) === true
        )
      } catch {
        // A lookup that failed has not shown the member holds it.
        return false
      }
    },
    readOrg: async (orgId) => {
      const snapshot = await firebaseAdmin.app().firestore().collection('orgs').doc(orgId).get()
      return snapshot.exists ? (snapshot.data() ?? {}) : null
    },
    lockdownRefusal: async (options) =>
      (await import('@aglyn/tenant-data-admin/server/lockdown')).lockdownRefusal(options),
  }
}

export function defaultOutreachRouteDeps(): OutreachEnrollRouteDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore(),
    gate: defaultOutreachRouteGateDeps(),
    now: Date.now,
    random: Math.random,
    logOrgActivity: async (orgId, actor, action, target) =>
      (await import('@aglyn/tenant-data-admin/server/organizations')).logOrgActivity(
        orgId,
        actor,
        action,
        target,
      ),
    crmViewEmails: async ({ hostId, viewId }) => {
      const { collectDynamicListCandidates } = await import(
        '@aglyn/tenant-data-admin/server/dynamic-list-materialize'
      )
      const scan = await collectDynamicListCandidates({ hostId, rule: { sources: ['contacts'], viewId } })
      return { emails: scan.candidates.map((candidate) => candidate.email), complete: scan.complete }
    },
  }
}

export function registerOutreachRoutes(
  deps: OutreachEnrollRouteDeps = defaultOutreachRouteDeps(),
): void {
  const sequences = createOutreachSequenceRoutes(deps)
  const enroll = createOutreachEnrollRoutes(deps)
  registerPluginApiRoute(OUTREACH_API_ROUTES.settings, { web: createOutreachSettingsRoute(deps) })
  registerPluginApiRoute(OUTREACH_API_ROUTES.sequencesSave, { web: sequences.save })
  registerPluginApiRoute(OUTREACH_API_ROUTES.sequencesStatus, { web: sequences.status })
  registerPluginApiRoute(OUTREACH_API_ROUTES.sequencesDelete, { web: sequences.remove })
  registerPluginApiRoute(OUTREACH_API_ROUTES.enrollPreview, { web: enroll.preview })
  registerPluginApiRoute(OUTREACH_API_ROUTES.enroll, { web: enroll.confirm })
  registerPluginApiRoute(OUTREACH_API_ROUTES.enrollmentsAction, {
    web: createOutreachEnrollmentActionRoute(deps),
  })
  registerPluginApiRoute(OUTREACH_API_ROUTES.preview, { web: createOutreachPreviewRoute(deps) })
}
