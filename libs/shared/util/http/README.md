# @aglyn/shared-util-http

Small HTTP helpers for Fetch API and Next.js request handlers: CORS, request headers, an ID-token cookie, same-origin redirect checks, URL scheme allowlists, and an authenticated `fetch`. It is mainly a dependency of the larger Aglyn packages (`@aglyn/aglyn`, the plugins, the tenant runtime) and is usable on its own.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-util-http@beta

Peer dependency: `next` (`16.3.3`), optional. You need it when you use the helpers that take Next.js objects (`NextRequest`, `NextResponse`, `NextApiRequest`), such as the cookie helpers. The subpath modules below use only web standards.

## What's in it

From the package root:

- CORS: `corsHandleResponse(req, res, options?)` and `corsBuildResponseHandler(options?)`, which curries a reusable configuration. Deny-by-default: with no `origin` option the response is returned untouched. `credentials` is never paired with a `*` origin. Preflight `OPTIONS` requests are answered for you unless `preflightContinue` is set. Lower-level pieces: `getOriginHeaders`, `getOriginHeadersFromRequest`, `getAllowedHeaders`, `isOriginAllowed`.
- `getRequestHeader(request, name)` - reads a header from either a Fetch `Request` or a `NextApiRequest`.
- `getAbsoluteUrl(path, request?)` - builds an absolute URL from the `host` header (server) or `window.location` (browser).
- `cookieGetUserIdToken(request)` / `cookieSetUserIdToken(request, response, token, options?)` - read and write the user ID-token cookie, `httpOnly` by default.
- Types: `CorsOptions`, `StaticOrigin`, `OriginFn`.

By subpath only (not re-exported from the root):

- `@aglyn/shared-util-http/safe-redirect` - `isSameOriginPath(candidate)` and `safeSameOriginPath(candidate, fallback = '/')`. Instead of pattern-matching the string, they resolve it with the URL parser against a probe origin and accept it only if the origin is unchanged, which catches `//host`, `/\host`, and tab or newline tricks alike.
- `@aglyn/shared-util-http/safe-url-scheme` - `hasSafeLinkScheme(value)` (`http`, `https`, `mailto`, `tel`, `sms`, or no scheme) and `hasSafeMediaScheme(value)` (`http`, `https`, or no scheme). They check the scheme only; you still have to escape the value into the attribute afterwards.
- `@aglyn/shared-util-http/authorized-token` - `resolveIdToken(user, options?)`, `authorizedFetch(user, input, init?, options?)`, `describeCallFailure(error, fallback)`, `AuthorizationUnavailableError`, `ID_TOKEN_TIMEOUT_MS`. `user` is anything with a `getIdToken()` method. The token wait has a deadline, and when no token can be had `authorizedFetch` sends nothing and resolves to a `401`-shaped response carrying the reason.

## Usage

```ts
import { corsBuildResponseHandler } from '@aglyn/shared-util-http'
import { safeSameOriginPath } from '@aglyn/shared-util-http/safe-redirect'

const cors = corsBuildResponseHandler({
  origin: ['https://app.example.com'],
  credentials: true,
})

export async function GET(req: Request) {
  return cors(req, Response.json({ ok: true }))
}

// Anything that would leave the origin becomes '/'.
const next = safeSameOriginPath(new URL(location.href).searchParams.get('next'))
```

## How it fits

A `shared` package: generic, with no knowledge of Aglyn's model. Shared packages may only import other shared packages; this one depends on `@aglyn/shared-data-enums` (HTTP status codes and the cookie key). `@aglyn/shared-util-next`, `@aglyn/shared-util-rest-api`, `@aglyn/shared-util-email`, `@aglyn/aglyn`, the tenant runtime packages and most plugins depend on it.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/util/http
