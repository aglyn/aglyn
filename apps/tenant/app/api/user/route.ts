/**
 * @license
 * Copyright 2026 Aglyn LLC
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
import {
  appCsrfCheck,
  appHandleJsonResponse,
} from '@aglyn/shared-util-rest-api'
import getAllUsers from '../../../utils/get-all-users'

export const dynamic = 'force-dynamic'

/**
 * Lists auth users, 1000 at a time (`?nextPageToken=`). GET only. The Pages
 * Router `csrfApiMiddleware` becomes {@link appCsrfCheck}: GET is a safe
 * method, so it only issues the `XSRF-TOKEN` cookie when one is missing.
 */
export async function GET(request: Request): Promise<Response> {
  const csrf = appCsrfCheck(request)
  const withCookie = (response: Response): Response => {
    if (csrf.setCookie) response.headers.append('set-cookie', csrf.setCookie)
    return response
  }
  if (!csrf.ok) {
    return withCookie(
      appHandleJsonResponse(HttpStatusCode.FORBIDDEN, {
        status: HttpResponseStatus.ERROR,
        statusMessage: csrf.message || HttpRefCodeSimple.INVALID_REQUEST,
        errorCode: createHttpRefCode(
          HttpRefCodeSimple.INVALID_REQUEST,
          HttpRefCodeSubject.INVALID_REQUEST,
          HttpRefCodeTopic.FAIL_CSRF_TOKEN_CHECK,
        ),
      }),
    )
  }

  const nextPageToken =
    new URL(request.url).searchParams.get('nextPageToken') ?? undefined
  let data = null
  let error = null
  try {
    data = await getAllUsers(nextPageToken)
  } catch (err) {
    console.error(err)
    error = err
  }

  if (error || data?.error) {
    const err: any = error || data?.error
    return withCookie(
      appHandleJsonResponse(
        err?.['code'] ||
          err?.['statusCode'] ||
          HttpStatusCode.INTERNAL_SERVER_ERROR,
        {
          status: HttpResponseStatus.ERROR,
          statusMessage:
            err?.['message'] ||
            err?.['statusMessage'] ||
            HttpRefCodeSimple.INVALID_REQUEST,
          error: err,
          errorCode: createHttpRefCode(
            HttpRefCodeSimple.INVALID_REQUEST,
            HttpRefCodeSubject.INVALID_REQUEST,
            HttpRefCodeTopic.FAIL_CSRF_TOKEN_CHECK,
          ),
        },
      ),
    )
  }

  return withCookie(
    appHandleJsonResponse(HttpStatusCode.OK, {
      status: HttpResponseStatus.SUCCESS,
      data,
    }),
  )
}
