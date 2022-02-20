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
import type {HttpResponseStatus, HttpStatusCode} from '@aglyn/shared-data-enums'
import {JsonResponse} from '../types'


export type JsonCreateResponseOptions = {
  status?: HttpResponseStatus | true,
  statusCode?: HttpStatusCode,
  statusMessage?: string,
  data?: any,
  error?: any
  init?: ResponseInit,
}

/**
 * Speed up creating a new {@link Response} object specifying the JSON header
 * `'Content-Type': 'application/json'` and {@link JSON.stringify|serializing}
 * JSON response data
 * @example - pages/_middleware.ts
 * export function middleware(req: NextRequest) {
 *   return createNewJsonResponse(
 *     HttpStatusCode.OK,
 *     {data: 'Hello World!'},

 * @returns a new {@link Response} object instance
 */
export function createNewJsonResponse(
  statusCode: HttpStatusCode,
  options: JsonCreateResponseOptions = {},
) {
  const {statusMessage, data, error, init} = options
  const json: JsonResponse = {statusCode, data}
  if (error) json.error = error
  if (statusMessage) json.statusMessage = statusMessage

  return new Response(JSON.stringify(json), {
    ...init,
    status: statusCode,
    statusText: statusMessage,
    headers: {
      ...init?.headers,
      'Content-Type': 'application/json',
    },
  })
}

export default createNewJsonResponse
