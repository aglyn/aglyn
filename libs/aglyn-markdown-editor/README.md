# @aglyn/aglyn-markdown-editor

The markdown-lite WYSIWYG editor: visual surface, toolbar, source/visual
toggle, HTML→markdown paste, and the read-only view.

It was written inside `apps/console/components` for the blog/content page and
the marketplace listing editor. The besigner attributes panel needs the same
editor for the Markdown component's `content` attribute, and the designer
(`libs/besigner/feature/designer`) is a lib — a lib cannot import an app, so
the editor moved here (AGL-1616).

## Why `scope:aglyn` + `scope:ui`, not `scope:shared`

The editor speaks the markdown-lite dialect, which lives in `@aglyn/aglyn`
(`scope:aglyn`). The `scope:shared` constraint is
`onlyDependOnLibsWithTags: ['scope:shared']`, so a shared-UI home would have
had to re-implement the dialect — the wall AGL-1558 hit and correctly refused
to climb.

`["scope:lib", "scope:aglyn", "scope:ui"]` satisfies every constraint that
already exists, with no change to `eslint.config.mjs`:

- `scope:lib` → `@aglyn/aglyn` carries `scope:lib`.
- `scope:aglyn` → `@aglyn/aglyn` carries `scope:aglyn`.
- `scope:ui` (targets must be `scope:data`/`ui`/`util`) → `@aglyn/aglyn`
  carries `scope:data`.

And it is reachable from both consumers: `console` (`scope:app`, barred only
from `aglyn:addons`) and `besigner-feature-designer`, whose `scope:feature`
constraint admits a `scope:ui` target.

## Running unit tests

`nx test aglyn-markdown-editor`
