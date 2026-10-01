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
  checkDatasetQuota,
  checkEntitlement,
  createResourceUid,
  defaultScopeForNewResource,
  newResourceScopeFields,
  scopeCovers,
} from '@aglyn/aglyn/server'
import type {
  ArtifactInstallRequest,
  ArtifactLocateRequest,
  ArtifactRefusal,
  ArtifactSnapshot,
  ArtifactSnapshotRequest,
  ArtifactWorkspace,
  InstalledArtifactCopy,
  PluginArtifactOwner,
  PreparedArtifactInstall,
} from '@aglyn/aglyn/plugin-manager/plugin-artifact-types'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  resolveInstalledDatasetSchema,
  sanitizeDatasetSchema,
  summarizeSchemaChange,
  type PublishedDatasetSchema,
} from './dataset-schema'

/**
 * A dataset's schema as an installable artifact (AGL-657), answered by the
 * plugin that keeps datasets (AGL-3080).
 *
 * The installer (the marketplace) owns the listing, who may act on it, the
 * purchase, the provenance stamp and the tally, and asks these four answers
 * for everything that touches `orgs/{orgId}/datasets`, which it never reads.
 * Registered from `declarations.console-server.ts` and loaded with the first
 * publish, install or update.
 */

const refuse = (status: number, error: string): ArtifactRefusal => ({
  ok: false,
  status,
  error,
})

const datasetsOf = (orgId: string) =>
  firebaseAdmin.app().firestore().collection('orgs').doc(orgId).collection('datasets')

const overDatasetQuota = (limit: number): ArtifactRefusal =>
  refuse(403, `Dataset limit reached (${limit}) — see Billing to upgrade.`)

/**
 * PUBLISHING: an org dataset's SCHEMA, reduced to what travels.
 *
 * Datasets live at `orgs/{orgId}/datasets/{id}` and are org-shared (AGL-237),
 * so the source is named by the publishing org and the dataset's id.
 *
 * Records NEVER travel: `sanitizeDatasetSchema` reads the model, and nothing
 * here touches the `records` subcollection. A dataset's rows are the org's
 * customer data; only the shape is publishable.
 */
export async function snapshotDatasetSchema(
  request: ArtifactSnapshotRequest,
): Promise<ArtifactSnapshot | ArtifactRefusal> {
  const datasets = datasetsOf(request.orgId)
  const datasetSnapshot = await datasets.doc(request.sourceId).get()
  const dataset = datasetSnapshot.data() as any
  if (!datasetSnapshot.exists || dataset?.deletedAt) {
    return refuse(404, 'Unknown dataset')
  }
  // v1 datasets carry a flat `fields: string[]` with no model; publish the
  // derived shape so unmigrated datasets are publishable too (AGL-102 shim,
  // inlined rather than importing core's deriveModelFromFields to keep the
  // sanitizer's input one plain shape).
  const model = dataset?.model?.fields
    ? dataset.model
    : {
        fields: Object.fromEntries(
          (Array.isArray(dataset?.fields) ? dataset.fields : []).map(
            (name: unknown) => [String(name), { name: String(name), type: 'text' }],
          ),
        ),
        order: (Array.isArray(dataset?.fields) ? dataset.fields : []).map(String),
      }

  const sanitized = sanitizeDatasetSchema(model)
  if (sanitized.ok === false) return refuse(422, sanitized.error)

  // Reference fields name a dataset id that means nothing outside this org,
  // so resolve each target's display name now: the installer relinks by that
  // label (see resolveInstalledDatasetSchema).
  const referenced = new Set(
    Object.values(sanitized.schema.fields)
      .map((field) => field.reference?.datasetId)
      .filter((id): id is string => Boolean(id)),
  )
  if (referenced.size) {
    const labels = new Map<string, string>()
    await Promise.all(
      [...referenced].map(async (id) => {
        const snapshot = await datasets.doc(id).get()
        const label = snapshot.get('displayName')
        if (label) labels.set(id, String(label))
      }),
    )
    for (const field of Object.values(sanitized.schema.fields)) {
      const target = field.reference?.datasetId
      if (target && labels.has(target)) {
        field.reference = {
          ...field.reference,
          datasetLabel: labels.get(target),
        }
      }
    }
  }
  return {
    ok: true,
    content: sanitized.schema,
    facts: { fieldCount: sanitized.schema.order.length },
  }
}

/** INSTALLING, before the listing is read: datasets are a plan feature. */
export async function admitsDatasetSchema(
  workspace: ArtifactWorkspace,
): Promise<ArtifactRefusal | null> {
  if (!checkEntitlement(workspace.org as any, 'dataStore')) {
    return refuse(403, 'Datasets require a Starter plan or higher')
  }
  return null
}

/**
 * INSTALLING: a NEW, EMPTY dataset made from the published model.
 *
 * Installing never merges into an existing dataset, because a schema change
 * on a dataset that already holds rows would silently reinterpret live data.
 * Re-installing makes another dataset rather than replacing one, for the same
 * reason.
 *
 * Nothing is written until `commit`, which the installer calls once it has
 * recorded the provenance of exactly the content prepared here.
 */
export async function prepareDatasetSchemaInstall(
  request: ArtifactInstallRequest,
): Promise<PreparedArtifactInstall | ArtifactRefusal> {
  const published = request.published as PublishedDatasetSchema | undefined
  if (!published?.order?.length) {
    return refuse(500, 'Dataset schema version missing')
  }
  const org = request.org as any
  const datasetsRef = datasetsOf(request.orgId)

  // Creating a dataset consumes org quota exactly like the console's own
  // create path (AGL-473): installing must not be a way around it.
  // Deliberately counts EVERY dataset the org owns, not the visible ones
  // (AGL-1046). Scoping decides who can see a dataset, never who pays for
  // it: the org owns all of them. Counting per scope would also make a
  // collaborator's remaining quota disagree with the admin's.
  //
  // This is the early answer, so a workspace already at its cap is refused
  // before the installer records any provenance. The one that holds is in
  // `commit`, below.
  const datasets = await datasetsRef.get()
  const quota = checkDatasetQuota(org, datasets.size)
  if (!quota.allowed) return overDatasetQuota(quota.limit)

  /**
   * Who the new dataset is shared with. Decided before relinking, because
   * it also decides what a reference field may point at.
   *
   * A dataset schema installs at ORGANIZATION scope and nowhere else
   * (`INSTALL_TARGETS.datasetSchema`), from the organization Marketplace, the
   * one surface that installs anything. The site that surface acts THROUGH
   * only finds the org: the org's first site, not a site anyone is working
   * in, and it never reaches here. So no site is in context, and the dataset
   * starts where a create on an organization page starts: All sites, whatever
   * the org's Default sharing says. Honoring the acting site instead would
   * hide the dataset from every other site, under an install dialog that
   * says it lands on "the whole organization — every site" (AGL-2891).
   */
  const visibleTo = defaultScopeForNewResource({
    defaultResourceScope: org?.defaultResourceScope,
    hostId: null,
  })

  // Relink reference fields onto this org's datasets by display name; what
  // can't be relinked degrades to text and is reported to the installer.
  // A candidate has to be visible everywhere the new dataset is, which is
  // the rule every reference answers to (`scopeCovers`, AGL-1044): one
  // pointing at a dataset some of those sites cannot see resolves to nothing
  // there, and nothing says why. That is also what keeps an install from
  // binding its reference fields to an agency's internal dataset of the same
  // name (AGL-1046): the display-name collision AGL-1039 fixed on the render
  // path, arriving here instead.
  const byLabel: Record<string, string> = {}
  for (const entry of datasets.docs) {
    if (!scopeCovers(entry.get('visibleTo'), visibleTo)) continue
    const label = String(entry.get('displayName') ?? '').toLowerCase()
    if (label && !byLabel[label]) byLabel[label] = entry.id
  }
  const { schema, degradedFieldIds } = resolveInstalledDatasetSchema(
    published,
    byLabel,
  )
  const datasetId = createResourceUid()
  const { listing } = request

  return {
    ok: true,
    // The RELINKED schema, not the published one, is what the base snapshot
    // records (AGL-1015): relinking rewrites reference fields onto this org's
    // datasets, so a base holding the publisher's ids would report every
    // relinked field as a user edit the moment anything is diffed.
    content: schema,
    /**
     * THE ENFORCEMENT POINT (AGL-3454, the AGL-2371 treatment): the count,
     * the decision and the create in ONE transaction.
     *
     * The count above is taken before the installer awaits the provenance
     * write, and every await is a yield: N installs in flight each read the
     * same pre-count, each find room, and each land, and nothing re-counts
     * afterwards. `tx.get` on the aggregate takes a pessimistic lock on the
     * documents the query matched, so the loser of a race retries, re-reads
     * the higher count and is refused, having written nothing.
     *
     * The org document is read outside, as the console's create path reads
     * it: the plan and the purchased add-ons are not client-writable, so
     * locking it would buy contention rather than correctness.
     */
    commit: async (stamp) => {
      const refused = await firebaseAdmin
        .app()
        .firestore()
        .runTransaction<ArtifactRefusal | null>(async (tx) => {
          const live = (await tx.get(datasetsRef.count())).data().count
          const authoritative = checkDatasetQuota(org, live)
          if (!authoritative.allowed) return overDatasetQuota(authoritative.limit)
          tx.create(datasetsRef.doc(datasetId), {
            displayName: String(listing.displayName ?? 'Dataset').slice(0, 120),
            ...(listing.description ? { description: listing.description } : {}),
            // `fields` is the v1 flat list the older editor still reads; keep it
            // in step with the model so both readers agree (AGL-102).
            fields: schema.order,
            model: schema,
            source: stamp.source,
            installedFrom: stamp.installedFrom,
            // The scope decided above. Stamping it is not optional: a dataset
            // with no `visibleTo` matches no scoped read and would render on no
            // site at all.
            //
            // Through the AGL-1478 gate since AGL-1484, so "every other dataset
            // creator" is a fact about the type rather than about four object
            // literals that happen to agree today.
            ...newResourceScopeFields(visibleTo),
            createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          })
          return null
        })
      if (refused) return refused
      return {
        ok: true,
        report: { datasetId, fields: schema.order.length, degradedFieldIds },
      }
    },
  }
}

/**
 * UPDATING: the dataset a listing installed in the site's organization, and
 * what taking the version on offer would do to its records (AGL-1018).
 *
 * The incoming schema is relinked onto THIS org's datasets exactly as install
 * does. The base holds the relinked shape, so diffing the published one would
 * report every reference field as a user edit.
 *
 * A dataset's update is a merge or nothing. Its "new copy" would be a whole
 * new dataset, which consumes org quota and lands empty: exactly what the
 * install already does, with the quota check an update does not have.
 */
export async function locateInstalledDatasetSchema(
  request: ArtifactLocateRequest,
): Promise<InstalledArtifactCopy | ArtifactRefusal> {
  if (!request.orgId) return refuse(404, 'Site has no owning organization')
  const datasets = await datasetsOf(request.orgId).get()
  const doc = datasets.docs.find(
    (entry) =>
      entry.get('source.listingId') === request.listingId && !entry.get('deletedAt'),
  )
  if (!doc) return refuse(404, 'Not installed in this organization')
  const byLabel: Record<string, string> = {}
  for (const entry of datasets.docs) {
    const label = String(entry.get('displayName') ?? '').toLowerCase()
    if (label && !byLabel[label]) byLabel[label] = entry.id
  }
  const { schema } = resolveInstalledDatasetSchema(
    request.published as PublishedDatasetSchema,
    byLabel,
  )
  const current = doc.get('model') ?? { order: doc.get('fields') ?? [], fields: {} }
  const summary = summarizeSchemaChange(current as any, schema as any)
  // The count is read for the preview, not estimated: "3 fields will be
  // removed" means nothing without "from 1,240 records".
  const records = await doc.ref
    .collection('records')
    .count()
    .get()
    .catch(() => null)
  const recordCount = records?.data().count ?? 0
  return {
    ok: true,
    current,
    incoming: schema,
    installedVersion:
      String(doc.get('installedFrom.version') ?? doc.get('source.version') ?? '') || null,
    baseSha: doc.get('installedFrom.sha256') ?? null,
    // A schema change that removes or retypes a field reinterprets rows that
    // already exist. It is applicable, but never without the caller having
    // been told the count and said yes to it specifically.
    impact: {
      preview: {
        schema: {
          added: summary.added,
          removed: summary.removed,
          retyped: summary.retyped,
          additiveOnly: summary.additiveOnly,
          recordCount,
        },
      },
      destructive: !summary.additiveOnly,
      refusal:
        `This update removes or retypes ${
          summary.removed.length + summary.retyped.length
        } field(s) on a dataset holding ${recordCount} record(s).`,
    },
    apply: async ({ content, stamp }) => {
      await doc.ref.set(
        {
          model: content,
          // The v1 flat list the older editor still reads, kept in step.
          fields: (content as PublishedDatasetSchema | undefined)?.order ?? [],
          installedFrom: stamp.installedFrom,
          source: stamp.source,
          updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    },
  }
}

/** The four answers, as the owner registers them. */
export const datasetSchemaArtifactOwner: PluginArtifactOwner = {
  snapshot: snapshotDatasetSchema,
  admits: admitsDatasetSchema,
  prepare: prepareDatasetSchemaInstall,
  locate: locateInstalledDatasetSchema,
}
