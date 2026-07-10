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
import { HttpResponseError } from '@aglyn/shared-util-errors'
import type { SerializeOptions as CookieSerializeOptions } from 'cookie'
import { sign, unsign } from 'cookie-signature'
import Tokens from 'csrf'
import type { NextApiRequest, NextApiResponse } from 'next'
import getApiRequestCookie from './get-api-request-cookie'
import nextHandleJsonResponse from './next-handle-json-response'
import setApiResponseCookie from './set-api-response-cookie'

export interface CsrfOptions {
  secret: string
  ignoredMethods?: string[]
  csrfErrorMessage?: string
  tokenKey?: string
  cookieOptions?: CookieSerializeOptions
}

// Make the optional parameters in `nextCsrf` required in the `csrf` middleware
export interface CsrfMiddlewareOptions extends CsrfOptions {
  csrfErrorMessage: string
  ignoredMethods: string[]
  csrfSecret: string
  tokenKey: string
  cookieOptions: CookieSerializeOptions
}

export const CSRF_SECRET = process.env.CSRF_SECRET || ''
export const csrfTokens = new Tokens()

const getCsrfTokenHeader = (
  req: NextApiRequest,
  tokenKey: string,
): string | string[] => req.headers[tokenKey.toLowerCase()] || ''

export function CsrfApiMiddleware(options: CsrfMiddlewareOptions) {
  const {
    ignoredMethods,
    csrfSecret,
    csrfErrorMessage,
    secret,
    tokenKey,
    cookieOptions,
  } = options

  return async function (
    req: NextApiRequest,
    res: NextApiResponse<any>,
    next: () => any,
  ) {
    try {
      // 1. extract secret and token from their cookies
      const tokenFromCookie = getApiRequestCookie(tokenKey, req)

      // If no token in cookie then we assume first request and proceed to setup CSRF mitigation
      if (!tokenFromCookie) {
        const reqCsrfToken = csrfTokens.create(csrfSecret)
        const reqCsrfTokenSigned = sign(reqCsrfToken, secret)

        setApiResponseCookie(res, tokenKey, reqCsrfTokenSigned, cookieOptions)

        return await next()
      }

      // Do nothing on if method is in `ignoreMethods`
      if (ignoredMethods.includes(req.method as string)) {
        return await next()
      }

      // 2. extract token from custom header
      const tokenFromHeaders = <string>getCsrfTokenHeader(req, tokenKey)

      // We need the token in a custom header to verify Double-submit cookie pattern
      if (!tokenFromHeaders) {
        throw new HttpResponseError(HttpStatusCode.FORBIDDEN, csrfErrorMessage)
      }

      const tokenFromCookieUnsigned = unsign(tokenFromCookie, secret)
      const tokenFromHeadersUnsigned = unsign(<string>tokenFromHeaders, secret)

      // 3. verify signature
      if (!tokenFromCookieUnsigned || !tokenFromHeadersUnsigned) {
        throw new HttpResponseError(HttpStatusCode.FORBIDDEN, csrfErrorMessage)
      }

      // 4. double-submit cookie pattern
      if (tokenFromCookieUnsigned != tokenFromHeadersUnsigned) {
        throw new HttpResponseError(HttpStatusCode.FORBIDDEN, csrfErrorMessage)
      }

      // 5. verify CSRF token
      if (!csrfTokens.verify(csrfSecret, tokenFromCookieUnsigned)) {
        throw new HttpResponseError(HttpStatusCode.FORBIDDEN, csrfErrorMessage)
      }

      // 6. If everything is okay and verified, generate a new token and save it in the cookie
      const newReqCsrfToken = csrfTokens.create(csrfSecret)
      const newReqCsrfTokenSigned = sign(newReqCsrfToken, secret)

      setApiResponseCookie(res, tokenKey, newReqCsrfTokenSigned, cookieOptions)

      return await next()
    } catch (error: any) {
      return nextHandleJsonResponse(
        res,
        error?.['code'] || HttpStatusCode.INTERNAL_SERVER_ERROR,
        {
          status: HttpResponseStatus.ERROR,
          statusMessage:
            error?.['message'] || HttpRefCodeSimple.INVALID_REQUEST,
          error: error,
          errorCode: createHttpRefCode(
            HttpRefCodeSimple.INVALID_REQUEST,
            HttpRefCodeSubject.INVALID_REQUEST,
            HttpRefCodeTopic.FAIL_CSRF_TOKEN_CHECK,
          ),
        },
      )
    }
  }
}

const defaultOptions = {
  tokenKey: 'XSRF-TOKEN',
  csrfErrorMessage: 'Invalid CSRF token',
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  cookieOptions: {
    httpOnly: true,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  },
}
export function csrfApiMiddlewareFactory(options: CsrfOptions) {
  const opts = { ...defaultOptions, ...options }
  // generate CSRF secret
  const csrfSecret = csrfTokens.secretSync()
  // generate CSRF token
  const csrfToken = sign(csrfTokens.create(csrfSecret), opts.secret)
  // generate options for the csrf middleware
  const csrfOptions = { ...opts, csrfSecret }
  // generate middleware to verify CSRF token with the CSRF as parameter
  const csrfApiMiddleware = CsrfApiMiddleware(csrfOptions)

  return {
    csrfToken,
    csrfApiMiddleware,
  }
}

export const { csrfToken, csrfApiMiddleware } = csrfApiMiddlewareFactory({
  secret: CSRF_SECRET,
})
