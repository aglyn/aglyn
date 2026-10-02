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
  SCREEN_KIND_TEMPLATE,
  checkEntitlement,
  hostCollectionKind,
  hostRoleCanPublish,
  pluginRequestFromWeb,
  type PluginWebApiHandler,
} from '@aglyn/aglyn/server'
import { listPluginSitemapSections } from '@aglyn/aglyn/plugin-manager/plugin-sitemap-sections'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  isServerReleaseFlagOnForOrg,
  lockdownRefusal,
} from '@aglyn/tenant-data-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { Timestamp } from 'firebase-admin/firestore'
import { announceDatasetRecords } from '../server/announce-dataset-records'
import { readRecordPageBindingsUncached, recordPagePathsOf } from './record-page-live-paths.server'
import { readSiteDataset } from './record-page-read.server'
import {
  DATASET_RECORD_PAGES_COLLECTION,
  type DatasetRecordPageBinding,
  RECORD_PAGES_MAX_PER_SITE,
  isRecordAddressField,
  normalizeRecordPageBase,
  recordPageBaseRefusal,
} from './record-pages'

/** The optional fields a binding may name, each one a field of the dataset. */
const OPTIONAL_FIELDS = [
  'titleField',
  'seoTitleField',
  'seoDescriptionField',
  'seoImageField',
] as const

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * The first segment of every route another plugin serves pages under on every
 * site, read off the sections they declare for the sitemap — `/products/{slug}`
 * is `products` — so a base cannot shadow a store without this plugin naming
 * one.
 */
function pluginRouteSegments(): string[] {
  return listPluginSitemapSections()
    .map((section) => section.path.split('/').filter(Boolean)[0] ?? '')
    .filter(Boolean)
}

/**
 * A site's record templates (AGL-3475), saved and removed — the only writer
 * of `hosts/{hostId}/recordPages`, which the rules close to every client.
 *
 * A binding decides which page serves `/{base}/…` for every record of a
 * dataset, so it is a routing decision and needs the PUBLISH role on the
 * site, as a redirect does. Saving checks what a published page would
 * otherwise get wrong with nothing red:
 *
 *  - the page is a template (`kind: 'template'`), so its own address cannot
 *    serve raw `{{item.*}}` — the console converts it first, through the
 *    platform's own route, which is the only writer of `kind`;
 *  - the dataset is shared with this site, and its address field is a page
 *    address;
 *  - the plan includes datasets (Starter and up), and the data store is
 *    released for the organization;
 *  - the base is free: no reserved address, no other plugin's route, no
 *    content collection's slug, no other template's base; and the dataset has
 *    no other template on this site, so `{{item.url}}` has one answer.
 *
 * Every save and removal drops the record pages it changes — the ones it
 * stops serving and the ones it starts to, which a crawler may have been told
 * were missing.
 */
export const recordPagesHandler: PluginWebApiHandler = async (request) => {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const action = text(body?.action)
  const hostId = text(body?.hostId)
  const screenId = text(body?.screenId)
  if (action !== 'save' && action !== 'remove') {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }
  if (!hostId || !screenId || hostId.includes('/') || screenId.includes('/')) {
    return Response.json({ error: 'Missing hostId or screenId' }, { status: 400 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const staff = decoded['staff'] === true
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const host = hostSnapshot.data() as Record<string, unknown>
    if (!staff && !hostRoleCanPublish((host['memberRoles'] as Record<string, unknown>)?.[decoded.uid])) {
      return Response.json(
        { error: 'Record templates are published routes — this needs the publisher role on the site' },
        { status: 403 },
      )
    }
    const orgId = text(host['orgId'])
    const org = orgId
      ? ((await firestore.collection('orgs').doc(orgId).get()).data() as Record<string, unknown> | undefined)
      : undefined
    const locked = await lockdownRefusal({
      request,
      staff,
      uid: decoded.uid,
      org: org as never,
      host: host as never,
    })
    if (locked) return locked
    if (!staff && orgId && !(await isServerReleaseFlagOnForOrg('release_data_store', orgId))) {
      return Response.json({ error: 'Not available' }, { status: 404 })
    }

    const bindingsRef = hostRef.collection(DATASET_RECORD_PAGES_COLLECTION)
    const bindings = await readRecordPageBindingsUncached(hostId)
    const current = bindings.find((binding) => binding.screenId === screenId) ?? null

    if (action === 'remove') {
      if (!current) return Response.json({ ok: true, removed: false }, { status: 200 })
      const stale = await recordPagePathsOf(hostId, current).catch(() => ({ paths: [] as string[] }))
      await bindingsRef.doc(screenId).delete()
      await dropRecordPages(hostId, current, stale.paths, 'record template removed')
      return Response.json({ ok: true, removed: true }, { status: 200 })
    }

    if (!checkEntitlement(org as never, 'dataStore')) {
      return Response.json(
        { error: 'Record pages need a Starter plan or higher' },
        { status: 403 },
      )
    }
    const screen = (await hostRef.collection('screens').doc(screenId).get()).data() as
      | Record<string, unknown>
      | undefined
    if (!screen || screen['deletedAt']) {
      return Response.json({ error: 'Unknown page' }, { status: 404 })
    }
    if (screen['kind'] !== SCREEN_KIND_TEMPLATE) {
      return Response.json(
        { error: 'Make this page a template first', code: 'not-template' },
        { status: 409 },
      )
    }

    const datasetId = text(body?.datasetId)
    const dataset = await readSiteDataset(hostId, datasetId)
    if (!dataset) {
      return Response.json({ error: 'That dataset is not shared with this site' }, { status: 404 })
    }
    const slugField = text(body?.slugField)
    if (!isRecordAddressField(dataset.model.fields[slugField])) {
      return Response.json(
        { error: 'Pick a Page address field of the dataset for the record pages’ addresses' },
        { status: 400 },
      )
    }
    const optional: Partial<DatasetRecordPageBinding> = {}
    for (const key of OPTIONAL_FIELDS) {
      const fieldId = text(body?.[key])
      if (!fieldId) continue
      if (!dataset.model.fields[fieldId]) {
        return Response.json({ error: `The dataset has no field "${fieldId}"` }, { status: 400 })
      }
      optional[key] = fieldId
    }

    const others = bindings.filter((binding) => binding.screenId !== screenId)
    if (!current && bindings.length >= RECORD_PAGES_MAX_PER_SITE) {
      return Response.json(
        { error: `A site can have up to ${RECORD_PAGES_MAX_PER_SITE} record templates` },
        { status: 403 },
      )
    }
    if (others.some((binding) => binding.datasetId === dataset.id)) {
      return Response.json(
        { error: `${dataset.name || 'This dataset'} already has a record template on this site` },
        { status: 409 },
      )
    }
    const collections = await hostRef.collection('collections').select('slug', 'kind').get()
    const refusal = recordPageBaseRefusal(body?.base, {
      collectionSlugs: collections.docs
        .filter((doc) => hostCollectionKind(doc.data() as never) === 'content')
        .map((doc) => text(doc.get('slug')))
        .filter(Boolean),
      pluginRouteSegments: pluginRouteSegments(),
      otherBases: others.map((binding) => binding.base),
    })
    if (refusal) return Response.json({ error: refusal }, { status: 400 })
    const base = normalizeRecordPageBase(body?.base) as string

    const binding: DatasetRecordPageBinding = {
      screenId,
      datasetId: dataset.id,
      base,
      slugField,
      ...optional,
    }
    const { screenId: _id, ...stored } = binding
    await bindingsRef.doc(screenId).set({
      ...stored,
      updatedAt: Timestamp.now(),
      updatedBy: decoded.uid,
    })
    const [before, after] = await Promise.all([
      current ? recordPagePathsOf(hostId, current).catch(() => ({ paths: [] as string[] })) : { paths: [] },
      recordPagePathsOf(hostId, binding).catch(() => ({ paths: [] as string[] })),
    ])
    await dropRecordPages(
      hostId,
      binding,
      [...after.paths, ...(current ? [`/${current.base}`] : []), ...before.paths],
      'record template saved',
    )
    return Response.json({ ok: true, binding }, { status: 200 })
  } catch (error) {
    if (isRefusedIdToken(error)) {
      return Response.json({ error: 'Unauthenticated' }, { status: 401 })
    }
    console.error(error)
    return Response.json({ error: 'Record template operation failed' }, { status: 500 })
  }
}

/**
 * Drops what a binding change makes stale. Best effort: the binding is
 * written, and the host's data tag is underneath.
 *
 * - The record pages it starts or stops serving, and its base, which a site
 *   often publishes as the listing — and which is always one path, so the
 *   drop always reaches the tenant and busts the data tag the bindings are
 *   cached under. A drop naming no path is skipped outright.
 * - Every page that repeats over the dataset, on every site sharing it: its
 *   rows have gained or lost their `{{item.url}}`.
 */
async function dropRecordPages(
  hostId: string,
  binding: DatasetRecordPageBinding,
  paths: string[],
  reason: string,
): Promise<void> {
  try {
    await dropPluginSiteCache({
      hostIds: [hostId],
      paths: { [hostId]: [...new Set([`/${binding.base}`, ...paths])] },
      reason,
    })
  } catch (error) {
    console.error('[record-pages] cache drop failed', hostId, error)
  }
  try {
    const dataset = await readSiteDataset(hostId, binding.datasetId)
    const orgId = dataset?.ref.parent.parent?.id
    if (dataset && orgId) {
      await announceDatasetRecords({
        firestore: firebaseAdmin.app().firestore(),
        orgId,
        datasetId: dataset.id,
      })
    }
  } catch (error) {
    console.error('[record-pages] dataset announce failed', hostId, error)
  }
}
