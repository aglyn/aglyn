import {
  customAlphabet as createUidWithAlphabet,
  customRandom as createUidCustom,
  nanoid as createUid,
  random as createUidRandomBytes,
} from 'nanoid'

// `UidAlphabets` (`nanoid-dictionary`) lives in its own module now —
// `@aglyn/shared-util-vendor/uid-alphabets` (AGL-2682). It rode here as a
// second package inside a module whose `createUid` the loading context and
// `createResourceUid` call on every published page, so a table of alphabets
// nothing reads was emitted to every visitor.

export {
  createUid,
  createUidWithAlphabet,
  createUidRandomBytes,
  createUidCustom,
}
