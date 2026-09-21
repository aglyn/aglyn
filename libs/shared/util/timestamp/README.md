# @aglyn/shared-util-timestamp

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-util-timestamp@beta

A point in time at nanosecond resolution, the JSON shape it serializes to, and
calendar math in a named time zone. None of the three imports the Firestore
SDK, or anything else.

## `@aglyn/shared-util-timestamp` — the `Timestamp` class

```ts
import { Timestamp } from '@aglyn/shared-util-timestamp'

await setDoc(ref, { createdAt: Timestamp.now() })
```

`Timestamp` has the members Firestore's own timestamp has — `seconds`,
`nanoseconds`, `toDate()`, `toMillis()`, `isEqual()` — and it extends the
built-in `Date`. That base is deliberate. Firestore's client accepts a field
value that is `instanceof Date` and writes it as a real timestamp, so a value
from this class can be written into a document as it is, while the package
itself depends on no SDK. A plain custom class would be refused by Firestore as
an unsupported field value.

Three members differ from `Date` on purpose: `valueOf()` returns a zero-padded
string that orders correctly, `toJSON()` returns `{ seconds, nanoseconds, type }`,
and `toString()` returns the `Timestamp(seconds=…, nanoseconds=…)` form.

## `@aglyn/shared-util-timestamp/timestamp-json` — the serialized shape

```ts
import { timestampNowJson } from '@aglyn/shared-util-timestamp/timestamp-json'

logger.debug(timestampNowJson(), event, payload)
```

Returns exactly what `Timestamp.now().toJSON()` returns, and imports nothing.
Use it when you only need to **stamp or serialize** — a log line, an emitted
event, a JSON payload — and the value never reaches Firestore.

## `@aglyn/shared-util-timestamp/zoned-time` — calendar math in a named zone

```ts
import {
  addZonedBusinessDays,
  nextWeeklyOpening,
  zonedDateTime,
} from '@aglyn/shared-util-timestamp/zoned-time'

zonedDateTime(Date.now(), 'America/Chicago').weekday
```

The wall clock an IANA zone shows for an instant, the instant a wall time
happens at (the spring gap moves forward, the autumn overlap takes the earlier
pass), day boundaries, business days, and weekly schedules of open stretches.
It is the one copy the booking slots, the CRM digest and the Sequences send
windows read. Imports nothing, like `timestamp-json`, and
`zoned-time.isolation.spec.ts` holds it to that.

## Why `timestamp-json` is its own entry point

Code that only stamps a log line or an event has no use for the class, so the
serialized shape is available without it. `ITimestamp`, the structural type, is
safe to import from the root anywhere: a type import is erased.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/util/timestamp
