# Aglyn logic only: bring your own editor UI

A small React app that edits an Aglyn document with an interface of its own.
The node model, the undo history and the editing rules come from two
packages; every pixel on screen is this app's.

- [`@aglyn/aglyn`](https://www.npmjs.com/package/@aglyn/aglyn): the document
  model, the canvas that holds a document with undo and redo, and the
  registry of element types.
- [`@aglyn/besigner`](https://www.npmjs.com/package/@aglyn/besigner): the
  editor's logic without its UI: selection, the element clipboard, and the
  rules for moving an element into or out of a container.

The only other packages are `react` and `react-dom`. It needs no MUI, no
Next.js and no Firebase, and installing it brings none of them.

## Run it

Copy this folder anywhere outside the Aglyn repository, then:

```sh
npm install
npm run dev
```

`npm install` takes `@aglyn/aglyn` and `@aglyn/besigner` from npm. Open the
address Vite prints, select an element in the outline, and use the toolbar.

To add the same two packages to an app you already have:

```sh
npm install @aglyn/aglyn @aglyn/besigner react react-dom
```

The packages are in beta: an API can change between beta releases.

| script | what it does |
| -- | -- |
| `npm run dev` | starts the Vite dev server |
| `npm run build` | builds the app into `dist/` |
| `npm run preview` | serves the build |
| `npm run check` | loads the sample document, runs every toolbar command and renders the app in Node; exits non-zero if anything does not hold |

You need Node.js 22 or later.

## What is where

- `src/components.jsx` registers the four element types a document can use:
  `page`, `section`, `heading` and `paragraph`. Each is a plain React
  component.
- `src/document.js` holds a sample document in the shape Aglyn stores, loads
  it into the canvas, and wraps the editing commands. Each command is one
  call into `@aglyn/besigner` or the canvas.
- `src/App.jsx` is the interface: a toolbar whose buttons are enabled by the
  same rules Aglyn's own editor uses, an outline of the document, and a
  preview drawn with the registered components.
- `src/check.jsx` is what `npm run check` runs.

## How this example stays correct

Aglyn's CI copies this folder out of the repository, installs it, runs
`npm run build` and `npm run check`, and opens the build in Chrome to select
an element and move it. It does that on every release, first with the
packages about to be published and then with the version on npm. If a change
to the packages breaks this example, the release's Consumer proof check goes
red. The script is
[`tools/scripts/consumer-proof.mjs`](../../../tools/scripts/consumer-proof.mjs),
and the story it proves is `logic-only`.

There is no lockfile, so a copy installs the newest packages that fit the
ranges in `package.json`.

## License

Apache-2.0.
