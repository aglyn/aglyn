# @aglyn/shared-util-fbserver

Server-side Firebase Admin bootstrap: one module that initializes the `firebase-admin` default app from environment variables and exposes Firestore and Auth accessors. It is mainly an internal building block of Aglyn's server-side data layer (`@aglyn/tenant-data-admin`); install it directly only if you want the same bootstrap in your own Node process.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-util-fbserver@beta

Peer dependency: `firebase-admin` (`^14.3.0`).

## What's in it

A single module, `src/lib/fbserver`, re-exported from the package root:

- `fbAdmin` (also the default export) - a small facade over the modular Admin SDK:
  - `fbAdmin.firestore(app?)` returns a Firestore instance; `fbAdmin.firestore.FieldValue` and `fbAdmin.firestore.Timestamp` are the Admin SDK classes.
  - `fbAdmin.auth(app?)` returns the Auth service.
- `fbAdminApp` - the initialized `App`, or `undefined` when initialization was skipped.
- `verifyIdToken(idToken)` - verifies a Firebase ID token with revocation checking always on.
- `firestoreDatabaseId()` - reads `FIRESTORE_DATABASE_ID`; when set, `fbAdmin.firestore()` targets that named database instead of `(default)`.

### It initializes on import

Importing this package runs the bootstrap. If a Firebase app already exists it is reused. Otherwise the module reads:

| Variable | Required | Purpose |
| -- | -- | -- |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | yes | project id |
| `FIREBASE_CLIENT_EMAIL` | yes | service account email |
| `FIREBASE_PRIVATE_KEY` | yes | service account key; literal `\n` sequences are converted to newlines |
| `NEXT_PUBLIC_FIREBASE_DATABASE_URL` | no | Realtime Database URL |
| `FIRESTORE_DATABASE_ID` | no | named Firestore database, read at call time |

If any of the three required variables is missing, initialization is skipped silently so that a build step which merely loads the module does not crash. Nothing is initialized in that case, and a later `fbAdmin.firestore()` or `fbAdmin.auth()` call fails unless you initialized a default app yourself.

`package.json` lists `./src/lib/fbserver.*` under `sideEffects`. That tells bundlers the import must be kept even when nothing from it appears to be used, because the import itself is what initializes the app. For a consumer it means: this is a server-only module with an import-time effect. Never import it from code that can reach a browser bundle, and expect the app to exist (or be skipped) the moment the module loads.

## Usage

```ts
import fbAdmin, { verifyIdToken } from '@aglyn/shared-util-fbserver'

const decoded = await verifyIdToken(idToken)
const snap = await fbAdmin.firestore().doc(`users/${decoded.uid}`).get()
const now = fbAdmin.firestore.Timestamp.now()
```

## How it fits

A `shared` package: generic, with no knowledge of Aglyn's model, and it imports no other Aglyn package. Shared packages may only import other shared packages, and they hold no plugin's domain. In the monorepo it is consumed by `@aglyn/tenant-data-admin`, the Admin SDK data layer.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/util/fbserver
