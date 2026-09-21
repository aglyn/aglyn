# @aglyn/shared-data-mdi

Material Design Icons as data. Every icon is a plain object carrying its id, display name, SVG path, aliases and tags, plus a lazily loaded catalog for icon pickers and search. Aglyn uses it wherever an icon is chosen by id and stored as data; it is usable in any project that wants MDI paths without a component library.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-data-mdi@beta

No peer dependencies, and no React.

## What's in it

- **The generated icon set.** One named export per icon, in camel case with an `mdi` prefix (`mdiAbacus`, `mdiAccessPoint`). Each is an `Icon`: `{ id, name, path, as, tags }`, where `path` is the SVG path data for a 24 by 24 viewBox. The set is generated from Material Design Icons 6.5.95 and ships in the package under `generated/6.5.95/`.
- **The catalog.** `loadMdiIcons()` dynamically imports the whole set, fills the `MdiIcons` map (`Map<IconId, Icon>`) on first call and caches the promise. Nothing loads the catalog at import time, because it is large; call it only on a surface that needs every icon.
- **Lookups against the loaded catalog.** `getMdiIconPath(id)` returns the path, or `undefined` when the id is unknown or the catalog is not loaded. `getMdiIconFromId(idOrIds)` returns the icon, substituting `DEFAULT_ICON` on a miss. `getMdiAllIcons()` returns the map.
- **Helpers.** `convertIdToModuleName('access-point')` gives `'mdiAccessPoint'`. `iconPathPropName('iconId')` gives `'iconPath'`, the companion prop name for storing a resolved path beside an id. `handleIconNotFound` and `DEFAULT_ICON` are the fallback pieces.
- **Types.** `Icon`, `Icons`, `IconId`, `IconName`, `IconPath`, `IconTag`, `IconTags`, `IconAliases`.

## Usage

A named icon, tree-shaken to the one object:

```ts
import { mdiAbacus } from '@aglyn/shared-data-mdi'

mdiAbacus.path // 'M5 5H7V11H5V5M10 5H8V11H10V5…'
```

The whole catalog, for a picker:

```ts
import { getMdiIconPath, loadMdiIcons } from '@aglyn/shared-data-mdi'

const icons = await loadMdiIcons() // Map<IconId, Icon>
const path = getMdiIconPath('abacus')
```

The generated files are build output. Do not edit them by hand.

## How it fits

A `shared` data package. It depends only on `@aglyn/shared-util-tools`. `@aglyn/shared-data-enums` names its icon constants from it, and `@aglyn/shared-ui-jsx` re-exports it beside the `MdiIcon` component that renders a path. Shared packages are generic: they import only other shared packages and hold no plugin's domain.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/data/mdi

The icon paths come from the Material Design Icons project (https://github.com/Templarian/MaterialDesign), which publishes them under its own license.
