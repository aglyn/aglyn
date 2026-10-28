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
  ACCOUNT_ACQUISITION_FIELD,
  accountAcquisitionDetails,
  describeAccountAcquisition,
  providerLabel,
  readAccountAcquisition,
} from '@aglyn/aglyn/app-utils/account-acquisition'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'
import { PLAN_LABELS, resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { PLATFORM_HOME_URL } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  isSignupCanaryEmail,
  isSignupCanaryOrgSlug,
  PLATFORM_BRANDING_PROFILE,
} from '@aglyn/aglyn/server'
import {
  isEmailConfigured,
  sendEmail,
  welcomeEmailMergeValues,
} from '@aglyn/shared-util-email'
import {
  firebaseAdmin,
  meterOrgEmail,
  notifyStaff,
  type NotificationEmailDetail,
} from '@aglyn/tenant-data-admin'
import { runPluginEventHandlers } from '@aglyn/aglyn/plugin-manager/plugin-events'
import { DOCS_BASE_URL } from '../../../constants/docs-links'
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

// ── What staff are told, in detail (AGL-3897) ─────────────────────────────
//
// The bell carries one line; the email beside it carries the rest, as rows a
// staff member reads label beside value: who it is, how they found us, what
// they made and on which plan. Every read below is best-effort — a fact that
// cannot be read is left out, and the announcement still goes.

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The platform home's host, against which a landing page reads as a bare path. */
function homeHost(): string | null {
  try {
    return PLATFORM_HOME_URL ? new URL(PLATFORM_HOME_URL).hostname : null
  } catch {
    return null
  }
}

/** The rows that are filled, as the notification email draws them. */
function filled(rows: ReadonlyArray<{ label: string; value: string | null | undefined }>): NotificationEmailDetail[] {
  return rows
    .map((row) => ({ label: row.label, value: text(row.value) }))
    .filter((row) => row.value)
}

async function readDoc(collection: string, id: string | null | undefined) {
  if (!id) return null
  try {
    const doc = await firebaseAdmin.app().firestore().collection(collection).doc(id).get()
    return doc.exists ? ((doc.data() ?? {}) as Record<string, unknown>) : null
  } catch (error) {
    console.error(`staff announcement could not read ${collection}/${id}`, error)
    return null
  }
}

function planOf(org: Record<string, unknown> | null): string | null {
  if (!org) return null
  const plan = resolveEffectivePlan(org as never)
  return PLAN_LABELS[plan as keyof typeof PLAN_LABELS] ?? String(plan)
}

/** How many of something a query counts; `null` when it cannot be built or read. */
async function countOf(query: () => FirebaseFirestore.Query): Promise<number | null> {
  try {
    return (await query().count().get()).data().count
  } catch {
    return null
  }
}

export interface NewAccountAnnouncement {
  uid: string
  email: string | null
  displayName: string | null
  /** The sign-in provider on the verified token: `password`, `google.com`, `saml.…`. */
  provider: string | null
  emailVerified: boolean
}

/**
 * A new account, told to staff (AGL-3225), with who it is and how they found
 * us: the acquisition record the sign-up wrote on `users/{uid}` (AGL-3289),
 * laid out row by row.
 */
export async function announceNewAccount(account: NewAccountAnnouncement): Promise<void> {
  try {
    const user = await readDoc('users', account.uid)
    const acquisition = readAccountAcquisition(user?.[ACCOUNT_ACQUISITION_FIELD])
    const name = account.displayName || text(user?.['displayName']) || null
    const details = filled([
      { label: 'Email', value: account.email },
      { label: 'Name', value: name },
      { label: 'Signs in with', value: providerLabel(account.provider) },
      { label: 'Email confirmed', value: account.emailVerified ? 'Yes' : 'Not yet' },
      ...accountAcquisitionDetails(acquisition, { primaryHost: homeHost() }),
      { label: 'Account id', value: account.uid },
    ])
    await notifyStaff(
      {
        type: 'staff.userSignedUp',
        title: `New account: ${account.email ?? account.uid}`,
        body: `${account.email ?? account.uid} signed up. ${describeAccountAcquisition(acquisition, { primaryHost: homeHost() })}.`,
        link: buildRoute(Route.ADMIN_USER_DETAIL, { uid: account.uid }),
      },
      { emailDetails: details },
    )
  } catch (error) {
    console.error('staff new-account notification skipped', error)
  }
}

export interface NewWorkspaceAnnouncement {
  orgId: string
  name: string
  slug: string
  owner: {
    uid: string
    email: string | null
    /** As the IdP asserts it (AGL-1131); `null` falls back to "there". */
    displayName: string | null
    /** Whether the owner's address is verified, as their token says. */
    emailVerified?: boolean
  }
  /** The console origin the welcome email links to. */
  origin: string
  /** Which door made it: the new-workspace page, or an account's first site. */
  via?: 'workspace-page' | 'first-site'
}

export async function announceNewWorkspace(
  workspace: NewWorkspaceAnnouncement,
): Promise<void> {
  const { orgId, name, slug, owner, origin, via } = workspace

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
          `is ready.\n\nOpen it at ${origin}/${slug}.`
        // No brand argument: `renderSystemEmail` already merges
        // `DEFAULT_BRAND_TOKENS` — the platform profile — under whatever the
        // caller supplies (AGL-2139). That is the right answer here anyway,
        // since the org was created seconds ago and carries no `whiteLabel`
        // entitlement, so `resolveBrandingProfile` would return exactly it.
        const designed = await renderSystemEmail('welcome', {
          name: ownerName,
          'org.name': name,
          consoleUrl: `${origin}/${slug}`,
          ...welcomeEmailMergeValues({
            orgName: name,
            slug,
            consoleOrigin: origin,
            docsOrigin: DOCS_BASE_URL,
            start: via,
          }),
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
      const org = await readDoc('orgs', orgId)
      // The workspace's copy of its creator's record (AGL-3289), else the creator's own.
      const acquisition =
        readAccountAcquisition(org?.[ACCOUNT_ACQUISITION_FIELD]) ??
        readAccountAcquisition((await readDoc('users', owner.uid))?.[ACCOUNT_ACQUISITION_FIELD])
      const owned = await countOf(() =>
        firebaseAdmin.app().firestore().collection('orgs').where('ownerUid', '==', owner.uid),
      )
      await notifyStaff(
        {
          type: 'staff.orgCreated',
          title: `New workspace: ${name}`,
          body:
            `${owner.email ?? 'An account'} created ${name} (/${slug}). ` +
            `${describeAccountAcquisition(acquisition, { primaryHost: homeHost() })}.`,
          link: buildRoute(Route.ADMIN_ORG_DETAIL, { orgId }),
        },
        {
          emailDetails: filled([
            { label: 'Workspace', value: `${name} (/${slug})` },
            { label: 'Owner', value: owner.email },
            { label: 'Owner name', value: owner.displayName },
            { label: 'Plan', value: planOf(org) },
            {
              label: 'Made from',
              value: via === 'first-site' ? 'Their first site' : via === 'workspace-page' ? 'The new workspace page' : null,
            },
            { label: 'Workspaces they own', value: owned === null ? null : owned.toLocaleString('en-US') },
            ...accountAcquisitionDetails(acquisition, { primaryHost: homeHost() }),
            { label: 'Workspace id', value: orgId },
          ]),
        },
      )
    }
  } catch (staffError) {
    console.error('staff new-workspace notification skipped', staffError)
  }

  // And tell the plugins (AGL-4038): one may be holding something for this
  // person until they had a workspace. Each handler is isolated and logged;
  // none can fail the creation.
  try {
    await runPluginEventHandlers('org.created', {
      orgId,
      owner: { uid: owner.uid, email: owner.email, emailVerified: owner.emailVerified === true },
      via: via ?? 'workspace-page',
    })
  } catch (eventError) {
    console.error('org.created handlers skipped', eventError)
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
  /** How it was started: the guided AI start, a starter design, the API, or a create that was resumed. */
  start?: 'guided-ai' | 'starter' | 'api' | 'resumed'
}

/**
 * A site was created (AGL-3491). The third growth event, after the account
 * and the workspace, and the one that says somebody actually started
 * building — so it is told to staff in the same category, switchable with
 * them.
 *
 * The body carries the site's live address as well as the staff page the
 * button opens, so whoever reads it can look at what was built in one click.
 * A site seconds old has no custom domain yet, so that address is always its
 * platform subdomain. The email's text blocks are linkified when rendered.
 */
export async function announceNewSite(site: NewSiteAnnouncement): Promise<void> {
  const { hostId, displayName, subdomain, orgSlug, createdBy, start } = site
  try {
    if (isSignupCanaryOrgSlug(orgSlug) || isSignupCanaryEmail(createdBy)) return
    const liveUrl = `https://${subdomain}.${TENANT_APEX}`
    const host = await readDoc('hosts', hostId)
    const orgId = text(host?.['orgId'])
    const org = await readDoc('orgs', orgId)
    const acquisition = readAccountAcquisition(org?.[ACCOUNT_ACQUISITION_FIELD])
    const sites = orgId
      ? await countOf(() => firebaseAdmin.app().firestore().collection('hosts').where('orgId', '==', orgId))
      : null
    const workspace = text(org?.['name'])
    await notifyStaff(
      {
        type: 'staff.siteCreated',
        title: `New site: ${displayName}`,
        body:
          `${createdBy ?? 'An account'} created ${displayName} (${subdomain})` +
          `${workspace ? ` in ${workspace}` : ''}.\nLive site: ${liveUrl}`,
        link: buildRoute(Route.ADMIN_SITE_DETAIL, { hostId }),
      },
      {
        emailDetails: filled([
          { label: 'Site', value: displayName },
          { label: 'Live site', value: liveUrl },
          { label: 'Workspace', value: workspace ? `${workspace}${orgSlug ? ` (/${orgSlug})` : ''}` : orgSlug },
          { label: 'Plan', value: planOf(org) },
          { label: 'Sites in the workspace', value: sites === null ? null : sites.toLocaleString('en-US') },
          {
            label: 'Started from',
            value:
              start === 'guided-ai'
                ? 'The guided AI start'
                : start === 'starter'
                  ? 'A starter design'
                  : start === 'api'
                    ? 'The API'
                    : start === 'resumed'
                      ? 'A create that was resumed'
                      : null,
          },
          { label: 'Created by', value: createdBy },
          { label: 'How they found us', value: acquisition ? describeAccountAcquisition(acquisition, { primaryHost: homeHost() }) : null },
          { label: 'Site id', value: hostId },
        ]),
      },
    )
  } catch (staffError) {
    console.error('staff new-site notification skipped', staffError)
  }
}
