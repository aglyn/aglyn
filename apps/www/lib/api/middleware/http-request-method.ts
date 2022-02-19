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

import type {NextMiddleware} from 'next-api-middleware'
import {Logger, type Req, Res} from '../helpers'
import type {NextFn} from '../tools/middleware'
import type {ApiRequest, ApiResponse} from '../types'


export function httpRequestMethod(allowed: Req.Method[]): NextMiddleware {
  return async (req: ApiRequest, res: ApiResponse, next: NextFn) => {
    const {method} = req
    if (allowed.includes(method as Req.Method)) {
      await next()
    }
    else {
      const json = Res.Error.requestMethodCheck
      Logger.traceError(json, {method})
      res.setHeader('Allow', allowed)
      res.status(json.error.statusCode).json(json)
      res.end()
    }
  }
}

export default httpRequestMethod
