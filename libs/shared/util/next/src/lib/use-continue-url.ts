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

import { isSameOriginPath } from '@aglyn/shared-util-http/safe-redirect'
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
  process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.com'

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
 *
 * The relative branch defers to {@link isSameOriginPath} rather than testing
 * the string's shape (AGL-1881). AGL-2486 rejected `\` here because the
 * WHATWG URL parser treats it as `/` in the authority position, so
 * `/\evil.com` passed a `startsWith('/') && !startsWith('//')` test and still
 * resolved off-site. That was true but incomplete: the same parser also
 * DELETES every tab, LF and CR before parsing, so `/<TAB>/evil.com` resolves
 * to `https://evil.com/` while containing neither `//` nor `\`. Enumerating
 * the tricks was the mistake; the shared predicate resolves the value and
 * compares origins, which is the question `window.location.assign` will
 * actually ask.
 *
 * The absolute branch below never had that bug and keeps its own check: once
 * the input is absolute the parser's `hostname` is already ground truth.
 *
 * A `continue` that has survived an external IdP round trip is the case that
 * makes this matter: whatever we put into `state` comes back as untrusted
 * input.
 *
 * `''` is rejected explicitly rather than by accident. `strictNullChecks` is
 * off repo-wide, so an absent param arrives here as an empty string far more
 * often than as `undefined`, and "no continue" must read as unsafe so the
 * caller falls back to its own default instead of building `?continue=`.
 */
export const isSafeContinueUrl = (url: string): boolean => {
  if (!url) return false
  return isSameOriginPath(url) || isSameSiteAbsoluteUrl(url)
}

/**
 * Forward the continue URL onto another same-app path (AGL-2486).
 *
 * A signed-out user who deep-links in arrives at `/signin?continue=…`, and
 * every link OUT of that page to another auth route — the SSO button above
 * all — has to carry the value or the destination they were going to is
 * gone. Observed on the SSO button: the url does not carry the
 * continue url and is dropped entirely.
 *
 * Unsafe or absent values append nothing, so a poisoned `continue` degrades
 * to a plain link rather than being laundered one hop further along.
 */
export function withContinueUrl(path: string, continueUrl: string): string {
  if (!isSafeContinueUrl(continueUrl)) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}${continueParam(encodeURIComponent(continueUrl))}`
}

/**
 * `href` for a link out of the current page that keeps the continue URL.
 *
 * Deliberately reads `useSearchParams` directly instead of reusing
 * {@link useContinueUrlDecoded}: that hook also calls `useRouter`, and a
 * link does not navigate imperatively. Pulling the router in would make
 * every page that renders one of these links require an App Router context
 * it does not otherwise need.
 */
export function useContinueHref(path: string): string {
  const searchParams = useSearchParams()
  const raw = searchParams?.get(ContinueParamName) ?? ''
  return useMemo(() => withContinueUrl(path, raw), [path, raw])
}

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
