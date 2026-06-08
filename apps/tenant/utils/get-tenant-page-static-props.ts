/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { mockDB, type TenantSite } from '@aglyn/tenant-feature-instance'
import type {
  GetStaticPropsContext,
  GetStaticPropsResult,
  PreviewData,
} from 'next/types'
import type { StaticPaths } from './get-tenant-page-static-paths'

export interface StaticProps extends Dictionary {
  tenant: TenantSite
}

/**
 * @see {@link https://vercel.com/docs/concepts/next.js/incremental-static-regeneration#fetching-data|Fetching data for ISR}
 */
export async function getTenantPageStaticProps(
  context: GetStaticPropsContext<StaticPaths, PreviewData>,
): Promise<GetStaticPropsResult<StaticProps>> {
  const {
    params: { host },
  } = context

  // fetch data from mock database using the site value as the key
  const tenant = mockDB.find(
    ({ subdomain, cname }) => subdomain === host || cname === host,
  )

  if (!tenant) {
    return {
      notFound: true,
      revalidate: 1, // never=false, always=1, since=SECONDS
    }
  }

  return {
    props: { tenant },
    revalidate: 30, // never=false, always=1, since=SECONDS
  }
}
export default getTenantPageStaticProps
