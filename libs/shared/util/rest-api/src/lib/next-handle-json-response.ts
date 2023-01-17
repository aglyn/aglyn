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
import { HttpStatusCode } from '@aglyn/shared-data-enums'
import type { NextApiResponse } from 'next'
import type { JsonResponse } from './types'

/**
 * Speed up creating a new {@link Response} object specifying the JSON header
 * `'Content-Type': 'application/json'` and {@link JSON.stringify | serializing}
 * JSON response data
 * @example - pages/middleware.ts
 * export function handler(req: NextApiRequest, res: NextApiResponse) {
 *   return createNewJsonResponse(
 *     res,
 *     HttpStatusCode.OK,
 *     {data: 'Hello World!'},
 *   )
 * }
 * @returns a new {@link Response} object instance
 */
export function nextHandleJsonResponse(
  response: NextApiResponse<JsonResponse>,
  statusCode: HttpStatusCode,
  options?: JsonResponse,
) {
  const { error, errorCode, status, statusMessage, data } = options || {}
  const json: JsonResponse = {
    errorCode,
    error,
    status: status ?? true,
    statusCode: statusCode || HttpStatusCode.OK,
    statusMessage: statusMessage || 'No message provided.',
    data: data ?? null,
  }

  response.status(json.statusCode).json(json)
}

export default nextHandleJsonResponse
