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
import type { OutreachRouteGateDeps } from './route-gate'
import {
  createOutreachSettingsRoute,
  type OutreachSettingsRouteDeps,
} from './settings-routes'

/**
 * Wires the settings, sequence and enrollment routes into the console
 * dispatcher (AGL-2980) with the platform's own dependencies. Specs build
 * their own.
 */

/** Everything the routes reach outside this plugin. */
export type OutreachRouteDeps = OutreachSettingsRouteDeps

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
    readOrg: async (orgId) => {
      const snapshot = await firebaseAdmin.app().firestore().collection('orgs').doc(orgId).get()
      return snapshot.exists ? (snapshot.data() ?? {}) : null
    },
    lockdownRefusal: async (options) =>
      (await import('@aglyn/tenant-data-admin/server/lockdown')).lockdownRefusal(options),
  }
}

export function defaultOutreachRouteDeps(): OutreachRouteDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore(),
    gate: defaultOutreachRouteGateDeps(),
    now: Date.now,
    logOrgActivity: async (orgId, actor, action, target) =>
      (await import('@aglyn/tenant-data-admin/server/organizations')).logOrgActivity(
        orgId,
        actor,
        action,
        target,
      ),
  }
}

export function registerOutreachRoutes(deps: OutreachRouteDeps = defaultOutreachRouteDeps()): void {
  registerPluginApiRoute(OUTREACH_API_ROUTES.settings, { web: createOutreachSettingsRoute(deps) })
}
