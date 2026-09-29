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

import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { describeTheme } from '@aglyn/aglyn/app-utils/marketplace-theme'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { runThemeLibraryAction } from '@aglyn/tenant-data-admin/server/theme-library-write'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import {
  isPrivateListing,
  listingArtifactType,
} from '../model/marketplace'
import { canActAsPublisher } from './publisher-profile'
import { requirePurchase } from './purchase-entitlement'
import { hasDivergedFromBase, recordInstallProvenance } from './provenance'
import { recordVersionMove } from './version-stats'
import { isPublisherSecurityLocked } from './sale-risk'

/**
 * Installs a marketplace theme onto a site (AGL-1020).
 *
 * Themes are the exception to "installing never changes a running site". A
 * template or a layout can land inert in a library because it is one thing
 * among many; a theme IS the site's appearance, and installing one into a
 * library where it does nothing would be a control that appears to work and
 * does not. So this writes `hosts/{hostId}.theme` and the site repaints.
 *
 * Which makes reversibility the requirement, not a nicety. Two things provide
 * it, and neither is a confirmation dialog:
 *
 * * The theme being replaced is kept verbatim in `themeReplaced`, so `revert`
 *   restores exactly what was there — including a hand-built theme that was
 *   never a marketplace artifact and exists nowhere else.
 * * `reset` clears the theme entirely, which is the "use the default theme"
 *   the issue asks to keep first-class. It is a distinct action from revert
 *   because "back to how it was" and "back to stock" are different intents and
 *   guessing between them is how people lose work.
 *
 * `preview` changes nothing and returns what the swap would do, so the
 * confirmation can name it rather than showing a JSON blob.
 *
 * Every action that writes the theme then drops the site's cached pages
 * (AGL-3386). The theme styles every page and nothing publishes it, so
 * without the drop "the site repaints" meant "within the hour".
 */
export const installThemeHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const action = ['revert', 'reset', 'preview', 'clear-overrides'].includes(
    req.body?.action,
  )
    ? (req.body.action as
        | 'revert'
        | 'reset'
        | 'preview'
        | 'clear-overrides')
    : 'install'
  const listingId = String(req.body?.listingId ?? '')
  if (!hostId || (action === 'install' && !listingId)) {
    return res.status(400).json({ error: 'Missing listingId or hostId' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const membership = await resolveOrgPermissions(decoded.uid, { hostId })
    if (!membership.permissions.installPlugins) {
      return res.status(403).json({
        error:
          'Your organization role does not allow installing from the marketplace',
      })
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return res.status(403).json({ error: 'Not a site admin or editor' })
    }
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
    const currentTheme = hostSnapshot.get('theme') ?? null
    // Awaited before the response, because a serverless function may be
    // frozen once it has answered. Never throws: a drop that fails leaves the
    // theme saved and the hour-long cache as the backstop.
    const repaintLiveSite = (action: string) =>
      dropPluginSiteCache({
        hostIds: [hostId],
        reason: `marketplace theme ${action}`,
      })

    // ---- reset: back to the platform default ----
    // Picking the default from the site's theme library (AGL-3404): the theme
    // being left is filed in the library, edits and all, so resetting stays
    // reversible without a second copy of it on the host.
    if (action === 'reset') {
      const plan = await firestore.runTransaction((tx) =>
        runThemeLibraryAction(tx, hostRef, {
          action: 'select',
          target: { kind: 'default' },
        }),
      )
      if (plan.ok === false) return res.status(plan.status).json({ error: plan.error })
      await repaintLiveSite('reset')
      return res.status(200).json({ reset: true })
    }

    // ---- clear-overrides: drop this site's changes, keep the theme ----
    // The third way back, and the narrowest: "reset to the publisher's
    // version" is deleting the patch — the whole point of owning the patch
    // rather than the copy (AGL-1019). The theme itself is untouched.
    //
    // The library's `restore`, which keeps the site's own dark-scheme setting
    // (AGL-3404): that is a decision about the site, not an edit to the theme.
    if (action === 'clear-overrides') {
      const plan = await firestore.runTransaction((tx) =>
        runThemeLibraryAction(tx, hostRef, { action: 'restore' }),
      )
      if (plan.ok === false) return res.status(plan.status).json({ error: plan.error })
      await repaintLiveSite('overrides cleared')
      return res.status(200).json({ cleared: true })
    }

    // ---- revert: back to whatever this site had before the last swap ----
    if (action === 'revert') {
      const replaced = hostSnapshot.get('themeReplaced')
      if (!replaced) {
        return res.status(409).json({
          error: 'There is no previous theme to go back to on this site.',
        })
      }
      await hostRef.set(
        {
          theme: replaced.theme ?? firebaseAdmin.firestore.FieldValue.delete(),
          ...(replaced.installedFrom
            ? { themeInstalledFrom: replaced.installedFrom }
            : { themeInstalledFrom: firebaseAdmin.firestore.FieldValue.delete() }),
          // The overrides that were live alongside that theme come back with
          // it. Reverting the base and keeping a patch authored against the
          // theme being reverted FROM is the one combination nobody asked for.
          ...(replaced.override
            ? { themeOverride: replaced.override }
            : { themeOverride: firebaseAdmin.firestore.FieldValue.delete() }),
          themeReplaced: firebaseAdmin.firestore.FieldValue.delete(),
          // A `themeReplaced` predates the library (every library switch
          // clears it), so the theme it restores is read the way a
          // pre-library site's is — from the fields above, not a selection.
          themeSelection: firebaseAdmin.firestore.FieldValue.delete(),
          updatedAt: now,
        },
        { merge: true },
      )
      await repaintLiveSite('reverted')
      return res.status(200).json({ reverted: true })
    }

    const listingRef = firestore.collection('marketplaceListings').doc(listingId)
    const listingSnapshot = await listingRef.get()
    const listing = listingSnapshot.data() as any
    if (
      !listing ||
      listing.deletedAt ||
      // Staff takedown blocks new installs on EVERY artifact type
      // (AGL-2290). AGL-948 extended takedown past plugins in the browse
      // predicate and in `resolveMarketplacePluginVersion`, but the gate that
      // decides whether content is HANDED OVER was only ever added to
      // `install-plugin.ts`. So a component, theme, template, layout, email
      // template or dataset schema that staff had taken down stayed
      // installable by anyone holding its listing id — which makes takedown a
      // suggestion for six of the seven artifact types.
      //
      // No owner exemption, matching `install-plugin.ts`: a takedown is a
      // moderation decision about the artifact, not about who is asking.
      listing.hiddenAt ||
      // A publisher under a SECURITY lock hands nothing over (AGL-3365).
      (await isPublisherSecurityLocked(firestore, listing.profileId)) ||
      listingArtifactType(listing) !== 'theme'
    ) {
      return res.status(404).json({ error: 'Unknown theme' })
    }

    const priceUsd = Number(listing.priceUsd ?? 0)
    const ownsListing = await canActAsPublisher(
      firestore,
      decoded.uid,
      listing.profileId,
    )
    // Private listings install ONLY for the owning org (AGL-2290).
    //
    // `install-plugin.ts` has carried this since AGL-968; the other six never
    // did, so a private component, theme, template, layout, email template or
    // dataset schema was installable by anyone who knew its listing id. Browse
    // hides them and the detail page 404s, but neither is a control — the
    // route is.
    if (isPrivateListing(listing) && !ownsListing) {
      return res.status(404).json({ error: 'Unknown listing' })
    }
    // A FULLY refunded purchase stops entitling (AGL-1546), and until
    // AGL-1699 only the component route knew that: this one asked whether a
    // purchase doc EXISTED, so buy/install/refund kept the artifact. The
    // predicate lives in one place now so the next route cannot miss it.
    const unpaid = await requirePurchase({
      firestore,
      buyerUid: decoded.uid,
      // THE ORG THE LICENCE HAS TO COVER (AGL-2331). `membership.orgId` is
      // resolved server-side from the caller's own membership by the
      // permission gate above — never a request-body field — so this is the
      // workspace the install actually lands in, and the only one a purchase
      // can entitle here.
      buyerOrgId: membership.orgId ?? '',
      listingId,
      priceUsd,
      ownsListing,
    })
    if (unpaid) return res.status(402).json(unpaid)

    const versionSnapshot = await listingRef
      .collection('versions')
      .doc(String(listing.latestVersion))
      .get()
    const theme = versionSnapshot.get('theme')
    if (!theme || !Object.keys(theme).length) {
      return res.status(500).json({ error: 'Theme version missing' })
    }

    // ---- preview: say what the swap changes, change nothing ----
    if (action === 'preview') {
      return res.status(200).json({
        incoming: describeTheme(theme),
        current: describeTheme(currentTheme),
        // A site with no theme is on the platform default, so there is nothing
        // to lose and the confirmation should not imply there is.
        replaces: Boolean(currentTheme && Object.keys(currentTheme).length),
        version: listing.latestVersion ?? null,
      })
    }

    // ---- install ----
    // Replacing a theme the workspace has edited destroys those edits (AGL-1018).
    // Unlike a component this is not recoverable by looking in a library — the
    // theme lives on one field on one document — so the refusal matters more.
    const diverged = await hasDivergedFromBase({
      firestore,
      sha256: hostSnapshot.get('themeInstalledFrom.sha256'),
      current: currentTheme,
    })
    if (diverged && req.body?.mode !== 'replace') {
      return res.status(409).json({
        error:
          'This site’s theme has been edited since it was installed. Review ' +
          'the update to see what would change.',
        diverged: true,
      })
    }

    const provenance = await recordInstallProvenance({
      firestore,
      listingId,
      listing,
      version: listing.latestVersion,
      artifactType: 'theme',
      content: theme,
    })
    const previousVersion =
      hostSnapshot.get('themeInstalledFrom.version') ?? null

    // The theme joins the site's library and is picked (AGL-3404). The theme
    // it replaces is filed in the library with its edits, so installing is
    // reversible by picking it again — the job `themeReplaced` used to do
    // for one theme, for every theme.
    //
    // Edits belong to the theme they were made on. They used to SURVIVE a
    // swap (AGL-1021), because the theme being replaced was about to exist
    // nowhere and carrying its patch forward was the lesser loss. With the
    // library keeping it, a patch tuned for one design no longer lands on
    // another: each theme gets its own back when it is picked again. An
    // UPDATE of the theme already picked keeps its patch exactly as stored,
    // hash included, so the editor can still say it predates this version.
    const plan = await firestore.runTransaction((tx) =>
      runThemeLibraryAction(tx, hostRef, {
        action: 'install',
        listingId,
        name: String(listing.displayName ?? '') || 'Marketplace theme',
        theme,
        installedFrom: { ...provenance.installedFrom },
      }),
    )
    if (plan.ok === false) return res.status(plan.status).json({ error: plan.error })

    await repaintLiveSite('installed')

    await recordVersionMove({
      firestore,
      listingRef,
      artifactType: 'theme',
      from: previousVersion,
      to: listing.latestVersion,
    })
    await listingRef
      .update({
        installCount: firebaseAdmin.firestore.FieldValue.increment(1),
      })
      .catch(() => undefined)

    return res.status(200).json({
      installed: true,
      version: listing.latestVersion ?? null,
      baseStored: provenance.baseStored,
      applied: describeTheme(theme),
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Theme install failed' })
  }
}

export default installThemeHandler
