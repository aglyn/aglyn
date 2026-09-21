# @aglyn/tenant-feature-instance

Client-side React hooks for working with one Aglyn site instance over the
Firebase web SDK: the Firebase services provider, Firestore document and
collection hooks, and typed hooks for hosts, screens, layouts, components and
their versions. It is mainly an internal building block: the Aglyn console and
the console halves of the `@aglyn/plugins-*` packages read and write site data
through it. Install it directly only if you are building a client against an
Aglyn deployment's Firestore.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/tenant-feature-instance@beta

Peer dependencies:

- `react`
- `firebase`
- `@mui/material` (for the duplicate-resource dialog)

## What's in it

Firebase services:

- `FirebaseServicesProvider` initializes the Firebase app from a
  `firebaseConfig` and `appName`, and chooses auth persistence and the
  Firestore local cache from its `authPersistence` prop.
- `useFirebaseApp`, `useFirestore`, `useAuth`, `useAnalytics`,
  `useRemoteConfig`, `useUser` and `useSigninCheck` read from it.
- `fbClientAppOptions` and `FIREBASE_CLIENT_APP_NAME` are the client
  configuration Aglyn's apps use, read from environment variables.

Generic Firestore hooks:

- `useFirestoreDoc` and `useFirestoreCollection` subscribe to a reference or
  query built by the caller and return `data`, `status`, `error` and whether
  the data still has pending local writes.
- `usePagedCollection`, the sorted paged collection hook and the switcher
  collection hook page through larger collections.
- `useDoc`, `useDocData` and the modify-doc callback are the lower-level
  helpers the typed hooks are built from.

Typed hooks over the platform model in `@aglyn/aglyn`:

- `useHost`, `useScreen`, `useScreenVersion`, `useLayout`, `useLayoutVersion`,
  `useComponent`, the component version and form version hooks, and their
  `...Ref` counterparts (`useHostRef`, `useScreenRef` and so on).
- `usePluginConfig` and `useSitePluginConfig` for a plugin's stored
  configuration.
- `useOrgPlan`, the host organization id, organization member options, scope
  tokens and host campaigns hooks.
- `useHostResourceApi`, `useHostVersionApi` and the duplicate-resource hook
  and dialog (`DuplicateResourceDialog`) call the console's resource APIs.

Saving node trees:

- `saveNodesGuarded` and the guarded seed write save a document's nodes
  against a baseline, and the Besigner nodes converter maps stored nodes to
  and from the editor's form.

Constants: reserved site paths such as `API_DIR` and `STATIC_DIR`.

Every file under `src/lib` is also reachable by subpath, for example
`@aglyn/tenant-feature-instance/hooks/use-firestore-doc`.

## Usage

```tsx
import {
  FIREBASE_CLIENT_APP_NAME,
  FirebaseServicesProvider,
  fbClientAppOptions,
  useHost,
} from '@aglyn/tenant-feature-instance'

function HostName({ hostId }: { hostId: string }) {
  const { status, data } = useHost({ hostId })
  if (status !== 'success') return null
  return <span>{data?.displayName}</span>
}

export function App() {
  return (
    <FirebaseServicesProvider
      firebaseConfig={fbClientAppOptions}
      appName={FIREBASE_CLIENT_APP_NAME}
    >
      <HostName hostId="my-host" />
    </FirebaseServicesProvider>
  )
}
```

## How it fits

This is a feature piece of the `tenant` scope in the package map. It imports
the core (`@aglyn/aglyn`) and generic `@aglyn/shared-*` packages. It is the
client counterpart of `@aglyn/tenant-data-admin`, which does the same job on
the server with admin credentials. Plugins may import it; it never imports a
plugin.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/tenant/feature/instance
