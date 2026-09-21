# @aglyn/shared-util-logger

A small leveled logger: named instances, a log level per instance, and a
replaceable handler. The larger Aglyn packages log through it, and it works on
its own. Its shape follows `@firebase/logger`; it depends on nothing.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-util-logger@beta

## Usage

Create one `Logger` per component, named for it:

```typescript
import { Logger, LogLevel } from '@aglyn/shared-util-logger'

const logger = new Logger('@acme/checkout')
logger.setLogLevel(LogLevel.WARN)
logger.warn('inventory is stale', { sku })
```

`logLevel` decides which calls reach the handler. `logHandler` replaces the
default handler, which writes to the console, and `userLogHandler` adds one
that runs beside it, for forwarding logs somewhere else.

Each `Logger` instance supports 5 log functions each to be used in a specific instance:

- `debug`: Internal detail, for diagnosing an issue.
- `log`: Use to inform your user about things they may need to know.
- `info`: Use if you have to inform the user about something that they need to take a concrete
  action on. Once they take that action, the log should go away.
- `warn`: Use when a product feature may stop functioning correctly; unexpected scenario.
- `error`: Only use when user App would stop functioning correctly - super rare!

## Log Format

Each log will be formatted in the following manner:

```typescript
`"[${new Date()}] ${COMPONENT_NAME}: ${...args}"`
```

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/util/logger
