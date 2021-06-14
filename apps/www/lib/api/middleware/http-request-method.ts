/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { NextMiddleware } from 'next-api-middleware'
import { Logger, Req, Res } from '../helpers'
import { NextFn } from '../tools/middleware'
import { ApiRequest, ApiResponse } from '../types'


export function httpRequestMethod(allowed: Req.Method[]): NextMiddleware {
  return async (req: ApiRequest, res: ApiResponse, next: NextFn) => {
    const { method } = req
    if (allowed.includes(method as Req.Method)) {
      await next()
    } else {
      const json = Res.Error.requestMethodCheck
      Logger.traceError(json, { method })
      res.setHeader('Allow', allowed)
      res.status(json.error.statusCode).json(json)
      res.end()
    }
  }
}

export default httpRequestMethod
