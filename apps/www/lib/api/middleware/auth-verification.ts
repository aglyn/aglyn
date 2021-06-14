/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { _isUndef } from '@aglyn/shared/util/helpers'
import { Res, Logger } from '../helpers'
import {
  ApiHandler,
  ApiRequest,
  ApiResponse,
} from '../types'
import { verifyIdToken } from '../../firebase/fb-admin'


export const requireHeader = (
  name: string,
  key: keyof ApiRequest['headers'],
  handler: ApiHandler,
) => {
  return async (req: ApiRequest, res: ApiResponse) => {
    const newReq = req
    let error
    try {
      const header = req.headers[key]
      if (_isUndef(header)) {
        throw new Error(`Missing required header - (key: ${key})!`)
      }
      newReq[name] = header
      return
    } catch (err) {
      error = err
    } finally {
      if (error) {
        await handler(newReq, res)
      } else {
        const json = Res.Error.missingHeader
        Logger.traceError(json, error)
        return res.status(json.error.statusCode).json(json)
      }
    }
  }
}

export const withIdTokenHeader = (handler) => {
  return requireHeader('idToken', 'id-token', handler)
}

export const withCsrfTokenHeader = (handler) => {
  return requireHeader('csrfToken', 'csrf-token', handler)
}

export const requireIdToken = (handler: ApiHandler) => {
  return withIdTokenHeader(async (req, res) => {
    try {
      await verifyIdToken(req.idToken)
      return await handler(req, res)
    } catch (error) {
      const json = Res.Error.idTokenCheck
      Logger.traceError(json)
      return res.status(json.error.statusCode).json(json)
    }
  })
}

export const requireCsrfToken = (handler: ApiHandler) => {
  return withCsrfTokenHeader(async (req, res) => {
    try {
      if (req.csrfToken !== req.cookies.csrfToken) {
        throw new Error('CSRF mismatch. Possible break-in attempt!')
      }
      return await handler(req, res)
    } catch (error) {
      const json = Res.Error.csrfTokenCheck
      Logger.traceError(json, error)
      return res.status(json.error.statusCode).json(json)
    }
  })
}

export const secureRequest = (handler: ApiHandler, withCsrf?: boolean) => {
  return withCsrf ? requireIdToken(requireCsrfToken(handler)) : requireIdToken(handler)
}
