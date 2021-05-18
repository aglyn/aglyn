import { serialize, CookieSerializeOptions } from 'cookie'
import { NextApiRequest, NextApiResponse } from 'next'

export type ApiRequest = NextApiRequest
export type ApiRequestWithProp<K extends string, U> = ApiRequest & { [P in K]?: U }
export type ApiResponse<T = any> = NextApiResponse<T>
export type ApiHandler<T = any> = (
  req: ApiRequest,
  res: ApiResponse<T>
) => void | Promise<void>
export type ApiHandlerWithRequestProp<K extends string = any, U = any, T = any> = (
  req: ApiRequestWithProp<K, U>,
  res: ApiResponse<T>
) => void | Promise<void>


/**
 * API Middleware result
 */
export type ApiMiddlewareResult<T> = T | PromiseLike<T> | Error
export type ApiMiddlewareResultResponse<T> = void | Promise<T | void>
/**
 * API Middleware result function
 */
export type ApiMiddlewareResultFn = {
  <T>(result: ApiMiddlewareResult<T>): ApiMiddlewareResultResponse<T>
}
/**
 * API middleware function
 */
export interface ApiMiddleware {
  (req: ApiRequest, res: NextApiResponse<any>, finish: ApiMiddlewareResultFn): void
}

export type ApiMiddlewareHoc = (handler: ApiHandler) => ApiHandler

/**
 * Helper method to wait for a middleware to execute before continuing
 * And to throw an error when an error happens in a middleware
 *
 * EXAMPLE BELOW
 * const apiHandler: ApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
 *   // Run the middleware
 *   await resolveApiMiddleware(req, res, cors)
 * }
 *
 * @param {ApiRequest} req
 * @param {ApiResponse} res
 * @param {ApiMiddleware} middleware
 */
export function runApiMiddleware<T>(
  req: ApiRequest,
  res: ApiResponse,
  middleware: ApiMiddleware
): Promise<ApiMiddlewareResult<T>> {
  return new Promise((resolve, reject) => {
    const onComplete = <T>(result: ApiMiddlewareResult<T>) => {
      return result instanceof Error
        ? reject(result)
        : resolve(result as any) // TODO: Fix any type
    }
    middleware(req, res, onComplete)
  })
}

/**
 * Helper method to wait for a middleware to execute before continuing
 * And to throw an error when an Error happens in a middleware
 *
 * EXAMPLE BELOW
 * const cors = initApiMiddleware(
 *   Cors({
 *     // Only allow requests with GET, POST and OPTIONS
 *     methods: ['GET', 'POST', 'OPTIONS'],
 *   })
 * )
 * const apiHandler: ApiHandler = async (req: ApiRequest, res: NextApiResponse) => {
 *   // Run the middleware
 *   await cors(req, res)
 * }
 *
 * @param {ApiMiddleware} middleware
 */
export function initApiMiddleware(middleware: ApiMiddleware) {
  return (
    req: ApiRequest,
    res: ApiResponse
  ) => runApiMiddleware(req, res, middleware)
}

/**
 * Helper function to build hoc api middleware
 *
 * EXAMPLE BELOW
 * const requireIdToken: ApiMiddlewareHoc = (handler: ApiHandler) => {
 *   return withApiMiddleware(withDecodedIdToken, handler)
 * }
 *
 * @param middleware
 * @param handler
 */
export function withApiMiddleware(middleware: ApiMiddleware, handler: ApiHandler) {
  return (req: ApiRequest, res: ApiResponse) => {
    return runApiMiddleware(req, res, middleware).then((value) => {
      return handler({ middlewareResult: value, ...req } as any, res)
    })
  }
}

/**
 * This sets a cookie value on the nextjs response object
 *
 * EXAMPLE BELOW:
 * setCookie(res, 'Next.js', 'api-middleware!')
 *
 * @export
 * @param {NextApiResponse} res
 * @param {string} cookieName
 * @param {unknown} cookieValue
 * @param {CookieSerializeOptions} [options={}]
 */
export function setApiCookie(
  res: ApiResponse,
  cookieName: string,
  cookieValue: unknown,
  options: CookieSerializeOptions = {}
) {
  const str = String(
    typeof cookieValue === 'object'
      ? 'j:' + JSON.stringify(cookieValue)
      : cookieValue
  )

  if ('maxAge' in options) {
    options.expires = new Date(Date.now() + options.maxAge)
    options.maxAge /= 1000
  }
  res.setHeader('Set-Cookie', serialize(cookieName, str, options))
}
