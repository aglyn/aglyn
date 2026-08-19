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

import type { AglynHost } from '@aglyn/aglyn/server'
import {
  appHandleJsonError,
  appHandleJsonSuccess,
} from '@aglyn/shared-util-rest-api'
import getHost from '../../../../utils/get-host'

export const dynamic = 'force-dynamic'

/** Exactly what this route publishes about a site. */
export interface PublicHost {
  $id?: string
  displayName?: string
  logoUrl?: string
  subdomain?: string
  cname?: string
  locales?: string[]
  defaultLocale?: string
  seo?: {
    title?: string
    description?: string
    separator?: string
    favicon?: string
    image?: string
    imageWidth?: number
    imageHeight?: number
  }
}

/**
 * The allow-list, applied HERE and never in `get-host.ts` (AGL-2192).
 *
 * `getHost` is the most amplified read in the tenant runtime: every render,
 * `/api/sitemap`, `/api/robots` and `/api/locked` start with it, and they read
 * fields this response must not carry — `suspendedUntilMs`, `screens`,
 * `maintenance`. Narrowing the shared util to fix a route would starve those
 * predicates, so the projection lives at the boundary that publishes.
 *
 * `seo` is copied key by key rather than passed through, for the same reason
 * the outer object is: the next field added to it inherits the safe default.
 */
function toPublicHost(host: AglynHost | null | undefined): PublicHost | null {
  if (!host) return null
  const seo = host.seo
  return {
    $id: host.$id,
    displayName: host.displayName,
    logoUrl: host.logoUrl,
    subdomain: host.subdomain,
    cname: host.cname,
    locales: host.locales,
    defaultLocale: host.defaultLocale,
    seo: seo
      ? {
          title: seo.title,
          description: seo.description,
          separator: seo.separator,
          favicon: seo.favicon,
          image: seo.image,
          imageWidth: seo.imageWidth,
          imageHeight: seo.imageHeight,
        }
      : undefined,
  }
}

/**
 * Host lookup by `?host=` (SEO Toolkit / preview). GET only — App Router
 * replies 405 to other methods natively, replacing the Pages Router
 * `httpRequestMethodMiddleware(GET)` wrapper.
 *
 * Anonymous by design — a site's public identity is public — so the boundary
 * is WHAT it returns, not who asks. It used to return the whole `AglynHost`
 * document, `memberRoles` included: the Firebase UIDs of the site's editors
 * with their roles, which `edit-access-authz` reads as an authorization input
 * (AGL-2192). See `toPublicHost` before widening this.
 */
export async function GET(request: Request): Promise<Response> {
  const host = new URL(request.url).searchParams.get('host')
  if (!host) return appHandleJsonError(new Error('Bad request'))

  let data = null
  let error = null
  try {
    const result = await getHost({ host })
    if (result?.error) error = result.error
    else {
      data = {
        host: toPublicHost(result?.host),
        nextPageToken: '',
        error: null,
      }
    }
  } catch (err) {
    console.error(err)
    error = err
  }

  if (error) return appHandleJsonError(error)
  return appHandleJsonSuccess(data)
}
