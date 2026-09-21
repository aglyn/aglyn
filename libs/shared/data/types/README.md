# @aglyn/shared-data-types

TypeScript types and interfaces shared across the Aglyn packages: lifecycle and CRUD contracts, a normalized-data shape, semantic-version string types, the serializable host theme document, and a `DoD` namespace of document-database modeling types. It is mainly a dependency of the larger `@aglyn/*` packages.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-data-types@beta

No peer dependencies.

## What's in it

Almost everything here is type-only. The `DoD` namespace also carries a few runtime values (`Eval`, `Sig`, `lbl`, `Persistance`).

- `lifecycle` — `LifecycleObserver` (`onInit` / `onDestroy`), `LoadableObserver` (`onLoad` / `onUnload`) and `LoadableLifecycleObserver`.
- `initializable` — the `Initializable` interface.
- `crud` — `CrudModel`.
- `normalized` — `NormalizedData` and `NormalizedModel`.
- `semantic` — the `Version` namespace of template-literal types for semantic version strings.
- `host-theme` — `HostTheme` and its parts (`HostThemeScheme`, `HostThemeSchemeColors`, `HostThemePaletteColor`, `HostThemeTypography`, `HostThemeFont`, `HostThemeComponentOverride`, `HostThemeMixins`): a site's theme customization as plain data. `@aglyn/shared-ui-theme` converts it to Material UI theme options.
- `dod` — exported from the root as the `DoD` namespace: key aliases (`PKey`, `FKey`, `AKey`), the `FT` field-type namespace, `DocumentType` / `CollectionType` / `DatabaseType`, and the `Schema`, `Relation` and `Ref` namespaces.

Each module is also importable as `@aglyn/shared-data-types/<module>`.

## Usage

```ts
import type {
  HostTheme,
  LifecycleObserver,
} from '@aglyn/shared-data-types'
import { DoD } from '@aglyn/shared-data-types'

class Store implements LifecycleObserver {
  onInit() {}
  onDestroy() {}
}

type Id = DoD.PKey
```

## How it fits

A `shared` data package with no `@aglyn/*` dependencies. `@aglyn/shared-ui-theme`, `@aglyn/shared-util-tools` and the core, renderer and Besigner packages build on these types. Shared packages are generic: they import only other shared packages and hold no plugin's domain.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/data/types
