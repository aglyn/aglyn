# @aglyn/shared-util-errors

Error classes shared across the Aglyn packages: an HTTP response error, an upstream-vendor error, and a factory for namespaced, templated errors with stable codes. A small dependency of other Aglyn packages, usable on its own.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-util-errors@beta

No peer dependencies.

## What's in it

All exported from the package root:

- `HttpResponseError(code, message)` - an `Error` carrying an HTTP status in `code` (an `HttpStatusCode` from `@aglyn/shared-data-enums`).
- `UpstreamServiceError(message, { status, retryable, requestId? })` - a failed call to a third-party service. `message` is meant to be a fixed sentence that is safe to show a customer; the vendor's own wording is not carried on the object. `retryable` says whether the vendor asked to come back later (a rate limit or overload) as opposed to rejecting the request.
- `NsErrorFactory(scope, namespace, templates, nsDelimiter = '/', scopeDelimiter = ':', defaultMessage = 'Error')` - builds `NsError` instances from a map of flag to message template. `create(flag, payload?)` fills `{$name}` placeholders from the payload; `childFactory(childNamespace, templates?)` derives a factory under a nested namespace.
- `NsError` - has `code` (`namespace/flag`), `message` and `payload`.
- `replaceTemplate(template, payload?, options?)` - the `{$name}` placeholder substitution by itself, and `DEFAULT_REPLACER_REGEX`.
- Types: `ErrorPayload`, `ErrorTagMessages`, `ErrorTagPayloads`, `EventFlag`.

## Usage

```ts
import {
  NsErrorFactory,
  UpstreamServiceError,
} from '@aglyn/shared-util-errors'

const errors = new NsErrorFactory('my-app', 'files', {
  'not-found': "Could not find file '{$file}'",
})

try {
  throw errors.create('not-found', { file: 'foo.txt' })
} catch (e) {
  // e.code === 'files/not-found'; e.payload.file === 'foo.txt'
}

throw new UpstreamServiceError('The provider is busy. Try again shortly.', {
  status: 429,
  retryable: true,
})
```

## Import-time effect

This package imports the root of `@aglyn/shared-util-tools`, and that root defines a set of non-enumerable `$_`-prefixed methods on `Array.prototype` when it loads. See that package's README for the exact list.

## How it fits

A `shared` package: generic, with no knowledge of Aglyn's model. Shared packages may only import other shared packages; this one depends on `@aglyn/shared-data-enums` and `@aglyn/shared-util-tools`. `@aglyn/shared-util-rest-api` and `@aglyn/plugins-ai` depend on it.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/util/errors
