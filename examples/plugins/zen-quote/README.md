# Zen Quote

A sandboxed marketplace plugin that shows one line of public text fetched from
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

One consequence worth knowing before you copy this plugin: **declare only what
you call.** Over-declaring is the single most common reason a submission comes
back — the allowlist is your blast radius if the bundle is ever compromised.

The URL lives in a `const` here, which the checker resolves (AGL-1093), as it
does a template or a concatenation built from constants. What it deliberately
will not guess is a name that is reassigned, shadowed by a parameter, or
declared twice — those calls report as *"a URL only known at runtime"* and a
reviewer will ask about them. A URL built from a prop or from `location` is
always in that group.

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
