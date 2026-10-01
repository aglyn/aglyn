# Aglyn Besigner UI: the editor outside the console

A small React app that mounts Besigner, Aglyn's visual editor, as it ships:
the element tree, the canvas, the inspector, the styles panel, and drag and
drop from the Elements tab. It has no Aglyn console, no account and no
server. It defines four element types of its own and saves the document to
the browser's localStorage.

| package | what this app takes from it |
| -- | -- |
| [`@aglyn/besigner-ui`](https://www.npmjs.com/package/@aglyn/besigner-ui) | the editor: `withBesignerContext`, the workspace, the viewport and the canvas |
| [`@aglyn/besigner`](https://www.npmjs.com/package/@aglyn/besigner) | `initializeBesignerApp`, which creates the editor state, and `focus` |
| [`@aglyn/aglyn`](https://www.npmjs.com/package/@aglyn/aglyn) | the canvas that holds the document, and the element registry |
| [`@aglyn/aglyn-node-renderer`](https://www.npmjs.com/package/@aglyn/aglyn-node-renderer) | `createAglynComponent`, which wraps a React component as an element type |
| [`@aglyn/shared-ui-theme`](https://www.npmjs.com/package/@aglyn/shared-ui-theme) | the console theme the editor is styled with |

Besides React, the editor needs MUI with Emotion, `next` and `firebase` as
peers. It calls no Next.js server and makes no Firebase request here: `next`
is needed because two of its parts load through `next/dynamic`, and
`firebase` because its shared-draft store, which this app does not use, writes
to Firestore. Both are on the list to remove.

## Run it

Copy this folder anywhere outside the Aglyn repository, then:

```sh
npm install
npm run dev
```

`npm install` takes the `@aglyn/*` packages from npm. Open the address Vite
prints. Select an element on the canvas or in the element tree, change its
text under Attributes or its look under Styles, drag a new element in from
the Elements tab, and press Save to keep the document across reloads.

The packages are in beta: an API can change between beta releases.

| script | what it does |
| -- | -- |
| `npm run dev` | starts the Vite dev server |
| `npm run build` | builds the app into `dist/` |
| `npm run preview` | serves the build |
| `npm run check` | loads and saves the sample document, renders the editor in Node, and renders its element tree and inspector with an element selected; exits non-zero if anything does not hold |

You need Node.js 22 or later.

## Three things the editor needs

1. **An editor app, created before it mounts.** `initializeBesignerApp()`
   from `@aglyn/besigner` creates the state the editor reads (`src/main.jsx`).
   Without it the editor throws on its first render.
2. **The console theme, served as CSS variables.** The editor's styles read
   the theme's CSS variables, so it renders inside `ThemeCssVarProvider` from
   `@aglyn/shared-ui-theme` with the console's light and dark themes
   (`src/App.jsx`). A plain MUI `ThemeProvider` is not enough.
3. **Element types registered with the core.** The canvas draws a node with
   the component registered under its `componentId`, and the Elements tab
   offers the presets registered beside them (`src/elements.jsx`). In Aglyn
   itself these come from plugins such as `@aglyn/plugins-mui`.

## What is where

- `src/elements.jsx`: the four element types, each with an icon and, for the
  text ones, a "Text content" attribute the inspector edits, plus one preset
  each for the Elements tab.
- `src/document.js`: a sample document in the shape Aglyn stores, and the
  functions that load it into the canvas and read it back.
- `src/storage.js`: saving to localStorage. A real app stores the same JSON
  wherever it keeps documents.
- `src/App.jsx`: the theme, a toolbar with Save and Reset, and the editor as
  Aglyn's console composes it.
- `src/check.jsx`: what `npm run check` runs.

## How this example stays correct

Aglyn's CI copies this folder out of the repository, installs it, runs
`npm run build` and `npm run check`, and opens the build in Chrome to select
the heading in the element tree and wait for the inspector to show its text.
It does that on every release, first with the packages about to be published
and then with the version on npm. If a change to the packages breaks this
example, the release's Consumer proof check goes red. The script is
[`tools/scripts/consumer-proof.mjs`](../../../tools/scripts/consumer-proof.mjs),
and the story it proves is `besigner-ui`.

There is no lockfile, so a copy installs the newest packages that fit the
ranges in `package.json`.

## License

Apache-2.0.
