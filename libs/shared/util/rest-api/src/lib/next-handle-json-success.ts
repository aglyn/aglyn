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

import { HttpResponseStatus, HttpStatusCode } from '@aglyn/shared-data-enums'
import { NextApiResponse } from 'next'
import nextHandleJsonResponse from './next-handle-json-response'
import { JsonResponse } from './types'

export function nextHandleJsonSuccess(
  response: NextApiResponse<JsonResponse>,
  data: any,
) {
  return nextHandleJsonResponse(response, HttpStatusCode.OK, {
    status: HttpResponseStatus.SUCCESS,
    data,
  })
}
export default nextHandleJsonSuccess
