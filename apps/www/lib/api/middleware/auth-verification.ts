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

import {HttpStatusCode} from '@aglyn/shared-data-enums'
import {
  createNewJsonResponse,
  withCsrfTokenHeader,
  withIdTokenHeader,
} from '@aglyn/shared-util-rest-api'
import type {NextApiHandler} from 'next'
import {verifyIdToken} from '../../fetch-data/profile-data'


export const requireIdToken = <T = any>(handler: NextApiHandler<T>): NextApiHandler<T> => {
  return withIdTokenHeader((async (req, res) => {
    try {
      await verifyIdToken(req.idToken)
    }
    catch (error) {
      return createNewJsonResponse(HttpStatusCode.UNAUTHORIZED, {
        status: 'error',
        error: error,
        statusMessage: 'Unauthorized request sent',
      })
    }

    await handler(req, res)
  }) as any)
}

export const requireCsrfToken = <T = any>(handler: NextApiHandler<T>): NextApiHandler<T> => {
  return withCsrfTokenHeader((async (req, res) => {
    if (req['csrfToken'] !== req.cookies.csrfToken) {
      return createNewJsonResponse(HttpStatusCode.UNAUTHORIZED, {
        status: 'error',
        error: Error('CSRF mismatch. Possible break-in attempt!'),
        statusMessage: 'Invalid request',
      })
    }
    await handler(req, res)
  }) as any)
}

export const secureRequest = <T = any>(handler: NextApiHandler<T>, withCsrf?: boolean) => {
  return withCsrf ? requireIdToken(requireCsrfToken(handler)) : requireIdToken(handler)
}
