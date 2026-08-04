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

import { createResourceUid, type PluginApiHandler } from '@aglyn/aglyn/server'
import {
  applyArtifactUpdate,
  planArtifactUpdate,
  summarizeSchemaChange,
  type ArtifactChange,
  type ArtifactUpdatePlan,
} from '@aglyn/aglyn/app-utils/marketplace-merge'
import { ARTIFACT_BASE_COLLECTION } from '@aglyn/aglyn/app-utils/marketplace-provenance'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import {
  listingArtifactType,
  resolveInstalledDatasetSchema,
} from '../model/marketplace'
import { recordInstallProvenance } from './provenance'
import { recordVersionMove } from './version-stats'

/**
 * Updating a COPIED marketplace artifact (AGL-1018).
 *
 * The install routes update by overwriting: a component re-install writes the
 * publisher's tree straight over the workspace's copy, and a template or layout
 * re-install soft-deletes the previous bundle. Both are silent, and both throw
 * away work the customer did after installing.
 *
 * This route never overwrites without saying what will be lost. `preview`
 * classifies every field against AGL-1015's base snapshot and returns the plan;
 * `apply` writes only what the plan (and, for conflicts, the caller) chose.
 * There are two ways to take a new version and both are safe:
 *
 * * **merge** — take the publisher's changes to fields nobody here edited, keep
 *   this workspace's edits, and overwrite a contested field only when it was
 *   explicitly picked.
 * * **copy** — install the new version fresh and DETACH the customised copy,
 *   which keeps it as an ordinary workspace artifact rather than deleting it.
 *
 * Without a base snapshot only `copy` is offered. Inventing an origin to diff
 * against is how a merge becomes confidently wrong.
 */

type Mode = 'merge' | 'copy'

/** What a preview tells the client, and what the dialog renders. */
interface UpdatePreview {
  artifactType: string
  installedVersion: string | null
  availableVersion: string | null
  /** A three-way merge is possible: a base snapshot exists and the type supports it. */
  mergeable: boolean
  /** Why not, when it isn't. */
  reason?: string
  safe: ArtifactChange[]
  kept: ArtifactChange[]
  conflicts: ArtifactChange[]
  unchanged: number
  identical: boolean
  /** Dataset schemas only: what the change does to existing records. */
  schema?: {
    added: string[]
    removed: string[]
    retyped: string[]
    additiveOnly: boolean
    recordCount: number
  }
}

/** Everything the route needs to diff and write one copied artifact. */
interface Target {
  ref: FirebaseFirestore.DocumentReference
  /** The copy as it is now, in the same shape the base snapshot holds. */
  current: unknown
  /** Fields to write alongside merged content. */
  write: (content: any) => Record<string, unknown>
  /** Fields that detach this copy from its listing, for `copy` mode. */
  detach?: Record<string, unknown>
}

const trimChanges = (changes: ArtifactChange[]): ArtifactChange[] =>
  // The dialog lists changes; a 400-node tree that changed wholesale would
  // otherwise ship its entire content twice through a JSON response.
  changes.slice(0, 200)

export const updateArtifactHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const listingId = String(req.body?.listingId ?? '')
  const hostId = String(req.body?.hostId ?? '')
  const action = req.body?.action === 'apply' ? 'apply' : 'preview'
  const mode: Mode = req.body?.mode === 'copy' ? 'copy' : 'merge'
  const takePaths: string[] = Array.isArray(req.body?.takePaths)
    ? req.body.takePaths.map((path: unknown) => String(path))
    : []
  const confirmDestructive = Boolean(req.body?.confirmDestructive)
  if (!listingId || !hostId) {
    return res.status(400).json({ error: 'Missing listingId or hostId' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    // The same gate installing uses: taking a new version of something is
    // installing it, and a role that cannot install must not be able to
    // rewrite an installed artifact through a different door.
    const membership = await resolveOrgPermissions(decoded.uid, { hostId })
    if (!membership.permissions.installPlugins) {
      return res.status(403).json({
        error: 'Your organization role does not allow installing from the marketplace',
      })
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }

    const listingRef = firestore.collection('marketplaceListings').doc(listingId)
    const listingSnapshot = await listingRef.get()
    const listing = listingSnapshot.data() as any
    if (!listing || listing.deletedAt) {
      return res.status(404).json({ error: 'Unknown listing' })
    }
    const artifactType = listingArtifactType(listing)
    if (artifactType === 'plugin') {
      // Plugins are pinned, not copied: an update moves a pointer at immutable
      // bytes (AGL-1017) and has nothing to merge.
      return res.status(400).json({
        error: 'Plugins update by re-pinning — use the install route',
      })
    }

    const versionSnapshot = await listingRef
      .collection('versions')
      .doc(String(listing.latestVersion))
      .get()
    if (!versionSnapshot.exists) {
      return res.status(404).json({ error: 'Listing version missing' })
    }
    const availableVersion =
      listing.latestVersion == null ? null : String(listing.latestVersion)

    const orgId = (await getOrgForHost(hostId))?.orgId ?? ''

    /** The installed copy, the base it was installed from, and the offer. */
    let target: Target | null = null
    let incoming: unknown = null
    let installedVersion: string | null = null
    let baseSha: string | null = null
    let notMergeable: string | undefined
    let schemaSummary: UpdatePreview['schema']

    if (artifactType === 'component') {
      const existing = await hostRef
        .collection('components')
        .where('marketplace.listingId', '==', listingId)
        .limit(1)
        .get()
      const doc = existing.docs.find((entry) => !entry.get('deletedAt'))
      if (!doc) return res.status(404).json({ error: 'Not installed on this site' })
      const version = versionSnapshot.data() as any
      incoming = { rootId: version.rootId, nodes: version.nodes }
      installedVersion = String(
        doc.get('installedFrom.version') ?? doc.get('marketplace.version') ?? '',
      ) || null
      baseSha = doc.get('installedFrom.sha256') ?? null
      target = {
        ref: doc.ref,
        current: { rootId: doc.get('rootId'), nodes: doc.get('nodes') },
        write: (content) => ({
          rootId: content?.rootId ?? null,
          nodes: content?.nodes ?? {},
        }),
        // Detaching keeps the customised component as an ordinary one: it stays
        // on every page that uses it, and only stops being tracked against the
        // listing — which is what makes "install as a new copy" non-destructive
        // without leaving two documents claiming to be the same install.
        detach: {
          marketplace: firebaseAdmin.firestore.FieldValue.delete(),
          detachedFrom: { listingId, version: installedVersion },
        },
      }
    } else if (artifactType === 'layout') {
      const existing = await hostRef
        .collection('templates')
        .where('source.listingId', '==', listingId)
        .get()
      const doc = existing.docs.find(
        (entry) => !entry.get('deletedAt') && entry.get('kind') === 'layout',
      )
      if (!doc) return res.status(404).json({ error: 'Not installed on this site' })
      const layout = versionSnapshot.get('layout') as any
      incoming = { rootId: layout?.rootId, nodes: layout?.nodes }
      installedVersion = String(
        doc.get('installedFrom.version') ?? doc.get('source.version') ?? '',
      ) || null
      baseSha = doc.get('installedFrom.sha256') ?? null
      target = {
        ref: doc.ref,
        current: { rootId: doc.get('rootId'), nodes: doc.get('nodes') },
        write: (content) => ({
          rootId: content?.rootId ?? null,
          nodes: content?.nodes ?? {},
        }),
        detach: {
          source: { type: 'workspace' },
          detachedFrom: { listingId, version: installedVersion },
        },
      }
    } else if (artifactType === 'datasetSchema') {
      if (!orgId) {
        return res.status(404).json({ error: 'Site has no owning organization' })
      }
      const orgRef = firestore.collection('orgs').doc(orgId)
      const datasets = await orgRef.collection('datasets').get()
      const doc = datasets.docs.find(
        (entry) =>
          entry.get('source.listingId') === listingId && !entry.get('deletedAt'),
      )
      if (!doc) {
        return res.status(404).json({ error: 'Not installed in this organization' })
      }
      // Relink the incoming schema onto THIS org's datasets exactly as install
      // does — the base holds the relinked shape, so diffing the published one
      // would report every reference field as a user edit.
      const byLabel: Record<string, string> = {}
      for (const entry of datasets.docs) {
        const label = String(entry.get('displayName') ?? '').toLowerCase()
        if (label && !byLabel[label]) byLabel[label] = entry.id
      }
      const { schema } = resolveInstalledDatasetSchema(
        versionSnapshot.get('datasetSchema') as any,
        byLabel,
      )
      incoming = schema
      installedVersion = String(
        doc.get('installedFrom.version') ?? doc.get('source.version') ?? '',
      ) || null
      baseSha = doc.get('installedFrom.sha256') ?? null
      const current = doc.get('model') ?? { order: doc.get('fields') ?? [], fields: {} }
      const summary = summarizeSchemaChange(current as any, schema as any)
      // The count is read for the preview, not estimated: "3 fields will be
      // removed" means nothing without "from 1,240 records".
      const records = await doc.ref
        .collection('records')
        .count()
        .get()
        .catch(() => null)
      schemaSummary = {
        added: summary.added,
        removed: summary.removed,
        retyped: summary.retyped,
        additiveOnly: summary.additiveOnly,
        recordCount: records?.data().count ?? 0,
      }
      target = {
        ref: doc.ref,
        current,
        write: (content) => ({
          model: content,
          // The v1 flat list the older editor still reads, kept in step.
          fields: content?.order ?? [],
        }),
      }
    } else if (artifactType === 'theme') {
      // A theme lives on the host document itself, so there is no artifact doc
      // to look up and no "not installed on this site" — the site either runs
      // this listing's theme or it does not.
      if (hostSnapshot.get('themeInstalledFrom.listingId') !== listingId) {
        return res.status(404).json({ error: 'Not installed on this site' })
      }
      incoming = versionSnapshot.get('theme') ?? {}
      installedVersion =
        String(hostSnapshot.get('themeInstalledFrom.version') ?? '') || null
      baseSha = hostSnapshot.get('themeInstalledFrom.sha256') ?? null
      target = {
        ref: hostRef,
        current: hostSnapshot.get('theme') ?? {},
        write: (content) => ({ theme: content ?? {} }),
        // No `detach`: a site has exactly one theme, so "install as a separate
        // copy" has nowhere to put the second one. Merge is the only safe way
        // to take a theme update, and the preview says so.
      }
    } else if (artifactType === 'template') {
      // A published template bundle's screens carry no stable identity — only a
      // displayName and a slug — so there is nothing to pair an old screen to a
      // new one by. Any merge would be a guess dressed up as a diff.
      notMergeable =
        'Template bundles have no stable per-screen identity, so their screens ' +
        'cannot be matched across versions. Installing the new version replaces ' +
        'this bundle in your Templates library — pages you already created from ' +
        'the old templates are ordinary screens and are untouched.'
    } else if (artifactType === 'emailTemplate') {
      // Already safe by construction: an email template installs as an inactive
      // draft version, so taking a new one changes nothing that is being sent.
      notMergeable =
        'Email templates install as a draft version and never replace what your ' +
        'site is sending. Add the new version as another draft, then activate ' +
        'it when you are ready.'
    }

    if (notMergeable) {
      const preview: UpdatePreview = {
        artifactType,
        installedVersion: null,
        availableVersion,
        mergeable: false,
        reason: notMergeable,
        safe: [],
        kept: [],
        conflicts: [],
        unchanged: 0,
        identical: false,
      }
      return res.status(200).json({ preview })
    }
    if (!target) {
      return res.status(404).json({ error: 'Nothing installed to update' })
    }

    const baseSnapshot = baseSha
      ? await firestore
          .collection(ARTIFACT_BASE_COLLECTION)
          .doc(baseSha)
          .get()
          .catch(() => null)
      : null
    const base = baseSnapshot?.exists ? baseSnapshot.get('content') : undefined
    const mergeable = base !== undefined

    let plan: ArtifactUpdatePlan | null = null
    if (mergeable) plan = planArtifactUpdate(base, target.current, incoming)

    if (action === 'preview') {
      const preview: UpdatePreview = {
        artifactType,
        installedVersion,
        availableVersion,
        mergeable,
        ...(mergeable
          ? {}
          : {
              reason:
                'This was installed before update tracking recorded an ' +
                'original, so there is no way to tell your changes from the ' +
                'publisher’s. Installing the new version as a separate copy ' +
                'keeps yours intact.',
            }),
        safe: trimChanges(plan?.safe ?? []),
        kept: trimChanges(plan?.kept ?? []),
        conflicts: trimChanges(plan?.conflicts ?? []),
        unchanged: plan?.unchanged ?? 0,
        identical: plan?.identical ?? false,
        ...(schemaSummary ? { schema: schemaSummary } : {}),
      }
      return res.status(200).json({ preview })
    }

    // ---- apply ----
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()

    if (mode === 'merge') {
      if (!plan) {
        return res.status(409).json({
          error:
            'No original snapshot for this install — it can only be taken as a new copy',
        })
      }
      // A schema change that removes or retypes a field reinterprets rows that
      // already exist. It is applicable, but never without the caller having
      // been told the count and said yes to it specifically.
      if (schemaSummary && !schemaSummary.additiveOnly && !confirmDestructive) {
        return res.status(409).json({
          error:
            `This update removes or retypes ${
              schemaSummary.removed.length + schemaSummary.retyped.length
            } field(s) on a dataset holding ${schemaSummary.recordCount} record(s).`,
          needsConfirmation: true,
          schema: schemaSummary,
        })
      }
      const merged = applyArtifactUpdate(plan, target.current, { takePaths })
      const provenance = await recordInstallProvenance({
        firestore,
        listingId,
        listing,
        version: listing.latestVersion,
        artifactType: artifactType as never,
        // The base for NEXT time is the publisher's version, not the merged
        // result: the base answers "what did the publisher ship", and seeding
        // it with the merge would quietly launder this update's kept edits into
        // the publisher's column, where the next update could take them away.
        content: incoming,
      })
      await target.ref.set(
        {
          ...target.write(merged.content),
          // A theme is a FIELD on the host document, not a document of its own,
          // so it namespaces its provenance (`themeInstalledFrom`) and has no
          // legacy `source`/`marketplace` pair — writing those here would put a
          // stray marketplace stamp on the host itself, where `resolveProvenance`
          // would later read it as the host being an installed artifact.
          ...(artifactType === 'theme'
            ? { themeInstalledFrom: provenance.installedFrom }
            : {
                installedFrom: provenance.installedFrom,
                // The legacy per-type version fields the console still reads.
                ...(artifactType === 'component'
                  ? {
                      marketplace: {
                        listingId,
                        profileId: listing.profileId ?? null,
                        version: listing.latestVersion ?? null,
                      },
                    }
                  : {
                      source: {
                        type: 'marketplace' as const,
                        listingId,
                        version: listing.latestVersion ?? null,
                      },
                    }),
              }),
          updatedAt: now,
        },
        { merge: true },
      )
      // Per-version tally (AGL-1036): this install just moved versions, which
      // is the whole reason the per-version count exists.
      await recordVersionMove({
        firestore,
        listingRef,
        artifactType,
        from: installedVersion,
        to: availableVersion,
      })
      return res.status(200).json({
        updated: true,
        mode,
        version: availableVersion,
        applied: merged.applied.length,
        keptLocal: plan.kept.length,
        skipped: merged.skipped,
        baseStored: provenance.baseStored,
      })
    }

    // ---- copy ----
    if (!target.detach) {
      // Only types with a detachable link get a copy from here. A dataset's
      // "new copy" is a whole new dataset, which consumes org quota and lands
      // empty — exactly what the install route already does, with the quota
      // check this one does not have.
      return res.status(400).json({
        error:
          artifactType === 'theme'
            ? // A site has one theme, so there is no second place to put a
              // copy. Merging keeps this site's edits; the way back to the
              // previous theme is the install route's `revert`.
              'A site has only one theme, so this update can only be merged. ' +
              'Your edits to fields the publisher did not touch are kept.'
            : 'Install a fresh copy of this from the listing instead',
      })
    }
    // The customised copy is detached rather than deleted or overwritten: it
    // keeps working everywhere it is used, and only stops being the document
    // this listing updates. Without the detach two documents would claim the
    // same install and the next update would pick between them arbitrarily.
    const provenance = await recordInstallProvenance({
      firestore,
      listingId,
      listing,
      version: listing.latestVersion,
      artifactType: artifactType as never,
      content: incoming,
    })
    const batch = firestore.batch()
    if (target.detach) {
      batch.set(target.ref, { ...target.detach, updatedAt: now }, { merge: true })
    }
    const collectionRef = target.ref.parent
    const freshRef = collectionRef.doc(createResourceUid())
    const carried = (await target.ref.get()).data() ?? {}
    batch.set(freshRef, {
      // Everything that is not content travels from the copy being replaced —
      // the display name, description and kind — so the new one lands in the
      // same place in the same library rather than as an unrecognisable stub.
      ...(carried.kind ? { kind: carried.kind } : {}),
      displayName: String(listing.displayName ?? carried.displayName ?? 'Untitled'),
      ...(listing.description ? { description: listing.description } : {}),
      ...target.write(incoming),
      ...(artifactType === 'component'
        ? {
            marketplace: {
              listingId,
              profileId: listing.profileId ?? null,
              version: listing.latestVersion ?? null,
            },
          }
        : {
            source: {
              type: 'marketplace' as const,
              listingId,
              version: listing.latestVersion ?? null,
            },
          }),
      installedFrom: provenance.installedFrom,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    await batch.commit()
    // Per-version tally (AGL-1036). Still a move, not a second install: the
    // detached copy stops being tracked against the listing, so the version it
    // held is genuinely vacated.
    await recordVersionMove({
      firestore,
      listingRef,
      artifactType,
      from: installedVersion,
      to: availableVersion,
    })
    return res.status(200).json({
      updated: true,
      mode,
      version: availableVersion,
      newId: freshRef.id,
      detached: Boolean(target.detach),
      baseStored: provenance.baseStored,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Update failed' })
  }
}

export default updateArtifactHandler
