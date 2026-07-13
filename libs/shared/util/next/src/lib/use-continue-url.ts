/**
 * @license
 * Copyright 2024 Aglyn LLC
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
'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'

export type UseContinueUrlDecodedRoutePusher = (
  url?: string,
  as?: string,
  options?: { shallow?: boolean; locale?: string | false; scroll?: boolean },
) => void

export type UseContinueUrlDecodedResponse = [
  decoded: string,
  pushNext: UseContinueUrlDecodedRoutePusher,
]

export type UseContinueUrlResponse = [
  encoded: string,
  decoded: string,
  pushNext: UseContinueUrlDecodedRoutePusher,
]

export const ContinueParamName = 'continue'
export const continueParam = (value: string) => `${ContinueParamName}=${value}`

const WORKSPACE_DOMAIN =
  process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.io'

/**
 * Same-site absolute returns (AGL-465): the auth host signs a user in and
 * must redirect back to the {org}.<workspaceDomain> subdomain they started
 * from, which is a cross-origin URL. Allow it only when the host is within
 * the workspace domain over https, so this stays first-party and never
 * becomes an open redirect.
 */
const isSameSiteAbsoluteUrl = (url: string): boolean => {
  try {
    const { protocol, hostname } = new URL(url)
    if (protocol !== 'https:') return false
    return (
      hostname === WORKSPACE_DOMAIN ||
      hostname.endsWith(`.${WORKSPACE_DOMAIN}`)
    )
  } catch {
    return false
  }
}

/**
 * Only same-app relative paths, or same-site absolute URLs within the
 * workspace domain (AGL-465), may be continued to — anything else absolute
 * or protocol-relative would make the post-auth redirect an open redirect.
 */
const isSafeContinueUrl = (url: string): boolean =>
  (url.startsWith('/') && !url.startsWith('//')) || isSameSiteAbsoluteUrl(url)

export function useContinueUrlDecoded(): UseContinueUrlDecodedResponse {
  const router = useRouter()
  // App Router: query strings live in useSearchParams — useParams only
  // carries dynamic route segments, which is why the continue redirect
  // silently broke after the pages→app migration (AGL-458). `get` already
  // percent-decodes, so no second decode (it would corrupt paths that
  // legitimately contain %-sequences).
  const searchParams = useSearchParams()

  const continueUrl = useMemo(() => {
    const url = searchParams?.get(ContinueParamName) ?? ''
    return isSafeContinueUrl(url) ? url : ''
  }, [searchParams])

  const pushNext = useCallback(
    (
      url = '/',
      as: string | undefined = undefined,
      options?: {
        shallow?: boolean
        locale?: string | false
        scroll?: boolean
      },
    ): void => {
      const target = continueUrl || url
      // A same-site absolute return (AGL-465) is cross-origin — the App
      // Router's client navigation can't cross origins, so hand it to the
      // browser. Relative paths keep the SPA transition.
      if (/^https?:\/\//.test(target)) {
        if (typeof window !== 'undefined') window.location.assign(target)
        return
      }
      return router.push(target, options)
    },
    [router, continueUrl],
  )

  return useMemo(() => {
    return [continueUrl, pushNext]
  }, [continueUrl, pushNext])
}

export function useContinueUrlEncoded() {
  const pathname = usePathname()

  return useMemo(() => {
    return encodeURIComponent(pathname || '')
  }, [pathname])
}

export function useContinueUrl(): UseContinueUrlResponse {
  const encoded = useContinueUrlEncoded()
  const [decoded, pushNext] = useContinueUrlDecoded()

  return useMemo(
    () => [encoded, decoded, pushNext],
    [encoded, decoded, pushNext],
  )
}

export default useContinueUrl
