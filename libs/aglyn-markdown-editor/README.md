# @aglyn/aglyn-markdown-editor

The markdown-lite WYSIWYG editor: visual surface, toolbar, source/visual
toggle, HTML-to-markdown paste, link dialog, and the read-only view. It is the
editor the Aglyn console uses for content, and the one `@aglyn/besigner-ui`
uses for a Markdown component's `content` attribute. Install it on its own if
you need to edit or preview Aglyn's markdown-lite dialect in a React and MUI
app; most consumers get it as a dependency of `@aglyn/besigner-ui`.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/aglyn-markdown-editor@beta

Peer dependencies:

- `react`
- `@mui/material`
- `@mui/icons-material`

## What's in it

Components:

- `MarkdownField` is the complete field: a label, the toolbar, the visual
  editor and a raw-source mode, driven by `value` and `onChange`. It takes an
  optional `onPickImageFromMedia` callback so the caller can supply its own
  media picker, and an `editorRef` that hands back a `MarkdownFieldHandle` for
  inserting a picked image.
- `MarkdownVisualEditor` is the visual editing surface by itself, and
  `MarkdownEditorToolbar` is its toolbar, for callers that lay the pieces out
  themselves.
- `MarkdownLinkDialog` and `LinkTargetAutocomplete` are the link controls. The
  autocomplete offers the targets the caller passes in, and searches entries
  when the core's link-target search context is mounted.
- `MarkdownLiteView` renders markdown-lite `source` read-only.

Functions:

- `markdownToRows`, `rowsToMarkdown` and `readInlinesFromElement` convert
  between markdown-lite source and the editor's row model.
- `htmlToRows` and `htmlToInlines` convert pasted HTML.
- `applyCommandToSource` and `applyLinkToSource` apply a toolbar command to a
  raw-source selection.

The markdown-lite dialect itself (its parser and serializer) lives in
`@aglyn/aglyn`, not here. This package is the UI over it.

Every file under `src/lib` is also reachable by subpath, for example
`@aglyn/aglyn-markdown-editor/markdown-lite-view.component`.

## Usage

```tsx
import { MarkdownField, MarkdownLiteView } from '@aglyn/aglyn-markdown-editor'
import { useState } from 'react'

export function BodyEditor() {
  const [body, setBody] = useState('')
  return (
    <>
      <MarkdownField label="Body" value={body} onChange={setBody} />
      <MarkdownLiteView source={body} />
    </>
  )
}
```

## How it fits

This package sits in the `core` scope of the package map as its UI piece: it
imports only `@aglyn/aglyn`, because the editor speaks the markdown-lite
dialect the core defines. That is also why it is not one of the generic
`@aglyn/shared-*` packages, which may not know Aglyn's model. It is a library
rather than part of an app because both the console and the designer UI need
the same editor. It imports no plugin and no other UI package.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/aglyn-markdown-editor
