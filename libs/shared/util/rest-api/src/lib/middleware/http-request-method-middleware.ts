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

import {HttpRequestMethod, HttpStatusCode} from '@aglyn/shared-data-enums'
import type {NextMiddleware} from 'next-api-middleware'
import jsonCreateResponse from '../utils/json-create-response'
import jsonHandleNextResponse from '../utils/json-handle-next-response'


/**
 * @example
 * import httpRequestMethodMiddleware
 * import {use} from 'next-api-middleware'
 * const postRequestsOnlyMiddleware = httpRequestMethodMiddleware("POST")
 * return use(postRequestsOnlyMiddleware)((request, response) => {
 *   ...
 * })
 *
 * @param allowed
 */
export function httpRequestMethodMiddleware(
  allowed: HttpRequestMethod[] | HttpRequestMethod,
): NextMiddleware {
  return async function(req, res, next) {
    const method = req.method.toUpperCase()
    const lookup = HttpRequestMethod[HttpRequestMethod[method]]
    const valid = Array.isArray(allowed)
      ? allowed.includes(lookup)
      : lookup === allowed

    if (valid || method === HttpRequestMethod.OPTIONS) {
      await next()
    }
    else {
      jsonHandleNextResponse(res, HttpStatusCode.NOT_FOUND, {
        status: 'error', statusMessage: 'Resource not found',
      })
    }
  }
}
export default httpRequestMethodMiddleware
