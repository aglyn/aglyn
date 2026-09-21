# @aglyn/shared-data-regex

A small set of regular expressions for form validation: an email pattern and the character-class checks used for password rules. It is mainly a dependency of `@aglyn/shared-data-forms`, and has no dependencies of its own beyond the compiler helpers.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-data-regex@beta

No peer dependencies.

## What's in it

- `REGEX_EMAIL` — an email address pattern.
- `REGEX_NO_SPACES` — matches a string that contains no whitespace.
- `REGEX_SPECIAL_CHARACTER` — matches a non-word character.
- `REGEX_NUMBER` — matches a digit.
- `REGEX_LETTER_LOWER` — matches a lowercase ASCII letter.
- `REGEX_LETTER_UPPER` — matches an uppercase ASCII letter.

Entry points: `.` and `@aglyn/shared-data-regex/regex`.

## Usage

```ts
import {
  REGEX_LETTER_UPPER,
  REGEX_NO_SPACES,
  REGEX_NUMBER,
} from '@aglyn/shared-data-regex'

const acceptable = (password: string) =>
  REGEX_NO_SPACES.test(password) &&
  REGEX_NUMBER.test(password) &&
  REGEX_LETTER_UPPER.test(password)
```

## How it fits

A `shared` data package at the bottom of the package map. `@aglyn/shared-data-forms` builds its email and password validators from these patterns. Shared packages are generic: they import only other shared packages and hold no plugin's domain.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/data/regex
