/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
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
