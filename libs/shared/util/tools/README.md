# @aglyn/shared-util-tools

General-purpose TypeScript helpers: type guards, array and object utilities, deep get/set, cloning, JSON and base64 serialization, plus a few larger standalone modules (a linear-time regex engine, an AES-GCM secret box, WCAG contrast math, HTML escaping). It is a dependency of most Aglyn packages and is usable on its own.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-util-tools@beta

No peer dependencies.

## Read this first: the root import patches `Array.prototype`

`package.json` lists `./src/lib/array/array-overrides.*` under `sideEffects`, and the package root re-exports that module. So `import ... from '@aglyn/shared-util-tools'` runs it, and bundlers are told not to drop it.

What it does, exactly: using `Object.defineProperty` it defines eight methods on `Array.prototype`, each non-enumerable, writable and configurable, and it declares them on the global `Array<T>` TypeScript interface. It defines them unconditionally, so a same-named property already present would be overwritten.

| Method | Behavior |
| -- | -- |
| `$_cloneShallow()` | shallow copy (lodash `clone`) |
| `$_cloneDeep()` | deep copy (lodash `cloneDeep`) |
| `$_moveAtIndex(index, newIndex)` | moves an item, mutating the array; appends when `newIndex` is `NaN` |
| `$_pushAtIndex(index, ...items)` | inserts at `index`, mutating; appends when `index` is `NaN` |
| `$_removeItem(item)` | removes the first strictly-equal item, mutating |
| `$_removeAtIndex(index)` | removes one item, mutating |
| `$_replaceAtIndex(index, item)` | replaces one item, mutating |
| `$_truthy()` | returns a new array without falsy items |

The mutating methods return the same array. Because the properties are non-enumerable they do not show up in `for...in`, `Object.keys` or `JSON.stringify`. No built-in method is replaced. (The global type declaration gives `$_pushAtIndex` the signature `(index, newIndex)`; the implementation is `(index, ...items)`.)

To avoid the patch, import by subpath instead of from the root. No other module in this package imports `array-overrides`, and every helper the patch wraps is available as a plain function, for example `@aglyn/shared-util-tools/array/array-move-at-index`. Note that `@aglyn/shared-util-dom` and `@aglyn/shared-util-errors` import the root, so they apply the patch too.

## What's in it

From the package root:

- Guards, all `_`-prefixed: `_isArr`, `_isObj`, `_isNum`, `_isBool`, `_isNull`, `_isUndOrNull`, `_isStrEmpty`, `_isPromiseLike`, `_hasOwnProperty` and the rest of `src/lib/guards/lib`.
- Arrays: `arraySafe`, `arrayFrom`, `arrayFromLength`, `arrayCopyShallow`, `arrayCopyDeep`, `arrayMoveAtIndex`, `arrayPushAtIndex`, `arrayRemoveItem`, `arrayRemoveAtIndex`, `arrayUpdate`, `arrayUpdateAtIndex`, `arraySortBy`, `arraySortByDeepProperty`, `arrayOfEntriesToObject`.
- Objects: `objectGetDeepProperty`, `objectSetDeepProperty`, `objectClone`, `objectCloneDeep`, `objectDeleteProperty`, `objectRemap`, `objectSafe`, `objectUpdate`, `objectGetKeysAndSymbolProperties`, `getProperty`, `getStaticField`.
- Values: `truthy`, `truth`, `falsy`, `noop`, `str`, `trim`, `length`, `toNum`, `numberToHexadecimal`, `numberFromHexadecimal`, `numeronym`, `splitDisplayName`, and the `compare` operator helper with its operator types.
- Bit flags: `bitwiseHasAttribute`, `bitwiseHasAllAttributes`, `bitwiseHasOnlyAttributes`.
- Serialization: `jsonSerialize`, `jsonDeserialize`, `base64IsomorphicEncode`, `base64IsomorphicDecode`.
- Classes and functions: `applyMixins`, `createChainedFunction`, `getDisplayName`, `interopDefault`, `noSideEffects`, `cloneDeep`, `copyShallow`, `Crud`, `Normalized`, `CSS`.

By subpath only (kept off the root so they are not pulled into every consumer's bundle):

- `@aglyn/shared-util-tools/linear-regex` - `compileLinearPattern`, `compileLinearTest` and their `explain*` counterparts. A regex engine that parses the pattern itself and runs an NFA simulation, so matching time is bounded by input length times program length. Intended for patterns written by someone you do not trust. Backreferences and lookaround are not supported.
- `@aglyn/shared-util-tools/secret-box` - `createSecretBoxKey`, `parseSecretBoxKeyring`, `sealSecret`, `openSecret`, `needsReseal`, `sealedSecretKeyId`, `SecretBoxError`. AES-256-GCM sealing of short secrets with key ids, key rotation and an optional authenticated context. Imports `node:crypto`; server-only.
- `@aglyn/shared-util-tools/escape-html` - `escapeHtml(value)`, escaping `& < > " '`.
- `@aglyn/shared-util-tools/contrast` - `relativeLuminanceOfRgb`, `rgbChannelsOfHex`, `prefersDarkInk` and related sRGB helpers.
- `@aglyn/shared-util-tools/serialize/php-serial-*` - wrappers over `php-serialize`.

## Usage

```ts
// Subpath imports: no prototype patch.
import { objectGetDeepProperty } from '@aglyn/shared-util-tools/object/object-get-deep-property'
import { arraySafe } from '@aglyn/shared-util-tools/array/array-safe'
import { escapeHtml } from '@aglyn/shared-util-tools/escape-html'

const city = objectGetDeepProperty<string>(user, 'address.city')
const tags = arraySafe(input.tags) // always an array
const html = `<p>${escapeHtml(comment)}</p>`
```

```ts
// Root import: same helpers, and Array.prototype gains the $_ methods.
import { _isArr, truthy } from '@aglyn/shared-util-tools'
```

## How it fits

A `shared` package: generic, with no knowledge of Aglyn's model. Shared packages may only import other shared packages; this one depends on `@aglyn/shared-data-types`, `lodash-es` and `php-serialize`. Most of the monorepo depends on it, including `@aglyn/aglyn`, `@aglyn/besigner`, the shared UI packages and several plugins.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/util/tools
