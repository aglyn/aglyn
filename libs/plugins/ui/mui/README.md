# @aglyn/plugins-ui-mui

The canonical MUI component plugin. It absorbs the former
`@aglyn/aglyn-plugin-mui` library and serves both runtimes:

- **New runtime** (silo, console app-setup): register the exported `bundle`
  with `registerBundle` from `@aglyn/aglyn`.
- **Legacy runtime** (`AglynNodeRenderer` pages in tenant and the console
  besigner page): call `registerLegacyMuiPlugin()` at module scope.

## Component ids

Component ids are persisted in screen documents (`componentId` +
`pluginId: 'mui'` on every node), so this library keeps the legacy ids —
`muiAppBar`, `muiButton`, `muiContainer`, `muiList`, `muiListItem`,
`muiListItemText`, `muiStack`, `muiToolbar`, `muiTypography` — and existing
documents resolve without migration in both runtimes. Do not rename them
without a screen-document migration.

## Running unit tests

Run `nx test plugins-ui-mui` to execute the unit tests via [Jest](https://jestjs.io).
