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

// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import {
  createHttpRefCode,
  HttpRefCodeSimple,
  HttpRefCodeSubject,
  HttpRefCodeTopic,
  HttpRequestMethod,
  HttpResponseStatus,
  HttpStatusCode,
} from '@aglyn/shared-data-enums'
import { HttpResponseError } from '@aglyn/shared-util-errors'
import type { NextMiddleware } from 'next-api-middleware'
import nextHandleJsonResponse from './next-handle-json-response'

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
  return async function (req, res, next) {
    const method = req.method.toUpperCase() as HttpRequestMethod
    const valid = Array.isArray(allowed)
      ? allowed.includes(method)
      : method === allowed

    if (valid || method === HttpRequestMethod.OPTIONS) {
      await next()
    } else {
      const err = new HttpResponseError(
        HttpStatusCode.METHOD_NOT_ALLOWED,
        HttpRefCodeSimple.METHOD_NOT_ALLOWED,
      )
      nextHandleJsonResponse(res, HttpStatusCode.NOT_FOUND, {
        status: HttpResponseStatus.ERROR,
        statusMessage: HttpRefCodeSimple.RESOURCE_NOT_FOUND,
        error: err,
        errorCode: createHttpRefCode(
          HttpRefCodeSimple.METHOD_NOT_ALLOWED,
          HttpRefCodeSubject.BAD_REQUEST,
          HttpRefCodeTopic.METHOD_NOT_ALLOWED,
        ),
      })
    }
  }
}
export default httpRequestMethodMiddleware
