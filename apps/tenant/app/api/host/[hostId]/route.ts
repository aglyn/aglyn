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
  appHandleJsonError,
  appHandleJsonSuccess,
} from '@aglyn/shared-util-rest-api'
import getHost from '../../../../utils/get-host'

export const dynamic = 'force-dynamic'

/**
 * Host lookup by `?host=` (SEO Toolkit / preview). GET only — App Router
 * replies 405 to other methods natively, replacing the Pages Router
 * `httpRequestMethodMiddleware(GET)` wrapper.
 */
export async function GET(request: Request): Promise<Response> {
  const host = new URL(request.url).searchParams.get('host')
  if (!host) return appHandleJsonError(new Error('Bad request'))

  let data = null
  let error = null
  try {
    data = await getHost({ host })
    if (data?.error) error = data?.error
  } catch (err) {
    console.error(err)
    error = err
  }

  if (error) return appHandleJsonError(error)
  return appHandleJsonSuccess(data)
}
