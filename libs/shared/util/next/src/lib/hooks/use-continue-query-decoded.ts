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
import type {ContinueRouteData} from '../types'


export type UseContinueQueryDecodedRoutePusher = (
  url?: UrlObject | string,
  as?: UrlObject | string,
  options?: {shallow?: boolean, locale?: string | false, scroll?: boolean},
) => Promise<boolean>

export type UseContinueQueryDecodedResponse = [
  ContinueRouteData,
  UseContinueQueryDecodedRoutePusher
]

export function useContinueQueryDecoded(): UseContinueQueryDecodedResponse {
  const router = useRouter()
  const {continue: query} = router.query

  const continueRouteData = useMemo(() => {
    const continueQuery = (_isArr(query) ? query[0] : query) || ''
    return useContinueQueryDecoded.decodeContinueQuery(continueQuery)
  }, [query])

  const pushContinue = useCallback((
    url: UrlObject | string = '/',
    as?: UrlObject | string,
    options?: {shallow?: boolean, locale?: string | false, scroll?: boolean},
  ): Promise<boolean> => {
    const {href, asPath} = continueRouteData
    return router.push(href || url, href && asPath || as, options)
  }, [router, continueRouteData])


  return useMemo(() => {
    return [continueRouteData, pushContinue]
  }, [continueRouteData, pushContinue])
}

useContinueQueryDecoded.decodeContinueQuery = (query: string): ContinueRouteData => {
  return JSON.parse(decodeURIComponent(query || '') || '{}')
}

export default useContinueQueryDecoded
