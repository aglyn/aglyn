---
sidebar_position: 5
title: Sandbox security model
description: How sandboxed community plugins are isolated — separate origin, per-manifest CSP, pinned artifacts — and what that means when you write one.
---

# Sandbox security model

Community plugins run **sandboxed by default**: in an iframe on a separate origin,
with a Content-Security-Policy built from your own manifest. This page is what that
means in practice, because most of it only becomes visible when something you wrote
doesn't work.

The alternative tier — realm bundles, which run in the host realm — is covered in
[Realm bundles](../guides/realm-bundles.md).

## A separate origin

Sandbox iframes are served from **`plugins.aglyn.com`**, not from the console or the
site. That's a different origin, so the browser itself — not our code — is what stops
a plugin from touching the host page's DOM, cookies, or storage.

Everything a sandboxed plugin does to the outside world goes through the **bridge**:
declared props in, declared events out. Undeclared props are dropped before your code
sees them, and undeclared events are dropped before the host does.

The loader only allows framing from the console, `*.aglyn.app` sites, and each site's
**verified custom domain** — so your plugin renders on a customer's own domain exactly
as it does on their `aglyn.app` address.

## Per-manifest network policy

This is the one that surprises people.

The loader stamps a CSP whose `connect-src` is **`'self'` plus exactly the origins you
declared** in your manifest's `capabilities.network`. A `fetch` to anywhere else is
blocked by the browser.

```json
{
  "capabilities": {
    "network": ["https://api.example.com"]
  }
}
```

With that manifest, `fetch('https://api.example.com/…')` works and
`fetch('https://api.other.com/…')` does not.

:::warning The failure mode is a CSP error, not a 4xx
A blocked request never reaches the network. You'll see a CSP violation in the browser
console and a rejected promise — not an HTTP status. If a request "just fails" with no
response, check your manifest's `network` list first.
:::

If the manifest lookup fails for any reason, the loader falls back to `'self'` — the
strict end. It never fails open.

### When you can't declare the origin

Declaring every origin up front doesn't fit every case — a URL the site owner
configures, or an API that redirects across hosts. For those, use the host-mediated
**`hostFetch`** escape hatch: the request is made by the host, subject to its own
rules, and the response is handed back over the bridge. See
[Server APIs](../guides/server-apis.md).

## Pinned, immutable artifacts

Bundles are streamed from a private bucket at
`/artifacts/{listing}/{version}/{sha}.bundle`, and **every consumer verifies the
sha256** before running a byte of it.

Installs pin `{version, sha256}`, so:

- You can never change the code an existing install runs. Ship a new version.
- A tampered artifact fails the hash check and doesn't execute.
- "Update to vX" is always an explicit act by the person who installed it.

## What this means when you build

- **Declare `network` honestly and minimally.** It's both your allowlist and a
  disclosure buyers read — an over-broad list costs you trust in review.
- **Test in the sandbox, not just locally.** A plugin that works against a dev server
  with no CSP will hit the policy the moment it's published.
- **Document data & permissions in your README.** Unverified sandbox listings show
  buyers a risk disclaimer; clear docs are what overcomes it.
- **Don't reach for realm trust to dodge the CSP.** Realm trust is granted by Aglyn
  staff for a specific reviewed version, not on request.

## Related

- [Manifest & environments](manifest-and-envs.md) — the `capabilities` block.
- [Realm bundles](../guides/realm-bundles.md) — the trusted tier and how trust is
  granted.
- [Publisher handbook](../publishing/publisher-handbook.md) — review expectations.
