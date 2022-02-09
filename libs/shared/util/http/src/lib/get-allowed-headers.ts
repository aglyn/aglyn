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

/**
 * If `allowed` param is not provided retrieves `Access-Control-Request-Headers`
 * header value from the `req` param and returns a new {@link Headers} object
 * @param req - HTTP {@link Request} object
 * @param allowed - optionally override which headers to allow
 * @returns a new {@link Headers} object instance
 */
function getAllowedHeaders(req: Request, allowed?: string | string[]) {
  const headers = new Headers()

  if (!allowed) {
    allowed = req.headers.get('Access-Control-Request-Headers')!
    headers.append('Vary', 'Access-Control-Request-Headers')
  }
  else if (Array.isArray(allowed)) {
    // If the allowed headers is an array, turn it into a string
    allowed = allowed.join(',')
  }
  if (allowed) {
    headers.set('Access-Control-Allow-Headers', allowed)
  }

  return headers
}

export {getAllowedHeaders}
export default getAllowedHeaders
