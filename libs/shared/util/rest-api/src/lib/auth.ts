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

// eslint-disable-next-line @nx/enforce-module-boundaries
import { HttpResponseStatus, HttpStatusCode } from '@aglyn/shared-data-enums'
import { getRequestHeader } from '@aglyn/shared-util-http'
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next'
import createNewJsonResponse from './create-new-json-response'

export function requireHeader<T = any>(
  name: string,
  key: keyof NextApiRequest['headers'],
  handler: NextApiHandler<T>,
): NextApiHandler<T> {
  return async function (req: NextApiRequest, res: NextApiResponse<T>) {
    const header = getRequestHeader(req, key)

    if (!header) {
      return createNewJsonResponse(HttpStatusCode.BAD_REQUEST, {
        status: HttpResponseStatus.ERROR,
        error: Error(`Missing required header - (key: ${key})!`),
        statusMessage: 'Bad request. Failed to satisfy headers.',
      })
    }
    req[key] = header
    await handler(req, res)
  } as unknown as NextApiHandler<T>
}
export function withIdTokenHeader<T = any>(
  handler: NextApiHandler<T>,
): NextApiHandler<T> {
  return requireHeader('idToken', 'id-token', handler)
}
export function withCsrfTokenHeader<T = any>(
  handler: NextApiHandler<T>,
): NextApiHandler<T> {
  return requireHeader('csrfToken', 'csrf-token', handler)
}
