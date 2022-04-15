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

import {_isArr} from '@aglyn/shared-util-guards'
import {useRouter} from 'next/router'
import {useCallback, useMemo} from 'react'
import type {UrlObject} from 'url'


export type UseContinueUrlDecodedRoutePusher = (
  url?: UrlObject | string,
  as?: UrlObject | string,
  options?: {shallow?: boolean, locale?: string | false, scroll?: boolean},
) => Promise<boolean>

export type UseContinueUrlDecodedResponse = [
  decoded: string,
  pushNext: UseContinueUrlDecodedRoutePusher
]

export type UseContinueUrlResponse = [
  encoded: string,
  decoded: string,
  pushNext: UseContinueUrlDecodedRoutePusher
]

export const ContinueParamName = 'continue'
export const continueParam = (value: string) => `${ContinueParamName}=${value}`

export function useContinueUrlDecoded(): UseContinueUrlDecodedResponse {
  const router = useRouter()

  const nextUrl = useMemo(() => {
    const {next} = router.query
    const nextUrl = (_isArr(next) ? next[0] : next) || ''
    return decodeURIComponent(nextUrl || '')
  }, [router])

  const pushNext = useCallback((
    url: UrlObject | string = '/',
    as: UrlObject | string | undefined = undefined,
    options?: {shallow?: boolean, locale?: string | false, scroll?: boolean},
  ): Promise<boolean> => {
    return router.push(nextUrl || url, as, options)
  }, [router, nextUrl])


  return useMemo(() => {
    return [nextUrl, pushNext]
  }, [nextUrl, pushNext])
}

export function useContinueUrlEncoded() {
  const router = useRouter()

  return useMemo(() => {
    const pathname = router.asPath
    return encodeURIComponent(pathname || '')
  }, [router])
}

export function useContinueUrl(): UseContinueUrlResponse {
  const encoded = useContinueUrlEncoded()
  const [decoded, pushNext] = useContinueUrlDecoded()

  return useMemo(() => [
    encoded,
    decoded,
    pushNext,
  ], [
    encoded,
    decoded,
    pushNext,
  ])
}

export default useContinueUrl
