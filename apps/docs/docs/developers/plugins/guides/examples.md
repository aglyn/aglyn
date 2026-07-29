---
sidebar_position: 5
title: Worked examples
description: Where to look for a working example of each plugin pattern.
---

# Worked examples

The best examples are the shipping plugins — each one is the reference
implementation of a pattern. Generated skeletons stay fresh by
construction: `node tools/scripts/create-plugin.mjs sample --surfaces
console,tenantApi` scaffolds a complete, test-passing plugin you can read
and delete. First-party plugin *libs* are deliberately not duplicated as
"example" libs — they would rot, and the scaffolder and the live plugins
can't. The one checked-in example is the **sandbox community plugin**
below, which exists because the sandbox contract has no first-party
equivalent to read.

| Pattern | Read this | Why |
| --- | --- | --- |
| Console-only plugin | `libs/plugins/redirects` | The minimal shape: one nav item + page, server-side enforcement, no canvas bundle |
| Full-stack feature | `libs/plugins/commerce` | Pages, widgets, canvas components, page resolvers, APIs, billing hooks — everything at once |
| Site enricher + runtime pair | `libs/plugins/marketing` | Server enricher writes page props; the registered runtime reads them back |
| Plugin→plugin composition | `libs/plugins/inbox` | Composes tabs from commerce + email — the dependency direction plugins are allowed |
| Site canvas components | `libs/plugins/bookings` | Canvas component + console manager + APIs + a config schema (`maxDaysAhead`) and a scheduled job |
| Custom field type | `libs/plugins/community` (`rating`) | Pure-data type + client Input, registered from both surfaces |
| Plugin permissions | `libs/plugins/commerce` (`managePos`) | Per-tier defaults riding every resolved role set |
| Community realm bundle | `tools/plugin-loader/realm/demo` (+ `EXPLAINED.md`) | The standalone track, narrated line by line |
| Community starter | `tools/plugin-loader/realm/template` | What you actually copy to begin |
| Sandbox community plugin | `examples/plugins/promo-countdown` | A complete, publishable sandbox plugin with no build step — `register()`, render, props, config scheme, emitted events, and cleanup. Passes the bundle verifier as-is, so it doubles as the worked example for [uploading a plugin](../publishing/publisher-handbook.md) |
| Declared network origin | `examples/plugins/zen-quote` | The only example that DECLARES an origin and calls it (`capabilities.network`). Shows both jobs that one line does: the publish-time diff refuses an undeclared origin, and the frame's `connect-src` refuses one at runtime. Write the URL inline — a URL in a `const` is not yet followed (AGL-1093) |
