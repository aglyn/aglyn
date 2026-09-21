# @aglyn/shared-util-next

React hooks and helpers for carrying a `?continue=` return URL through a Next.js App Router sign-in flow without creating an open redirect. It is used by Aglyn's console sign-in pages and is usable in any App Router app.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-util-next@beta

Peer dependencies: `next` (`16.3.3`) and `react` (`^19.2.8`).

## What's in it

One client module (`'use client'`), `use-continue-url`, re-exported from the package root:

- `useContinueUrl()` - returns `[encoded, decoded, pushNext]`: the current pathname URL-encoded (to put into a link to the sign-in page), the validated `continue` value from the query string (or `''`), and a function that navigates to it.
- `useContinueUrlDecoded()` - `[decoded, pushNext]`. `pushNext(url = '/')` goes to the continue URL when there is a safe one, otherwise to `url`. Relative targets use `router.push`; absolute ones use `window.location.assign`.
- `useContinueUrlEncoded()` - the encoded current pathname only.
- `useContinueHref(path)` - an `href` for a link out of the current page that keeps the `continue` value. Reads only `useSearchParams`, not the router.
- `withContinueUrl(path, continueUrl)` - the same, as a plain function. Unsafe or empty values append nothing.
- `isSafeContinueUrl(url)` - the predicate behind all of the above.
- `ContinueParamName` (`'continue'`) and `continueParam(value)`.

A continue URL is accepted when it is a relative path that resolves onto the current origin (checked with `isSameOriginPath` from `@aglyn/shared-util-http/safe-redirect`), or an absolute `https:` URL whose host is the workspace domain or a subdomain of it. The workspace domain comes from `NEXT_PUBLIC_WORKSPACE_DOMAIN` and defaults to `aglyn.com`, so set that variable when you use this outside Aglyn. Everything else is treated as absent.

## Usage

```tsx
'use client'

import { useContinueHref, useContinueUrlDecoded } from '@aglyn/shared-util-next'

export function AfterSignIn() {
  const [, pushNext] = useContinueUrlDecoded()
  const ssoHref = useContinueHref('/sso')

  return (
    <>
      <button onClick={() => pushNext('/dashboard')}>Continue</button>
      <a href={ssoHref}>Use single sign-on</a>
    </>
  )
}
```

The hooks call `useSearchParams`, so render them under a `Suspense` boundary as Next.js requires.

## How it fits

A `shared` package: generic, with no knowledge of Aglyn's model. Shared packages may only import other shared packages; this one depends on `@aglyn/shared-util-http`. No other library in the monorepo depends on it; the console app uses it directly.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/util/next
