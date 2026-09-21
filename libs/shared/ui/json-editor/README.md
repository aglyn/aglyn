# @aglyn/shared-ui-json-editor

A full-screen Material UI dialog for editing a JSON document by hand, backed by the Monaco editor. Besigner uses it for its "Raw JSON" view of a node tree. It is mainly a building block of `@aglyn/besigner-ui`, and works in any Next.js app that can serve Monaco's assets.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-ui-json-editor@beta

Peer dependencies: `react`, `next` and `@mui/material`. `next` is required because the editor is loaded with `next/dynamic` and rendered on the client only.

**Monaco assets are served from your own origin.** The package configures the Monaco loader to read from `/monaco/vs` (exported as `MONACO_VS_PATH`) and deliberately has no CDN fallback. Copy `monaco-editor/min/vs` into your app's `public/monaco/vs` directory as part of your build, or the editor will not load.

## What's in it

- `JsonEditor` and `JsonEditorProps` from the root entry. `JsonEditorProps` extends Material UI's `DialogProps` (so `open` controls it) and adds:
  - `defaultValue` — the document to edit, as a value rather than a string; it is passed through `JSON.stringify` into the buffer when the dialog opens. The prop's declared type is inherited from the CodeMirror props, so an object currently needs a cast.
  - `onSave(event, value)` — called with the parsed JSON when Save is pressed.
  - `onClose(event, reason)` — `reason` is `'backdropClick'`, `'escapeKeyDown'`, `'saveClick'` or `'cancelClick'`.
  - `validate(value)` — return a message to block the save and show it; return nothing to allow it.
  - `title` (defaults to "Raw JSON") and `description`.
- Behavior worth knowing: text that does not parse is kept exactly as typed, reported in a warning, and blocks Save. A backdrop click does not close a dialog with unsaved edits. A typed-in buffer is never overwritten by a new `defaultValue`. A dismissible warning overlay covers the editor each time the component mounts.
- Subpath modules: `@aglyn/shared-ui-json-editor/components/monaco-editor` (`MonacoEditor`, `MONACO_VS_PATH`) and `@aglyn/shared-ui-json-editor/components/code-mirror-editor` (`CodeMirrorEditor`, a CodeMirror alternative the dialog does not use by default). The Monaco module configures the loader when it is imported, and `package.json` lists it under `sideEffects` for that reason.

## Usage

```tsx
import { JsonEditor } from '@aglyn/shared-ui-json-editor'
import { useState } from 'react'

export function Example(props: { doc: object; onChange: (doc: unknown) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Edit JSON</button>
      <JsonEditor
        open={open}
        defaultValue={props.doc as any}
        onClose={() => setOpen(false)}
        onSave={(event, value) => props.onChange(value)}
        validate={(value) =>
          Array.isArray(value) ? 'The document must be an object.' : null
        }
      />
    </>
  )
}
```

## How it fits

A `shared` UI package. It depends on `@aglyn/shared-ui-jsx` and `@aglyn/shared-data-enums`, and `@aglyn/besigner-ui` depends on it. Shared packages are generic: they import only other shared packages and hold no plugin's domain.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/ui/json-editor
