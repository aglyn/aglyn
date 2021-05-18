import { _isUndef } from '@aglyn/common/tools/guards'
import { Res, Logger } from 'lib/api'
import { ApiHandler, ApiRequest, ApiResponse, ApiHandlerWithRequestProp, ApiRequestWithProp } from 'middleware/middleware-tools'
import { verifyIdToken } from '../../lib/firebase/server-app'

export const requireHeader = (
  name: string,
  key: keyof ApiRequest['headers'],
  handler: ApiHandlerWithRequestProp<typeof name, ApiRequest['headers'][typeof key]>
) => {
  type MergedReq = ApiRequestWithProp<typeof name, ApiRequest['headers'][typeof key]>
  return async (req: ApiRequest, res: ApiResponse) => {
    try {
      const newReq = req as MergedReq
      const header = req.headers[key]
      if (_isUndef(header)) {
        throw new Error(`Missing required header - (key: ${key})!`)
      }
      newReq[name] = header
      return await handler(newReq, res)
    } catch (error) {
      const json = Res.Error.missingHeader
      Logger.traceError(json, error)
      return res.status(json.error.statusCode).json(json)
    }
  }
}

export const withIdTokenHeader = (handler: ApiHandlerWithRequestProp<'idToken', string>) => {
  return requireHeader('idToken', 'id-token', handler)
}

export const withCsrfTokenHeader = (handler: ApiHandlerWithRequestProp<'csrfToken', string>) => {
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
