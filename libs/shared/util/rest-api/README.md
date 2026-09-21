# @aglyn/shared-util-rest-api

Helpers for writing JSON API routes in Next.js: one response envelope for both the Pages Router (`NextApiResponse`) and the App Router (Web `Response`), plus small middleware and cookie utilities. Published mainly as a building block for Aglyn's own apps; usable in any Next.js project that wants the same envelope.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-util-rest-api@beta

Peer dependency: `next` (`16.3.3`).

## What's in it

Everything is exported from the package root; each module is also reachable as `@aglyn/shared-util-rest-api/<file-name>`.

The envelope, `JsonResponse`:

```ts
type JsonResponse = {
  error?: any
  errorCode?: HttpRefCode
  status?: HttpResponseStatus | true
  statusCode?: HttpStatusCode
  statusMessage?: string
  data?: any
}
```

- App Router (`route.ts`): `appHandleJsonResponse(statusCode, options?)`, `appHandleJsonSuccess(data)`, `appHandleJsonError(error)` - each returns a `Response`.
- Pages Router: `nextHandleJsonResponse(res, statusCode, options?)`, `nextHandleJsonSuccess(res, data)`, `nextHandleJsonError(res, error)` - each writes to a `NextApiResponse`. Both families put the same shape on the wire. The error variants take the status from `error.code` or `error.statusCode` (default 500) and the message from `error.message` or `error.statusMessage`.
- `createNewJsonResponse(statusCode, options?)` - a bare `Response` with a JSON content type, for middleware.
- `httpRequestMethodMiddleware(allowed)` - a `next-api-middleware` middleware that answers 405 for methods other than the allowed ones (`OPTIONS` always passes).
- `initializeMiddleware(middleware)` - wraps a Connect-style `(req, res, next)` middleware in a promise.
- `requireHeader(name, key, handler)` and `withIdTokenHeader(handler)` - wrap a Pages Router handler and answer 400 when the header (`id-token` for the latter) is missing.
- `getApiRequestCookie(name, request?)` and `setApiResponseCookie(res, name, value, options?)`. `setApiResponseCookie` takes `maxAge` in milliseconds and serializes object values as `j:` plus JSON.

## Usage

```ts
// app/api/things/route.ts
import {
  appHandleJsonError,
  appHandleJsonSuccess,
} from '@aglyn/shared-util-rest-api'

export async function GET() {
  try {
    return appHandleJsonSuccess({ things: [] })
  } catch (error) {
    return appHandleJsonError(error)
  }
}
```

Note that `appHandleJsonError` and `nextHandleJsonError` include the error object itself in the body, so pass them errors that are safe to show to the caller.

## How it fits

A `shared` package: generic, with no knowledge of Aglyn's model. Shared packages may only import other shared packages; this one depends on `@aglyn/shared-data-enums` (status codes and reference codes), `@aglyn/shared-util-errors` and `@aglyn/shared-util-http`. No other library in the monorepo depends on it; Aglyn's apps use it in their API routes.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/util/rest-api
