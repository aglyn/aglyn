import {
  customAlphabet as createUidWithAlphabet,
  customRandom as createUidCustom,
  nanoid as createUid,
  random as createUidRandomBytes,
  urlAlphabet as urlSafe,
} from 'nanoid'
import {
  alphanumeric,
  lowercase,
  nolookalikes,
  nolookalikesSafe,
  numbers,
  uppercase,
} from 'nanoid-dictionary'

type UidAlphabetDictionary = {
  alphanumeric: string
  lowercase: string
  nolookalikes: string
  nolookalikesSafe: string
  numbers: string
  uppercase: string
  urlSafe: string
}

export const UidAlphabets: UidAlphabetDictionary = {
  alphanumeric,
  lowercase,
  nolookalikes,
  nolookalikesSafe,
  numbers,
  uppercase,
  urlSafe,
}

export { createUid, createUidWithAlphabet, createUidRandomBytes, createUidCustom }
