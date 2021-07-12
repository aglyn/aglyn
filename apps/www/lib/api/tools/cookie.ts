/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { ApiResponse } from '../types'
import { serialize, CookieSerializeOptions } from 'cookie'


/**
 * This sets a cookie value on the nextjs response object
 *
 * EXAMPLE BELOW:
 * ```
 * setCookie(res, 'Next.js', 'api-middleware!')
 * ```
 *
 * @export
 * @param {NextApiResponse} res
 * @param {string} cookieName
 * @param {unknown} cookieValue
 * @param {CookieSerializeOptions} [options={}]
 */
export function setApiCookie(
  res: ApiResponse,
  cookieName: string,
  cookieValue: unknown,
  options: CookieSerializeOptions = {},
) {
  const str = String(
    typeof cookieValue === 'object'
      ? 'j:' + JSON.stringify(cookieValue)
      : cookieValue,
  )

  if ('maxAge' in options) {
    options.expires = new Date(Date.now() + options.maxAge)
    options.maxAge /= 1000
  }
  res.setHeader('Set-Cookie', serialize(cookieName, str, options))
}
