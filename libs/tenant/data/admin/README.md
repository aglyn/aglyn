# @aglyn/tenant-data-admin

The server data layer of Aglyn's tenant runtime: the Firebase Admin setup,
typed Firestore converters, and the server-side modules that read and write
platform data with admin credentials. It is mainly an internal building block
of `@aglyn/tenant-runtime`, of Aglyn's server apps, and of the server half of
the `@aglyn/plugins-*` packages. Install it directly only if you are writing
server code against an Aglyn deployment's Firestore.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/tenant-data-admin@beta

Peer dependencies:

- `firebase-admin`
- `next` (the render cache uses `next/cache`, and two request handlers use
  Next's API route types)
- `react` (one module uses React's `cache`)

This package is server-only. It uses Node built-ins and admin credentials and
must not be imported from client code. It depends on `sharp` for image
variants.

## What's in it

The root export is one barrel over `src/lib/server`. Its main areas:

- Firebase Admin: `firebaseAdmin`, Firestore converters for the core documents
  (`hostConverter`, `screenConverter`, `screenVersionConverter`,
  `layoutConverter`, `layoutVersionConverter`), and ID-token checks such as
  `verifyConsoleIdToken` and `isEmailVerified`.
- Access: API keys (`mintApiKey`, `verifyApiKey`, `listApiKeys`,
  `revokeApiKey`, `API_SCOPES`), host memberships, organizations, edit-access
  tokens, auth handoff, SSO policy and provisioning, token revocation and
  lockdown.
- Domains: workspace domains behind a `DomainProvider` seam
  (`domainProvider`), console domains, DNS probing, and email sending domains.
- Email: suppression, unsubscribe links, topic confirmation, metering, the
  send-rate governor, the marketing gate and sender reputation.
- Contacts and CRM records: contact upsert, merge, email index, company links,
  list members and CRM activity records.
- Media: storage paths, signing, download tokens, variants, quarantine,
  tombstones, delivery and the CDN request handler.
- Privacy: erasure (`erase`, `erase-person`) and personal data export.
- Abuse limits: rate-limit store, visitor write and console API rate limits,
  password-reset, verify-email and membership-recovery throttles.
- Organization billing documents (`org-billing`), release flags, notifications, and log-drain
  signature checks.

Importing the root has side effects, on purpose: evaluating
`email-send-rate` and `email-marketing-gate` installs the platform send-rate
governor and the marketing gate on the shared email sender, so every server
surface that imports this package gets them without a call.

By subpath:

- `@aglyn/tenant-data-admin/render-cache` has `withRenderCache`, the cache
  tags (`tenantDataTag`, `tenantHostAliasTag`) and TTL constants used for
  published site data.
- Any file under `src/lib`, for example
  `@aglyn/tenant-data-admin/server/api-keys`, to import one module without the
  barrel and its side effects.

## Usage

```ts
import { verifyApiKey } from '@aglyn/tenant-data-admin/server/api-keys'
import { withRenderCache } from '@aglyn/tenant-data-admin/render-cache'
```

```ts
import { firebaseAdmin, hostConverter } from '@aglyn/tenant-data-admin'
```

## How it fits

This is the data piece of the `tenant` scope in the package map. It imports
the core (`@aglyn/aglyn`) and generic `@aglyn/shared-*` utilities, and nothing
above it. `@aglyn/tenant-runtime` reads through it, and a plugin's server code
may import it; it never imports a plugin.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/tenant/data/admin
