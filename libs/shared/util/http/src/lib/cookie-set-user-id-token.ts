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

import {COOKIE_KEY_USER_TOKEN} from '@aglyn/shared-data-enums'
import type {ResponseCookie} from 'next/dist/compiled/@edge-runtime/cookies'
import type {NextRequest, NextResponse} from 'next/server'


export function cookieSetUserIdToken(
  request: NextRequest,
  response: NextResponse,
  token: string,
  options?: Partial<ResponseCookie>,
) {
  return response.cookies.set(COOKIE_KEY_USER_TOKEN, token, {
    httpOnly: true,
    ...options,
  })
}
export default cookieSetUserIdToken
