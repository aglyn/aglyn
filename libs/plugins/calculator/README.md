# @aglyn/plugins-calculator

The source of **Calculators**, a marketplace plugin the Aglyn org publishes. Its elements put one of a site's no-code functions on a page, and turn what it works out into a receipt, an invoice or a quote the visitor keeps.

It is not a first-party plugin. It is not in `plugins.config.json` and no app imports it. Sites get it by installing it from the marketplace. It ships as a staff-signed bundle, so it runs in the page itself and renders on the server.

## What's in it

Canvas elements, all in the plugin's namespace `aglyn.calculator`:

- `aglyn.calculator.widget`, **Function Widget**: a whole calculator in one block (inputs, a button, the result).
- `aglyn.calculator.scope`, **Calculator**: a container bound to one site function. Everything below sits inside one.
- `aglyn.calculator.input`, **Calculator Input**: asks one parameter, as a number box, a list, a switch or quick picks.
- `aglyn.calculator.result`, **Calculator Result**: shows one value of the function.
- `aglyn.calculator.showWhen`, **Show When**: a container that appears only while a value is true.
- `aglyn.calculator.document`, **Calculator Document**: a receipt, invoice or quote laid out on the canvas and filled by results.
- `aglyn.calculator.saveButton`, **Calculator Save Button**: saves the document as a PDF (the browser's print-to-PDF, scoped to the document), shares it, or copies it as text.

## Building and publishing

```bash
npx nx run plugins-calculator:bundle
```

This writes `dist/marketplace/calculator/plugin.bundle.mjs` and its `manifest.json`.

- The bundle runs against the host ABI. `@aglyn/aglyn`, `react` and `@mui/material` are the site's own copies (`tools/plugin-loader/realm/rollup.config.mjs`), so it carries none of them.
- The manifest declares the seven elements, and binds the `functionName` prop of the Function Widget and the Calculator to a site function. That binding is how compose hands a Calculator its function's definition.
- Publish from the Aglyn org workspace. Staff review and sign each version in `/admin/plugin-reviews`.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/calculator
