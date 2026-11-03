# @aglyn/plugins-lightbox

The Lightbox element for Aglyn sites (AGL-3717): a container whose children are
any elements — text, a form, a video, pictures — hidden until an interaction
opens it, so a site owner composes a lightbox of their own.

> Published to npm from the Aglyn monorepo. Versions follow [semantic versioning](https://semver.org).

## Install

```bash
npm install @aglyn/plugins-lightbox
```

A plugin is loaded through Aglyn's plugin manager (`@aglyn/aglyn`); it is not a standalone library.

- `components/lightbox.tsx` — the element. It answers the interactions
  system's existing *Show an element*, *Hide an element* and *Show/hide an
  element* steps through core's `subscribeElementVisibility`, so any button,
  link or picture opens it with no step type of its own.
- `components/lightbox-panel.tsx` — the open dialog, loaded on demand. It is
  the shared lightbox shell (`@aglyn/shared-ui-jsx/components/lightbox/lightbox-dialog`),
  the same one the Image, the Image List and the Video open.
