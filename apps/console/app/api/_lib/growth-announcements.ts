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
import {
  isSignupCanaryEmail,
  isSignupCanaryOrgSlug,
  PLATFORM_BRANDING_PROFILE,
} from '@aglyn/aglyn/server'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import {
  firebaseAdmin,
  meterOrgEmail,
  notifyStaff,
} from '@aglyn/tenant-data-admin'
import { buildRoute, Route } from '../../../constants/route-links'
import { renderSystemEmail } from './render-system-email'

/**
 * What a new workspace and a new site announce, in one place for every door
 * that makes one (AGL-3491).
 *
 * A workspace has two creation doors: `/api/orgs/create`, and
 * `/api/hosts/create`, which provisions a personal workspace through
 * `ensureOrgForUser` for an account creating its first site while holding
 * none. The announcement lived inline in the first, so the second — the one
 * a brand-new account most often takes — welcomed nobody and told staff
 * nothing. Both doors call these now, so a third cannot forget half.
 *
 * Neither function throws. Each part sits in its own `catch`: a workspace or
 * site that was created must never become a 500 because we could not say so.
 */

export interface NewWorkspaceAnnouncement {
  orgId: string
  name: string
  slug: string
  owner: {
    uid: string
    email: string | null
    /** As the IdP asserts it (AGL-1131); `null` falls back to "there". */
    displayName: string | null
  }
  /** The console origin the welcome email links to. */
  origin: string
}

export async function announceNewWorkspace(
  workspace: NewWorkspaceAnnouncement,
): Promise<void> {
  const { orgId, name, slug, owner, origin } = workspace

  // Welcome email on the owner's FIRST org only (AGL-768): someone who
  // creates their second workspace does not get welcomed again. Counted
  // after creation — they now own exactly one. Best-effort like every other
  // send; the copy below is the last resort behind the rendered template,
  // and `sendEmail` never throws.
  try {
    if (owner.email && isEmailConfigured()) {
      const ownedCount = (
        await firebaseAdmin
          .app()
          .firestore()
          .collection('orgs')
          .where('ownerUid', '==', owner.uid)
          .limit(2)
          .get()
      ).size
      if (ownedCount === 1) {
        const ownerName = owner.displayName || 'there'
        const fallbackText =
          `Hi ${ownerName}, thanks for creating ${name}. Your workspace ` +
          `is ready.\n\nOpen your dashboard at ${origin}.`
        // No brand argument: `renderSystemEmail` already merges
        // `DEFAULT_BRAND_TOKENS` — the platform profile — under whatever the
        // caller supplies (AGL-2139). That is the right answer here anyway,
        // since the org was created seconds ago and carries no `whiteLabel`
        // entitlement, so `resolveBrandingProfile` would return exactly it.
        const designed = await renderSystemEmail('welcome', {
          name: ownerName,
          'org.name': name,
          consoleUrl: origin,
        })
        await sendEmail({
          to: owner.email,
          subject:
            designed?.subject ??
            `Welcome to ${PLATFORM_BRANDING_PROFILE.productName}`,
          text: designed?.text || fallbackText,
          ...(designed?.html ? { html: designed.html } : {}),
          context: 'welcome',
        })
        // Cost meter (AGL-1438). Org-scoped: the org exists by now.
        await meterOrgEmail(orgId)
      }
    }
  } catch (welcomeError) {
    console.error('welcome email skipped', welcomeError)
  }

  /*
   * AND TELL OURSELVES (AGL-3225).
   *
   * ⚠️ Except the canary's own (AGL-3248). It walks hourly and REAPS what it
   * made, so each announcement is a workspace that no longer exists behind a
   * link to an admin page that 404s. Nine of the ten most recent staff rows
   * were canary on 2026-09-22, which is how a feed meant to carry the
   * platform's growth stops being read at all.
   */
  try {
    if (!isSignupCanaryOrgSlug(slug) && !isSignupCanaryEmail(owner.email)) {
      await notifyStaff({
        type: 'staff.orgCreated',
        title: `New workspace: ${name}`,
        body: `${owner.email ?? 'An account'} created ${name} (/${slug}).`,
        link: buildRoute(Route.ADMIN_ORG_DETAIL, { orgId }),
      })
    }
  } catch (staffError) {
    console.error('staff new-workspace notification skipped', staffError)
  }
}

export interface NewSiteAnnouncement {
  hostId: string
  displayName: string
  subdomain: string
  /** The workspace's slug, for the canary test; `null` when unknown. */
  orgSlug: string | null
  /** Who made it: an address for a console session, a label for an API key. */
  createdBy: string | null
}

/**
 * A site was created (AGL-3491). The third growth event, after the account
 * and the workspace, and the one that says somebody actually started
 * building — so it is told to staff in the same category, switchable with
 * them.
 */
export async function announceNewSite(site: NewSiteAnnouncement): Promise<void> {
  const { hostId, displayName, subdomain, orgSlug, createdBy } = site
  try {
    if (isSignupCanaryOrgSlug(orgSlug) || isSignupCanaryEmail(createdBy)) return
    await notifyStaff({
      type: 'staff.siteCreated',
      title: `New site: ${displayName}`,
      body: `${createdBy ?? 'An account'} created ${displayName} (${subdomain}).`,
      link: buildRoute(Route.ADMIN_SITE_DETAIL, { hostId }),
    })
  } catch (staffError) {
    console.error('staff new-site notification skipped', staffError)
  }
}
