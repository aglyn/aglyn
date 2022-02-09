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
import {type HttpStatusCode} from '@aglyn/shared-data-enums'


/**
 * Speed up creating a new {@link Response} object specifying the JSON header
 * `'Content-Type': 'application/json'` and {@link JSON.stringify|serializing}
 * JSON response data
 * @example - pages/_middleware.ts
 * export function middleware(req: NextRequest) {
 *   return createJsonResponse(
 *     HttpStatusCode.OK,
 *     {data: 'Hello World!'},
 *   )
 * }
 * @param status - the response {@link HttpStatusCode}
 * @param data - data to serialize and return for the response
 * @param init - optionally provide {@link ResponseInit} object to spread
 * @returns a new {@link Response} object instance
 */
function createJsonResponse(status: HttpStatusCode, data: any, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    status,
    headers: {
      ...init?.headers,
      'Content-Type': 'application/json',
    },
  })
}

export {createJsonResponse}
export default createJsonResponse
