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
import {HttpRequestMethod, HttpStatusCode} from '@aglyn/shared-data-enums'
import {csrfApiMiddleware} from '@aglyn/shared-util-next'
import {httpRequestMethodMiddleware, nextHandleJsonResponse} from '@aglyn/shared-util-rest-api'
import type {NextApiRequest, NextApiResponse} from 'next'
import {use} from 'next-api-middleware'


async function signin(request: NextApiRequest, response: NextApiResponse) {
  // try {
  //   await setAuthCookies(req, res)
  // }
  // catch (e) {
  //   // eslint-disable-next-line no-console
  //   console.error(e)
  //   return res.status(500).json({error: 'Unexpected error.'})
  // }
  nextHandleJsonResponse(response, HttpStatusCode.OK, {status: true})
}

export default use(
  csrfApiMiddleware,
  httpRequestMethodMiddleware(HttpRequestMethod.POST),
)(signin)
