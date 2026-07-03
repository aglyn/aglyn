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

import { HttpRequestMethod } from '@aglyn/shared-data-enums'
import {
  httpRequestMethodMiddleware,
  nextHandleJsonError,
  nextHandleJsonSuccess,
} from '@aglyn/shared-util-rest-api'
import type { NextApiRequest, NextApiResponse } from 'next'
import { use as withMiddleware } from 'next-api-middleware'
import getAllScreens from '../../../utils/get-all-screens'

async function handler(request: NextApiRequest, response: NextApiResponse) {
  const {
    query: { nextPageToken, host },
  } = request

  if (!host) return nextHandleJsonError(response, new Error('Bad request'))

  let data = null
  let error = null
  // Start listing users from the beginning, 1000 at a time.
  try {
    data = await getAllScreens(host as string, nextPageToken as string)
    if (data?.error) error = data?.error
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err)
    error = err
  }

  if (error) return nextHandleJsonError(response, error)

  return nextHandleJsonSuccess(response, data)
}

export default withMiddleware(httpRequestMethodMiddleware(HttpRequestMethod.GET))(handler)
