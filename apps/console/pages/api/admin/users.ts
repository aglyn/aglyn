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

import { firebaseAdmin } from '@aglyn/core-data-admin'
import {
  createHttpRefCode,
  HttpRefCodeSimple,
  HttpRefCodeSubject,
  HttpRefCodeTopic,
  HttpRequestMethod,
  HttpResponseStatus,
  HttpStatusCode,
} from '@aglyn/shared-data-enums'
import {
  csrfApiMiddleware,
  httpRequestMethodMiddleware,
  nextHandleJsonResponse,
} from '@aglyn/shared-util-rest-api'
import type { NextApiRequest, NextApiResponse } from 'next'
import { use } from 'next-api-middleware'

const getAllUsers = async (nextPageToken?: string) => {
  const data = { users: [] as any, nextPageToken: '', error: null }

  // List batch of users, 1000 at a time.
  await firebaseAdmin
    .app()
    .auth()
    .listUsers(5, nextPageToken)
    .then((listUsersResult) => {
      listUsersResult.users.forEach((userRecord) => {
        data.users.push(userRecord.toJSON())
      })
      if (listUsersResult.pageToken) {
        data.nextPageToken = listUsersResult.pageToken
      }
    })
    .catch((error) => {
      console.log('Error listing users:', error)
      data.error = error
    })

  return data
}

async function users(request: NextApiRequest, response: NextApiResponse) {
  const {
    query: { nextPageToken },
  } = request
  let data = null
  let error = null

  // Start listing users from the beginning, 1000 at a time.
  try {
    data = await getAllUsers(
      Array.isArray(nextPageToken) ? nextPageToken[0] : nextPageToken,
    )
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err)
    error = err
  }

  if (error || data.error) {
    const err = error || data.error
    return nextHandleJsonResponse(
      response,
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
    )
  }

  return nextHandleJsonResponse(response, HttpStatusCode.OK, {
    status: HttpResponseStatus.SUCCESS,
    data,
  })
}

export default use(
  csrfApiMiddleware,
  httpRequestMethodMiddleware(HttpRequestMethod.GET),
)(users)
