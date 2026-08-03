# @aglyn/shared-util-timestamp

Two entry points. **Which one you import decides whether the Firestore client
ends up in your bundle**, so pick deliberately.

## `@aglyn/shared-util-timestamp` — the `Timestamp` class

```ts
import { Timestamp } from '@aglyn/shared-util-timestamp'

await setDoc(ref, { createdAt: Timestamp.now() })
```

`Timestamp extends` the Firestore SDK's own `Timestamp`. That `extends` is a
**hard runtime dependency** — not type-only, not tree-shakeable — and it is
load-bearing: Firestore's serialiser recognises timestamps by `instanceof`
against its own class. An object that fails that check is not written as a
timestamp, so ordering queries and `.toDate()` on read stop working.

Use this anywhere the value is **written into a Firestore document**. That is
the console and the plugin console cards, which already ship the SDK.

## `@aglyn/shared-util-timestamp/timestamp-json` — the serialised shape

```ts
import { timestampNowJson } from '@aglyn/shared-util-timestamp/timestamp-json'

logger.debug(timestampNowJson(), event, payload)
```

Returns exactly what `Timestamp.now().toJSON()` returns, and imports nothing.
Use it when you only need to **stamp or serialise** — a log line, an emitted
event, a JSON payload — and the value never reaches Firestore.

## Why the split exists (AGL-1151)

Every tenant site was shipping the Firestore client in its eagerly-loaded page
chunk. The route was two calls to `Timestamp.now().toJSON()` in `libs/aglyn` —
both formatting log lines. Nothing on a published site writes to Firestore from
the browser; the SDK was pure weight.

`timestamp-json.isolation.spec.ts` guards this and is worth understanding before
editing either module: it asserts that requiring `timestamp-json` loads no
`firebase` module. Its first version sat beside the behavioural tests, which
import `./timestamp`, so `firebase` was already cached before the check ran and
it passed just as happily when the isolation was broken. If you touch that test,
break the isolation on purpose and confirm it fails — a green run proves nothing
on its own.

The type-only `ITimestamp` is safe to import from the root anywhere, since
`import type` is erased.

## Running unit tests

`npx jest --config libs/shared/util/timestamp/jest.config.ts`

(`nx test` leaks the root `.env`; run bare jest.)
