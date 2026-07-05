/**
 * @license
 * Copyright 2022 Aglyn LLC
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
  mockDB,
  type TenantSite,
} from '@aglyn/tenant-feature-instance'
import type { GetStaticPathsContext, GetStaticPathsResult } from 'next/types'
import type { ParsedUrlQuery } from 'querystring'

function mapTenants(sites: TenantSite[]) {
  function mapPaths(
    paths: TenantSite['paths'],
    host: TenantSite['subdomain' | 'cname'],
  ) {
    return paths.map((pg: string) => ({
      params: {
        slug: pg.split('/').filter((i) => Boolean(i)),
        host: host,
      },
    }))
  }
  return sites.reduce(
    (prev, { subdomain, cname, paths }) => [
      ...prev,
      ...mapPaths(paths, subdomain),
      ...(cname ? mapPaths(paths, cname) : []),
    ],
    [],
  )
}

export interface StaticPaths extends ParsedUrlQuery, TenantSite {}

/**
 * @see {@link https://vercel.com/docs/concepts/next.js/incremental-static-regeneration#generating-paths|Generating paths for ISR}
 * @param context
 */
export async function getTenantPageStaticPaths(
  context: GetStaticPathsContext,
): Promise<GetStaticPathsResult<StaticPaths>> {
  // build paths for each of the sites in the previous two lists
  const paths = mapTenants(mockDB)

  return {
    paths: paths,
    fallback: 'blocking', // ISR server-render if static cache is not available
  }
}
export default getTenantPageStaticPaths
