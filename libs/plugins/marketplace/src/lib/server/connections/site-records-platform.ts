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

import { firebaseAdmin, getOrgForHost, getRealmPluginInstalls } from '@aglyn/tenant-data-admin'
import {
  PUBLISHED_SITE_DATA_TTL_SECONDS,
  TENANT_CACHE_BACKSTOP_SECONDS,
  tenantDataTag,
  tenantPluginGateTags,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'
import {
  createConnectionRecordsEnricher,
  createConnectionVariableComputer,
  createPluginImageHostsSource,
  readSiteConnectionRecords,
  siteDeclaredImageHosts,
  type SiteConnectionRecordEntry,
} from './site-records'

/*
 * The site-side readers of declared connections (AGL-4195), wired to the
 * platform: the Admin SDK, the tenant's render cache, and the page loader's
 * own read of the site's signed installs. Loaded with the first page that
 * needs one of them, never with the boot.
 */

const firestore = (): FirebaseFirestore.Firestore => firebaseAdmin.app().firestore()

/**
 * As long as the page's own data, and dropped by the same tag: a publish, a
 * plan change and an install change all announce `tenant-data:{hostId}`, and
 * a sync that writes a record should too. A shorter TTL here would cap every
 * page of the site at it (`render-cache.ts`).
 */
const SITE_CONNECTION_RECORDS_TTL_SECONDS = PUBLISHED_SITE_DATA_TTL_SECONDS

/**
 * As the site's signed installs are cached (`realm-plugins.ts`), which this
 * reads. It reads them INSIDE its own cached callback, where a nested cache
 * adds no tags to the entry, so it carries the plugin tags itself: an
 * uninstall or a takedown must expire the hosts it admitted too (AGL-4121).
 */
const SITE_IMAGE_HOSTS_TTL_SECONDS = TENANT_CACHE_BACKSTOP_SECONDS

const realmInstalls = (hostId: string) => getRealmPluginInstalls({ hostId })

/** The site's records, cached per site. A failed read shows none. */
export async function cachedSiteConnectionRecords(hostId: string): Promise<SiteConnectionRecordEntry[]> {
  const read = () =>
    readSiteConnectionRecords(
      {
        firestore: firestore(),
        orgForHost: async (id) => {
          const found = await getOrgForHost(id)
          return found ? { orgId: found.orgId, org: found.org as Record<string, unknown> } : null
        },
      },
      hostId,
    )
  try {
    return await withRenderCache({
      key: ['plugin-connection-records', hostId],
      revalidate: SITE_CONNECTION_RECORDS_TTL_SECONDS,
      tags: [tenantDataTag(hostId)],
      read,
    })
  } catch (error) {
    console.error('plugin-connections: a site’s records were unreadable', error)
    return []
  }
}

/** The image hosts the site's signed plugins declare, cached per site. A failed read admits none. */
export async function cachedSiteImageHosts(hostId: string): Promise<string[]> {
  const read = () =>
    siteDeclaredImageHosts(
      {
        realmInstalls,
        declaredImageHosts: async (listingId, version) =>
          (
            await firestore()
              .collection('marketplaceListings')
              .doc(listingId)
              .collection('pluginVersions')
              .doc(version)
              .get()
          ).get('manifest.capabilities.imageHosts'),
      },
      hostId,
    )
  try {
    return await withRenderCache({
      key: ['plugin-image-hosts', hostId],
      revalidate: SITE_IMAGE_HOSTS_TTL_SECONDS,
      tags: tenantPluginGateTags(hostId),
      read,
    })
  } catch (error) {
    console.error('plugin-connections: a site’s plugin image hosts were unreadable', error)
    return []
  }
}

export const connectionRecordsEnricher = createConnectionRecordsEnricher({
  realmInstalls,
  records: cachedSiteConnectionRecords,
})

export const connectionVariableComputer = createConnectionVariableComputer({ records: cachedSiteConnectionRecords })

export const pluginImageHostsSource = createPluginImageHostsSource(cachedSiteImageHosts)
