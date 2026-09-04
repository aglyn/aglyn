# @aglyn/plugins-forms

The Forms feature plugin: both halves of a capability that has both.

- **Canvas** — the `form` and `formField` elements, registered into
  `FORMS_BUNDLE` and offered in the besigner's element picker.
- **Console** — the Forms catalog and one form's own surface (declaration,
  metrics, versions, promotion, design preview), contributed through the
  `ConsoleExtension` registry and rendered by the shell's generic plugin
  route at `/{orgSlug}/hosts/{host}/forms`.

## Ids

`componentId` is a bare string and is persisted in every screen document:
`form` and `formField` never change. `pluginId` is persisted beside it and is
`forms` — see `src/lib/constants/bundle-common.ts` for why that field is not
cosmetic, and `tools/scripts/backfill-node-plugin-ids.mjs` for the script that
keeps saved nodes agreeing with it.

## What is NOT here

The MODEL and the CONTRACT stay in core — `libs/aglyn/src/lib/app-utils/
forms.ts` and `form-contract.ts`. `apps/tenant/app/api/forms/submit/route.ts`
resolves a form at request time through `@aglyn/tenant-runtime`, which is
tagged `scope:aglyn` and so may depend only on `scope:aglyn` and
`scope:shared`; a plugin carries `aglyn:addons` alone, so no core lib can
reach it. The submit route, the publish-time contract check and the besigner
editor route are all on the core side of that line.

Form SUBMISSIONS are read in the Inbox, which is `@aglyn/plugins-inbox`: this
plugin owns what a form IS, and the inbox owns what it collected.

## Running unit tests

`nx test plugins-forms`.
