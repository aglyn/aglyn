# @aglyn/shared-util-vendor

Thin re-exports of the third-party utilities the Aglyn packages use, under stable names, so that each library is depended on in one place. It is an internal building block of `@aglyn/aglyn`, `@aglyn/besigner`, `@aglyn/plugins-mui` and the shared UI packages. There is little reason to install it on its own; install the underlying library instead.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-util-vendor@beta

Peer dependency: `react` (`^19.2.8`), used by the `use-debounce` module. The `mobx-computed-fn` module re-exports from `mobx-utils`, which itself needs `mobx` installed.

## What's in it

From the package root:

| Exports | From |
| -- | -- |
| `camelCase`, `kebabCase`, `snakeCase`, `constantCase` and the other case functions, `split`, `splitSeparateNumbers`, the `ChangeCase` namespace, and the older aliases `paramCase` (= `kebabCase`) and `headerCase` (= `trainCase`) | `change-case` |
| `hoistNonReactStatics` | `hoist-non-react-statics` |
| `objectDeepMerge`, `objectDeepMergeCustom`, and `objectDeepMergeReplaceArrays` (a later array replaces an earlier one instead of being concatenated; meant for configuration objects) | `deepmerge-ts` |
| `createUid`, `createUidWithAlphabet`, `createUidCustom`, `createUidRandomBytes` | `nanoid` |

By subpath only. These are deliberately kept off the root so that importing anything from the root does not pull their packages into a browser bundle:

| Import path | Exports | From |
| -- | -- | -- |
| `@aglyn/shared-util-vendor/deep-equal` | `deepEqual` | `deep-equal` |
| `@aglyn/shared-util-vendor/fuse` | `Fuse` (also default) | `fuse.js` |
| `@aglyn/shared-util-vendor/mitt-emitter` | `Mitt` and its types | `mitt` |
| `@aglyn/shared-util-vendor/mobx-computed-fn` | `computedFn` | `mobx-utils` |
| `@aglyn/shared-util-vendor/object-deep-fill-in` | `objectDeepMergeFillIn` (never overwrites an existing property) | `mout` |
| `@aglyn/shared-util-vendor/object-flatten` | `objectFlatten`, `objectUnflatten` | `flat` |
| `@aglyn/shared-util-vendor/platform-identification` | `platformIdentification()` | `platform` |
| `@aglyn/shared-util-vendor/uid-alphabets` | `UidAlphabets` | `nanoid-dictionary` |
| `@aglyn/shared-util-vendor/use-debounce` | `useDebounce`, `useDebouncedCallback`, `useThrottledCallback` | `use-debounce` |

## Usage

```ts
import {
  createUid,
  kebabCase,
  objectDeepMergeReplaceArrays,
} from '@aglyn/shared-util-vendor'
import { deepEqual } from '@aglyn/shared-util-vendor/deep-equal'

const id = createUid()
const slug = kebabCase('PascalCase') // 'pascal-case'

const merged = objectDeepMergeReplaceArrays(
  { variants: ['a', 'b'] },
  { variants: ['z'] },
) // { variants: ['z'] }

deepEqual({ a: 1 }, { a: 1 }) // true
```

## How it fits

A `shared` package: generic, with no knowledge of Aglyn's model, and it imports no other Aglyn package. Shared packages may only import other shared packages and hold no plugin's domain. `@aglyn/aglyn`, `@aglyn/aglyn-node-renderer`, `@aglyn/besigner`, `@aglyn/besigner-ui`, `@aglyn/plugins-mui`, `@aglyn/shared-ui-jsx`, `@aglyn/shared-ui-jsx-forms`, `@aglyn/shared-ui-snackstack` and `@aglyn/shared-ui-theme` depend on it.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/util/vendor
