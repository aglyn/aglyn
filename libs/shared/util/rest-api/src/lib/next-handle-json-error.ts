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

import {
  createHttpRefCode,
  HttpRefCodeSimple,
  HttpRefCodeSubject,
  HttpRefCodeTopic,
  HttpResponseStatus,
  HttpStatusCode,
} from '@aglyn/shared-data-enums'
import { NextApiResponse } from 'next'
import nextHandleJsonResponse from './next-handle-json-response'
import { JsonResponse } from './types'

export function nextHandleJsonError(
  response: NextApiResponse<JsonResponse>,
  error,
) {
  const { code, statusCode, message, statusMessage } = error
  const msg = message || statusMessage || HttpRefCodeSimple.INVALID_REQUEST
  const co = code || statusCode || HttpStatusCode.INTERNAL_SERVER_ERROR
  const errorCode = createHttpRefCode(
    HttpRefCodeSimple.INVALID_REQUEST,
    HttpRefCodeSubject.INVALID_REQUEST,
    HttpRefCodeTopic.SERVER_ERROR,
  )

  return nextHandleJsonResponse(response, co, {
    status: HttpResponseStatus.ERROR,
    statusMessage: msg,
    error,
    errorCode,
  })
}
export default nextHandleJsonError
