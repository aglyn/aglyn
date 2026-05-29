/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export {
  /**
   * camelCase("string"); //=> "string"
   * camelCase("dot.case"); //=> "dotCase"
   * camelCase("PascalCase"); //=> "pascalCase"
   * camelCase("version 1.2.10"); //=> "version_1_2_10"
   * camelCase("version 12", { transform: camelCaseTransformMerge }); //=> "version12"
   */
  camelCase,
  camelCaseTransform,
  camelCaseTransformMerge,
  /**
   * capitalCase("string"); //=> "String"
   * capitalCase("dot.case"); //=> "Dot Case"
   * capitalCase("PascalCase"); //=> "Pascal Case"
   * capitalCase("version 1.2.10"); //=> "Version 1 2 10"
   */
  capitalCase,
  capitalCaseTransform,
  /**
   * dotCase("string"); //=> "string"
   * dotCase("dot.case"); //=> "dot.case"
   * dotCase("PascalCase"); //=> "pascal.case"
   * dotCase("version 1.2.10"); //=> "version.1.2.10"
   */
  dotCase,
  /**
   * constantCase("string"); //=> "STRING"
   * constantCase("dot.case"); //=> "DOT_CASE"
   * constantCase("PascalCase"); //=> "PASCAL_CASE"
   * constantCase("version 1.2.10"); //=> "VERSION_1_2_10"
   */
  constantCase,
  /**
   * headerCase("string"); //=> "String"
   * headerCase("dot.case"); //=> "Dot-Case"
   * headerCase("PascalCase"); //=> "Pascal-Case"
   * headerCase("version 1.2.10"); //=> "Version-1-2-10"
   */
  headerCase,
  /**
   * noCase("string"); //=> "string"
   * noCase("dot.case"); //=> "dot case"
   * noCase("PascalCase"); //=> "pascal case"
   * noCase("version 1.2.10"); //=> "version 1 2 10"
   */
  noCase,
  /**
   * paramCase("string"); //=> "string"
   * paramCase("dot.case"); //=> "dot-case"
   * paramCase("PascalCase"); //=> "pascal-case"
   * paramCase("version 1.2.10"); //=> "version-1-2-10"
   */
  paramCase,
  /**
   * pascalCase("string"); //=> "String"
   * pascalCase("dot.case"); //=> "DotCase"
   * pascalCase("PascalCase"); //=> "PascalCase"
   * pascalCase("version 1.2.10"); //=> "Version_1_2_10"
   * pascalCase("version 12", { transform: pascalCaseTransformMerge }); //=> "Version12"
   */
  pascalCase,
  pascalCaseTransform,
  pascalCaseTransformMerge,
  /**
   * pathCase("string"); //=> "string"
   * pathCase("dot.case"); //=> "dot/case"
   * pathCase("PascalCase"); //=> "pascal/case"
   * pathCase("version 1.2.10"); //=> "version/1/2/10"
   */
  pathCase,
  /**
   * sentenceCase("string"); //=> "String"
   * sentenceCase("dot.case"); //=> "Dot case"
   * sentenceCase("PascalCase"); //=> "Pascal case"
   * sentenceCase("version 1.2.10"); //=> "Version 1 2 10"
   */
  sentenceCase,
  sentenceCaseTransform,
  /**
   * snakeCase("string"); //=> "string"
   * snakeCase("dot.case"); //=> "dot_case"
   * snakeCase("PascalCase"); //=> "pascal_case"
   * snakeCase("version 1.2.10"); //=> "version_1_2_10"
   */
  snakeCase,
  // type Options,
} from 'change-case'

/**
 * # Change Case
 *
 * [![Build
 * status](https://img.shields.io/travis/blakeembrey/change-case.svg?style=flat)](https://travis-ci.com/blakeembrey/change-case)
 *
 * > Transform a string between `camelCase`, `PascalCase`, `Capital Case`,
 * `snake_case`,
 * `param-case`, `CONSTANT_CASE` and others.
 *
 * ## Installation
 *
 * ```
 * npm install change-case --save
 * ```
 *
 * ## Usage
 *
 * ```js
 * import * as changeCase from "change-case";
 * ```
 *
 * ### Core
 *
 * These functions come bundled with
 * [`change-case`](https://github.com/blakeembrey/change-case/tree/master/packages/change-case):
 *
 * - [`camelCase`](#camelcase)
 * - [`capitalCase`](#capitalcase)
 * - [`constantCase`](#constantcase)
 * - [`dotCase`](#dotcase)
 * - [`headerCase`](#headercase)
 * - [`noCase`](#nocase)
 * - [`paramCase`](#paramcase)
 * - [`pascalCase`](#pascalcase)
 * - [`pathCase`](#pathcase)
 * - [`sentenceCase`](#sentencecase)
 * - [`snakeCase`](#snakecase)
 *
 * All core methods accept [`options`](#options) as the second argument.
 *
 * ####
 * [camelCase](https://github.com/blakeembrey/change-case/tree/master/packages/camel-case)
 *
 * > Transform into a string with the separator denoted by the next word
 * capitalized.
 *
 * ```js
 * camelCase("test string");
 * //=> "testString"
 * ```
 *
 * ####
 * [capitalCase](https://github.com/blakeembrey/change-case/tree/master/packages/capital-case)
 *
 * > Transform into a space separated string with each word capitalized.
 *
 * ```js
 * capitalCase("test string");
 * //=> "Test String"
 * ```
 *
 * ####
 * [constantCase](https://github.com/blakeembrey/change-case/tree/master/packages/constant-case)
 *
 * > Transform into upper case string with an underscore between words.
 *
 * ```js
 * constantCase("test string");
 * //=> "TEST_STRING"
 * ```
 *
 * ####
 * [dotCase](https://github.com/blakeembrey/change-case/tree/master/packages/dot-case)
 *
 * > Transform into a lower case string with a period between words.
 *
 * ```js
 * dotCase("test string");
 * //=> "test.string"
 * ```
 *
 * ####
 * [headerCase](https://github.com/blakeembrey/change-case/tree/master/packages/header-case)
 *
 * > Transform into a dash separated string of capitalized words.
 *
 * ```js
 * headerCase("test string");
 * //=> "Test-String"
 * ```
 *
 * ####
 * [noCase](https://github.com/blakeembrey/change-case/tree/master/packages/no-case)
 *
 * > Transform into a lower cased string with spaces between words.
 *
 * ```js
 * noCase("testString");
 * //=> "test string"
 * ```
 *
 * ####
 * [paramCase](https://github.com/blakeembrey/change-case/tree/master/packages/param-case)
 *
 * > Transform into a lower cased string with dashes between words.
 *
 * ```js
 * paramCase("test string");
 * //=> "test-string"
 * ```
 *
 * ####
 * [pascalCase](https://github.com/blakeembrey/change-case/tree/master/packages/pascal-case)
 *
 * > Transform into a string of capitalized words without separators.
 *
 * ```js
 * pascalCase("test string");
 * //=> "TestString"
 * ```
 *
 * ####
 * [pathCase](https://github.com/blakeembrey/change-case/tree/master/packages/path-case)
 *
 * > Transform into a lower case string with slashes between words.
 *
 * ```js
 * pathCase("test string");
 * //=> "test/string"
 * ```
 *
 * ####
 * [sentenceCase](https://github.com/blakeembrey/change-case/tree/master/packages/sentence-case)
 *
 * > Transform into a lower case with spaces between words, then capitalize the
 * string.
 *
 * ```js
 * sentenceCase("testString");
 * //=> "Test string"
 * ```
 *
 * ####
 * [snakeCase](https://github.com/blakeembrey/change-case/tree/master/packages/snake-case)
 *
 * > Transform into a lower case string with underscores between words.
 *
 * ```js
 * snakeCase("test string");
 * //=> "test_string"
 * ```
 *
 * ### Other Case Utilities
 *
 * - [`titleCase`](#titlecase)
 * - [`swapCase`](#swapcase)
 * - [`isLowerCase`](#islowercase)
 * - [`isUpperCase`](#isuppercase)
 * - [`lowerCase`](#lowercase)
 * - [`lowerCaseFirst`](#lowercasefirst)
 * - [`upperCase`](#uppercase)
 * - [`upperCaseFirst`](#uppercasefirst)
 * - [`spongeCase`](#spongeCase)
 *
 * _These functions are not "case" libraries but independent functions, you
 * must install these separately._
 *
 * ####
 * [titleCase](https://github.com/blakeembrey/change-case/tree/master/packages/title-case)
 *
 * > Transform a string into title case following English rules.
 *
 * ```js
 * titleCase("a simple test");
 * //=> "A Simple Test"
 * ```
 *
 * ####
 * [swapCase](https://github.com/blakeembrey/change-case/tree/master/packages/swap-case)
 *
 * > Transform a string by swapping every character from upper to lower case,
 * or lower to upper case.
 *
 * ```js
 * swapCase("Test String");
 * //=> "tEST sTRING"
 * ```
 *
 * ####
 * [isLowerCase](https://github.com/blakeembrey/change-case/tree/master/packages/is-lower-case)
 *
 * > Returns `true` if the string is lower case only.
 *
 * ```js
 * isLowerCase("test string");
 * //=> true
 * ```
 *
 * ####
 * [isUpperCase](https://github.com/blakeembrey/change-case/tree/master/packages/is-upper-case)
 *
 * > Returns `true` if the string is upper case only.
 *
 * ```js
 * isUpperCase("test string");
 * //=> false
 * ```
 *
 * ####
 * [lowerCase](https://github.com/blakeembrey/change-case/tree/master/packages/lower-case)
 *
 * > Transforms the string to lower case.
 *
 * ```js
 * lowerCase("TEST STRING");
 * //=> "test string"
 * ```
 *
 * ####
 * [lowerCaseFirst](https://github.com/blakeembrey/change-case/tree/master/packages/lower-case-first)
 *
 * > Transforms the string with the first character in lower cased.
 *
 * ```js
 * lowerCaseFirst("TEST");
 * //=> "tEST"
 * ```
 *
 * ####
 * [upperCase](https://github.com/blakeembrey/change-case/tree/master/packages/upper-case)
 *
 * > Transforms the string to upper case.
 *
 * ```js
 * upperCase("test string");
 * //=> "TEST STRING"
 * ```
 *
 * ####
 * [upperCaseFirst](https://github.com/blakeembrey/change-case/tree/master/packages/upper-case-first)
 *
 * > Transforms the string with the first character in upper cased.
 *
 * ```js
 * upperCaseFirst("test");
 * //=> "Test"
 * ```
 *
 * ####
 * [spongeCase](https://github.com/blakeembrey/change-case/tree/master/packages/sponge-case)
 *
 * > Transform into a string with random capitalization applied.
 *
 * ```js
 * spongeCase("Test String");
 * //=> "tEst stRINg"
 * ```
 *
 * ### Options
 *
 * - **`splitRegexp`** RegExp used to split into word segments (see
 * [example](#split-example)).
 * - **`stripRegexp`** RegExp used to remove extraneous characters (default:
 * `/[^A-Z0-9]/gi`).
 * - **`delimiter`** Value used between words (e.g. `" "`).
 * - **`transform`** Used to transform each word segment (e.g. `lowerCase`).
 *
 * #### Split Example
 *
 * If you find the default split hard to use, you can provide a different one.
 * The example below will change the behavior to `word2019 -> word 2019` and
 * `minifyURLs -> minify urls`:
 *
 * ```js
 * const options = {
 *   splitRegexp: /([a-z])([A-Z0-9])/g,
 * };
 * ```
 *
 * ## Related
 *
 * - [Meteor](https://github.com/Konecty/change-case)
 * - [Atom](https://github.com/robhurring/atom-change-case)
 * - [VSCode](https://github.com/wmaurer/vscode-change-case)
 *
 * ## License
 *
 * MIT
 */

export * as ChangeCase from 'change-case'
