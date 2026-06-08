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
import type {NextApiRequest} from 'next'
import getOriginHeaders from './get-origin-headers'
import getRequestHeader from './get-request-header'
import type {OriginFn, StaticOrigin} from './types'


export async function getOriginHeadersFromRequest(
  request: Request | NextApiRequest,
  origin: StaticOrigin | OriginFn,
) {
  const reqOrigin = getRequestHeader(request, 'Origin') || undefined
  const value = typeof origin === 'function'
    ? await origin(reqOrigin, request)
    : origin

  if (!value) return
  return getOriginHeaders(reqOrigin as string, value)
}

export default getOriginHeadersFromRequest
