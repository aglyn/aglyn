# Office Hours

Shows whether you're **open right now**, and when you next open or close, from
a weekly schedule you set as props. Drop it on a contact page, a footer, or a
site dashboard.

## What it does

- Reads a `HH:MM-HH:MM` window per day (comma-separate for split hours, e.g.
  `09:00-12:00,13:00-17:00`). An empty day means closed.
- Renders the current status plus the full week, theme-aware in light and dark.
- Re-checks once a minute and emits `opened` / `closed` **when the status
  changes** — not on every tick.

## Data and permissions

**None.** The schedule arrives as props, so this plugin reads no site data,
stores nothing, and sends nothing anywhere. Its manifest declares **no network
hosts**, which means its CSP `connect-src` is empty — it could not reach an
external origin even if its code tried.

## Props

| Prop | What it does | Default |
| --- | --- | --- |
| `title` | Heading above the status | `Office hours` |
| `sunday` … `saturday` | That day's window(s), or empty for closed | Mon–Fri `09:00-17:00` |
| `openLabel` / `closedLabel` | Wording for the two states | `Open now` / `Closed` |
| `accent` | Any CSS colour for the "open" dot | `#16a34a` |

## Events

| Event | When |
| --- | --- |
| `opened` | The status crosses from closed to open |
| `closed` | The status crosses from open to closed |

Neither fires on first paint — only on a change — so a listener can treat them
as transitions.

## Times and time zones

All times are the **viewer's** local clock, because that is what `Date` gives a
sandboxed bundle. If your audience is in a different zone from your premises,
say so in the title (`Office hours (PT)`), or wait for host-provided time-zone
context.

## Building

There's no build step. `dist/plugin.bundle.mjs` is hand-written and already
self-contained: no static imports, no `eval`, no browser storage. Verify it the
same way the publish API does:

```bash
node tools/scripts/verify-plugin-bundle.mjs examples/plugins/office-hours/dist/plugin.bundle.mjs
```

## License

Apache-2.0, same as the rest of this repository.
