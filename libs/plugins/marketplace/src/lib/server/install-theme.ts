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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { listingArtifactType } from '../model/marketplace'
import { canActAsPublisher } from './publisher-profile'
import { hasDivergedFromBase, recordInstallProvenance } from './provenance'
import { recordVersionMove } from './version-stats'

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
 */
export const installThemeHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const action = ['revert', 'reset', 'preview'].includes(req.body?.action)
    ? (req.body.action as 'revert' | 'reset' | 'preview')
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
      return res.status(403).json({ error: 'Not a site admin' })
    }
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
    const currentTheme = hostSnapshot.get('theme') ?? null

    // ---- reset: back to the platform default ----
    if (action === 'reset') {
      await hostRef.set(
        {
          // Kept, not dropped: resetting is reversible for the same reason
          // installing is, and someone who resets by mistake has otherwise
          // lost a theme that existed in no other document.
          themeReplaced: { theme: currentTheme, replacedAt: now },
          theme: firebaseAdmin.firestore.FieldValue.delete(),
          themeInstalledFrom: firebaseAdmin.firestore.FieldValue.delete(),
          themeOverride: firebaseAdmin.firestore.FieldValue.delete(),
          updatedAt: now,
        },
        { merge: true },
      )
      return res.status(200).json({ reset: true })
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
          updatedAt: now,
        },
        { merge: true },
      )
      return res.status(200).json({ reverted: true })
    }

    const listingRef = firestore.collection('marketplaceListings').doc(listingId)
    const listingSnapshot = await listingRef.get()
    const listing = listingSnapshot.data() as any
    if (
      !listing ||
      listing.deletedAt ||
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
    if (priceUsd > 0 && !ownsListing) {
      const purchases = await firestore
        .collection('marketplacePurchases')
        .where('buyerUid', '==', decoded.uid)
        .where('listingId', '==', listingId)
        .limit(1)
        .get()
      if (purchases.empty) {
        return res.status(402).json({ error: 'Purchase required', priceUsd })
      }
    }

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

    await hostRef.set(
      {
        theme,
        themeInstalledFrom: provenance.installedFrom,
        // Everything needed to put this site back exactly as it was, captured
        // BEFORE the write that changes it.
        themeReplaced: {
          theme: currentTheme,
          ...(hostSnapshot.get('themeInstalledFrom')
            ? { installedFrom: hostSnapshot.get('themeInstalledFrom') }
            : {}),
          ...(hostSnapshot.get('themeOverride')
            ? { override: hostSnapshot.get('themeOverride') }
            : {}),
          replacedAt: now,
        },
        // Overrides are NOT carried across a theme swap here — they were
        // authored against a different base, and silently reapplying a
        // component override written for another theme is how a site ends up
        // subtly wrong with no field to point at. AGL-1021 owns the offer to
        // keep them deliberately.
        themeOverride: firebaseAdmin.firestore.FieldValue.delete(),
        updatedAt: now,
      },
      { merge: true },
    )

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
