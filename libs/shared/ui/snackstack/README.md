# @aglyn/shared-ui-snackstack

Stacked snackbar notifications for Material UI: a provider that queues and displays snackbars, and a hook to enqueue and close them from anywhere below it. The API follows notistack's (`SnackbarProvider`, `useSnackbar`, `enqueueSnackbar`). The Aglyn console, Besigner and the plugins' console pages use it for their toasts.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-ui-snackstack@beta

Peer dependencies: `react`, `react-dom` and `@mui/material`, plus three Aglyn packages that are declared as peers rather than dependencies, so install them alongside:

    npm install @aglyn/shared-ui-theme@beta @aglyn/shared-util-tools@beta @aglyn/shared-util-vendor@beta

## What's in it

- `SnackbarProvider` — wrap the part of the app that shows snackbars. Props (`SnackbarProviderProps`) include `maxSnack` (how many stack at once, default 3), `dense`, `hideIconVariant`, `iconVariant`, `domRoot` and `classes`, plus the shared per-snackbar defaults.
- `useSnackbar()` — returns `{ enqueueSnackbar, closeSnackbar }` (`ProviderContext`).
  - `enqueueSnackbar(message, options?)` returns the snackbar's id. `options` (`OptionsObject`) include `variant` (`'default' | 'error' | 'success' | 'warning' | 'info'`), `persist` and `snackbarId`.
  - `closeSnackbar(id?)` closes one snackbar, or all of them when called without an id.
- `withSnackbar(Component)` — the same two functions injected as props, for class components.
- `SnackbarContent` — the content wrapper to use when rendering a custom snackbar body.
- Types: `SnackbarId`, `SnackbarMessage`, `SnackbarAction`, `VariantType`, `CloseReason`, `SnackbarOrigin`, `OptionsObject`, `SnackbarProviderProps`, `ProviderContext`, `WithSnackbarProps`.

## Usage

```tsx
import { SnackbarProvider, useSnackbar } from '@aglyn/shared-ui-snackstack'

function SaveButton() {
  const { enqueueSnackbar } = useSnackbar()
  return (
    <button onClick={() => enqueueSnackbar('Saved', { variant: 'success' })}>
      Save
    </button>
  )
}

export function App() {
  return (
    <SnackbarProvider maxSnack={3}>
      <SaveButton />
    </SnackbarProvider>
  )
}
```

## How it fits

A `shared` UI package. It builds on `@aglyn/shared-ui-theme`, `@aglyn/shared-util-tools` and `@aglyn/shared-util-vendor`; `@aglyn/besigner-ui` and the feature plugins depend on it. Shared packages are generic: they import only other shared packages and hold no plugin's domain.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/ui/snackstack
