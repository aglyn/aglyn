# Zen Quote

A sandboxed community plugin that shows one line of public text fetched from
`https://api.github.com/zen`. No build step — `src/index.js` **is** the bundle.

It exists to be the worked example of the thing no other example in this repo
does: **a plugin that declares a network origin and uses it.**

```
examples/plugins/zen-quote/
├── manifest.json           # id / version / entry / capabilities (incl. network)
├── src/index.js            # authored source
└── dist/plugin.bundle.mjs  # the bundle you upload (copy of src/index.js)
```

## Data and permissions

**It sends nothing.** No props, page content, member data or identifiers leave
the frame: the request has no body, no credentials and no query string. The
response is a short public aphorism, and it is rendered with `textContent`,
never `innerHTML`, so a hostile response cannot inject markup.

It stores nothing — no cookies, no `localStorage`, no `indexedDB`.

## The declared origin

```json
"capabilities": { "network": ["https://api.github.com"] }
```

That one line does two separate jobs:

| Where | What it does |
| -- | -- |
| Publish time | The verifier collects the bundle's `fetch`/XHR/WebSocket/`sendBeacon` calls and diffs them against this list. An origin called but not declared **fails the publish** (AGL-964). |
| Run time | The plugin origin serves this list as the frame's `connect-src`, so this fetch is permitted and a call to any other origin is refused by the browser — measured: fetch, XHR, WebSocket, EventSource and `sendBeacon` all raise `connect-src` violations at `disposition: enforce` (AGL-1092). |

Two consequences worth knowing before you copy this plugin:

- **Declare only what you call.** Over-declaring is the single most common
  reason a submission comes back — the allowlist is your blast radius if the
  bundle is ever compromised.
- **Write the URL inline at the call site.** The checker cannot yet follow a
  URL held in a `const` (AGL-1093); such a call earns a *question* row instead
  of a checked pass, and a reviewer will ask about it.

## Verify

```bash
node tools/scripts/verify-plugin-bundle.mjs examples/plugins/zen-quote/dist/plugin.bundle.mjs
```

Expect a `✓` on every row, with the network row reading
`calls fetch · https://api.github.com (declared)` — that row is the whole point
of this example. It also prints the sha256, the content pin every install
verifies.

## Props

| Prop | What it does | Default |
| -- | -- | -- |
| `title` | Small heading above the line | `Thought for the day` |
| `accent` | Any CSS colour for the heading | `#4f46e5` |

## Events

| Event | When |
| -- | -- |
| `loaded` | The fetch succeeded; payload carries the response length |
| `failed` | The fetch failed or was blocked; payload carries the message |

`failed` firing with a blocked request is the expected behaviour if you remove
the origin from the manifest — a useful thing to try once, to see the boundary
work.

## License

Apache-2.0, same as the rest of this repository.
