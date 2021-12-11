/**
 * @license
 * Copyright 2021 Aglyn LLC
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

//        d8888                   d8b                                                   888
//       d88888                   Y8P                                                   888
//      d88P888                                                                         888
//     d88P 888 .d8888b  .d8888b  888  .d88b.  88888b.  88888b.d88b.   .d88b.  88888b.  888888
//    d88P  888 88K      88K      888 d88P"88b 888 "88b 888 "888 "88b d8P  Y8b 888 "88b 888
//   d88P   888 "Y8888b. "Y8888b. 888 888  888 888  888 888  888  888 88888888 888  888 888
//  d8888888888      X88      X88 888 Y88b 888 888  888 888  888  888 Y8b.     888  888 Y88b.
// d.d88888b.88  88888P'  88888P' 888  "Y88888 88888888 888  888  888  "Y8888  888  888  "Y888
// d88P" "Y88b                             888    888
// 888     888                        Y8b d88P    888
// 888     888 88888b.   .d88b.  888d888Y88888b.  888888  .d88b.  888d888 .d8888b
// 888     888 888 "88b d8P  Y8b 888P"       "88b 888    d88""88b 888P"   88K
// 888     888 888  888 88888888 888     .d888888 888    888  888 888     "Y8888b.
// Y88b. .d88P 888 d88P Y8b.     888     888  888 Y88b.  Y88..88P 888          X88
//  "Y88888P"  88888P"   "Y8888  888     "Y888888  "Y888  "Y88P"  888      88888P'
//             888
//             888
//             888
/**
 * | Name | Shorthand operator | Meaning
 * | --- | --- | --- |
 * | Assignment |`x = y `  |`x = y `
 * | Addition assignment | `x += y` | `x = x + y  `
 * | Subtraction assignment | ` x -= y` | `x = x - y`
 * | Multiplication assignment |` x *= y` |` x = x * y  `
 * | Division assignment | `x /= y` | `x = x / y`
 * | Remainder assignment |  `x %= y` | `x = x % y  `
 * | Exponentiation assignment | `x **= y` |  `x = x ** y `
 * | Left shift assignment | `x <<= y` |  `x = x << y`
 * | Right shift assignment   | `x >>= y`   | `x = x >> y  `
 * | Unsigned right shift assignment | `x >>>= y` | `x = x >>> y `
 * | Bitwise AND assignment |  `x &= y` | `x = x & y`
 * | Bitwise XOR assignment | ` x ^= y` | `x = x ^ y  `
 * | Bitwise OR assignment | x &#124;== y | x = x &#124;= y
 * | Logical AND assignment |  `x &&= y` |  `x && (x = y)  `
 * | Logical OR assignment | x &#124;=&#124;== y  | x &#124;=&#124;= (x = y)
 * | Logical nullish assignment |  `x ??= y`   | `x ?? (x = y)`
 *
 * [MDN assignment operator documentation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Expressions_and_Operators#assignment_operators)
 */

export type Assignment = '='
export type AssignmentArithmeticAddition = '+='
export type AssignmentArithmeticSubtraction = '-='
export type AssignmentArithmeticMultiplication = '*='
export type AssignmentArithmeticDivide = '/='
export type AssignmentArithmeticRemainder = '%='
export type AssignmentArithmeticExponentiation = '**='
export type AssignmentBitwiseLeftShift = '<<='
export type AssignmentBitwiseRightShift = '>>='
export type AssignmentBitwiseUnsignedRightShift = '>>>='
export type AssignmentBitwiseAND = '&='
export type AssignmentBitwiseXOR = '^='
export type AssignmentBitwiseOR = '|='
export type AssignmentLogicalAND = '&&='
export type AssignmentLogicalOR = '||='
export type AssignmentLogicalNullish = '??='
export type AssignmentOperatorArithmetic =
  | AssignmentArithmeticAddition
  | AssignmentArithmeticSubtraction
  | AssignmentArithmeticMultiplication
  | AssignmentArithmeticDivide
  | AssignmentArithmeticRemainder
  | AssignmentArithmeticExponentiation
export type AssignmentOperatorBitwise =
  | AssignmentBitwiseLeftShift
  | AssignmentBitwiseRightShift
  | AssignmentBitwiseUnsignedRightShift
  | AssignmentBitwiseAND
  | AssignmentBitwiseXOR
  | AssignmentBitwiseOR
export type AssignmentOperatorLogical =
  | AssignmentLogicalAND
  | AssignmentLogicalOR
  | AssignmentLogicalNullish
export type AssignmentOperator =
  | Assignment
  | AssignmentOperatorArithmetic
  | AssignmentOperatorBitwise
  | AssignmentOperatorLogical

//  .d8888b.                                                   d8b
// d88P  Y88b                                                  Y8P
// 888    888
// 888         .d88b.  88888b.d88b.  88888b.   8888b.  888d888 888 .d8888b   .d88b.  88888b.
// 888        d88""88b 888 "888 "88b 888 "88b     "88b 888P"   888 88K      d88""88b 888 "88b
// 888    888 888  888 888  888  888 888  888 .d888888 888     888 "Y8888b. 888  888 888  888
// Y88b  d88P Y88..88P 888  888  888 888 d88P 888  888 888     888      X88 Y88..88P 888  888
//  .d88888b.  "Y88P"  888  888  888 88888P"  "Y888888 888     888  88888P'  "Y88P"  888  888
// d88P" "Y88b                       888          888
// 888     888                       888          888
// 888     888 88888b.   .d88b.  888d888  8888b.  888888  .d88b.  888d888 .d8888b
// 888     888 888 "88b d8P  Y8b 888P"       "88b 888    d88""88b 888P"   88K
// 888     888 888  888 88888888 888     .d888888 888    888  888 888     "Y8888b.
// Y88b. .d88P 888 d88P Y8b.     888     888  888 Y88b.  Y88..88P 888          X88
//  "Y88888P"  88888P"   "Y8888  888     "Y888888  "Y888  "Y88P"  888      88888P'
//             888
//             888
//             888
/**
 * | Operator | Description | Examples returning true
 * | --- | --- | --- |
 * | Equal (==)|  Returns true if the operands are equal.  | `3 == var1` `"3" == var1` `3 == '3'`
 * | Not equal (!=)|  Returns true if the operands are not equal.|  `var1 != 4` `var2 != "3"`
 * | Strict equal (===)|  Returns true if the operands are equal and of the same type. See also Object.is and sameness in JS.  | `3 === var1`
 * | Strict not equal (!==)|  Returns true if the operands are of the same type but not equal, or are of different type.|  `var1 !== "3"` `3 !== '3'`
 * | Greater than (>)|  Returns true if the left operand is greater than the right operand.|  `var2 > var1` `"12" > 2`
 * | Greater than or equal (>=)  | Returns true if the left operand is greater than or equal to the right operand.|  `var2 >= var1` `var1 >= 3`
 * | Less than (<)|  Returns true if the left operand is less than the right operand.|  `var1 < var2` `"2" < 12`
 * | Less than or equal (<=)|  Returns true if the left operand is less than or equal to the right operand.|  `var1 <= var2` `var2 <= 5`
 *
 * [MDN comparison operator documentation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Expressions_and_Operators#comparison_operators)
 */

export type ComparisonEqual = '=='
export type ComparisonNotEqual = '!='
export type ComparisonStrictEqual = '==='
export type ComparisonStrictNotEqual = '!=='
export type ComparisonGreaterThan = '>'
export type ComparisonGreaterThanOrEqual = '>='
export type ComparisonLessThan = '<'
export type ComparisonLessThanOrEqual = '<='
export type ComparisonOperatorLoose =
  | ComparisonEqual
  | ComparisonNotEqual
export type ComparisonOperatorStrict =
  | ComparisonStrictEqual
  | ComparisonStrictNotEqual
export type ComparisonOperator =
  | ComparisonOperatorLoose
  | ComparisonOperatorStrict
  | ComparisonGreaterThan
  | ComparisonGreaterThanOrEqual
  | ComparisonLessThan
  | ComparisonLessThanOrEqual


//        d8888         d8b 888    888                             888    d8b
//       d88888         Y8P 888    888                             888    Y8P
//      d88P888             888    888                             888
//     d88P 888 888d888 888 888888 88888b.  88888b.d88b.   .d88b.  888888 888  .d8888b
//    d88P  888 888P"   888 888    888 "88b 888 "888 "88b d8P  Y8b 888    888 d88P"
//   d88P   888 888     888 888    888  888 888  888  888 88888888 888    888 888
//  d8888888888 888     888 Y88b.  888  888 888  888  888 Y8b.     Y88b.  888 Y88b.
// d.d88888b.88 888     888  "Y888 888  888 888  8888 888  "Y8888   "Y888 888  "Y8888P
// d88P" "Y88b                                    888
// 888     888                                    888
// 888     888 88888b.   .d88b.  888d888  8888b.  888888  .d88b.  888d888 .d8888b
// 888     888 888 "88b d8P  Y8b 888P"       "88b 888    d88""88b 888P"   88K
// 888     888 888  888 88888888 888     .d888888 888    888  888 888     "Y8888b.
// Y88b. .d88P 888 d88P Y8b.     888     888  888 Y88b.  Y88..88P 888          X88
//  "Y88888P"  88888P"   "Y8888  888     "Y888888  "Y888  "Y88P"  888      88888P'
//             888
//             888
//             888
/**
 * | Operator  | Description  | Example
 * | --- | --- | --- |
 * | Remainder (%)  | Binary operator. Returns the integer remainder of dividing the two operands.  | 12 % 5 returns 2.
 * | Increment (++)  | Unary operator. Adds one to its operand. If used as a prefix operator (++x), returns the value of its operand after adding one; if used as a postfix operator (x++), returns the value of its operand before adding one.  | If x is 3, then ++x sets x to 4 and returns 4, whereas x++ returns 3 and, only then, sets x to 4.
 * | Decrement (--)  | Unary operator. Subtracts one from its operand. The return value is analogous to that for the increment operator.  | If x is 3, then --x sets x to 2 and returns 2, whereas x-- returns 3 and, only then, sets x to 2.
 * | Unary negation (-)  | Unary operator. Returns the negation of its operand.  | If x is 3, then -x returns -3.
 * | Unary plus (+)  | Unary operator. Attempts to convert the operand to a number, if it is not already. | `+"3" returns 3.` `+true returns 1.`
 * | Exponentiation operator (**)  | Calculates the base to the exponent power, that is, base^exponent  | `2 ** 3 returns 8.` `10 ** -1 returns 0.1.`
 *
 * [MDN arithmetic operator documentation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Expressions_and_Operators#arithmetic_operators)
 */

export type Remainder = '%'
export type Increment = '++'
export type Decrement = '--'
export type UnaryPlus = '+'
export type UnaryNegation = '-'
export type Exponentiation = '**'
export type ArithmeticOperator =
  | Remainder
  | Increment
  | Decrement
  | UnaryPlus
  | UnaryNegation
  | Exponentiation

//
// 888888b.   d8b 888                  d8b
// 888  "88b  Y8P 888                  Y8P
// 888  .88P      888
// 8888888K.  888 888888 888  888  888 888 .d8888b   .d88b.
// 888  "Y88b 888 888    888  888  888 888 88K      d8P  Y8b
// 888    888 888 888    888  888  888 888 "Y8888b. 88888888
// 888   d88P 888 Y88b.  Y88b 888 d88P 888      X88 Y8b.
// 8.d88888b. 888  "Y888  "Y8888888P"  888  88888P888"Y8888
// d88P" "Y88b                                    888
// 888     888                                    888
// 888     888 88888b.   .d88b.  888d888  8888b.  888888  .d88b.  888d888 .d8888b
// 888     888 888 "88b d8P  Y8b 888P"       "88b 888    d88""88b 888P"   88K
// 888     888 888  888 88888888 888     .d888888 888    888  888 888     "Y8888b.
// Y88b. .d88P 888 d88P Y8b.     888     888  888 Y88b.  Y88..88P 888          X88
//  "Y88888P"  88888P"   "Y8888  888     "Y888888  "Y888  "Y88P"  888      88888P'
//             888
//             888
//             888
/**
 * | Operator | Usage | Example
 * | --- | --- | --- |
 * | Bitwise AND  | `a & b` |  Returns a one in each bit position for which the corresponding bits of both operands are ones.
 * | Bitwise OR  | a &#124; b |  Returns a zero in each bit position for which the corresponding bits of both operands are zeros.
 * | Bitwise XOR  | `a ^ b` |  Returns a zero in each bit position for which the corresponding bits are the same. [Returns a one in each bit position for which the corresponding bits are different.]
 * | Bitwise NOT  | `~ a` |  Inverts the bits of its operand.
 * | Left shift  | `a << b` |  Shifts a in binary representation b bits to the left, shifting in zeros from the right.
 * | Sign-propagating right shift  | `a >> b` |  Shifts a in binary representation b bits to the right, discarding bits shifted off.
 * | Zero-fill right shift  | `a >>> b` |  Shifts a in binary representation b bits to the right, discarding bits shifted off, and shifting in zeros from the left.
 *
 * [MDN bitwise operator documentation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Expressions_and_Operators#bitwise_operators)
 */

export type BitwiseAND = '&'
export type BitwiseOR = '|'
export type BitwiseXOR = '~'
export type BitwiseLeftShift = '<<'
export type BitwiseSignPropgratingRightShift = '>>'
export type BitwiseZeroFillRightShift = '>>>'
export type BitwiseOperator =
  | BitwiseAND
  | BitwiseOR
  | BitwiseXOR
  | BitwiseLeftShift
  | BitwiseSignPropgratingRightShift
  | BitwiseZeroFillRightShift

// 888                        d8b                   888
// 888                        Y8P                   888
// 888                                              888
// 888       .d88b.   .d88b.  888  .d8888b  8888b.  888
// 888      d88""88b d88P"88b 888 d88P"        "88b 888
// 888      888  888 888  888 888 888      .d888888 888
// 888      Y88..88P Y88b 888 888 Y88b.    888  888 888
// 8.d88888b."Y88P"   "Y88888 888  "Y8888P "Y8888888888
// d88P" "Y88b            888                     888
// 888     888       Y8b d88P                     888
// 888     888 88888b."Y8.d88b.  888d888  8888b.  888888  .d88b.  888d888 .d8888b
// 888     888 888 "88b d8P  Y8b 888P"       "88b 888    d88""88b 888P"   88K
// 888     888 888  888 88888888 888     .d888888 888    888  888 888     "Y8888b.
// Y88b. .d88P 888 d88P Y8b.     888     888  888 Y88b.  Y88..88P 888          X88
//  "Y88888P"  88888P"   "Y8888  888     "Y888888  "Y888  "Y88P"  888      88888P'
//             888
//             888
//             888
//
/**
 * | Operator  | Usage  | Description
 * | --- | --- | --- |
 * | Logical AND (&&)  | expr1 && expr2  | Returns expr1 if it can be converted to false; otherwise, returns expr2. Thus, when used with Boolean values, && returns true if both operands are true; otherwise, returns false.
 * | Logical OR (||)  | expr1 || expr2  | Returns expr1 if it can be converted to true; otherwise, returns expr2. Thus, when used with Boolean values, || returns true if either operand is true; if both are false, returns false.
 * | Logical NOT (!)  | !expr  | Returns false if its single operand that can be converted to true; otherwise, returns true.
 *
 * [MDN logical operator documentation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Expressions_and_Operators#logical_operators)
 */

export type LogicalAND = '&&'
export type LogicalOR = '||'
export type LogicalNOT = '!'
export type LogicalOperator =
  | LogicalAND
  | LogicalOR
  | LogicalNOT
