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

import { _isArr } from '@aglyn/shared-util-tools'
import { useParams, usePathname, useRouter } from 'next/navigation'
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

export function useContinueUrlDecoded(): UseContinueUrlDecodedResponse {
  const router = useRouter()
  const params = useParams()

  const continueUrl = useMemo(() => {
    const url = params?.continue
    const continueUrl = (_isArr(url) ? url[0] : url) || ''
    return decodeURIComponent(continueUrl || '')
  }, [params])

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
      return router.push(continueUrl || url, options)
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
