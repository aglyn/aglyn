/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import { Timestamp as FirestoreTimestamp } from 'firebase/firestore'

/**
 * Scientific notation values for decimal precision of time equivalents for
 * conversions when calculating time. Small to big uses a positive exponent and
 * big to small uses a negative exponent.
 * @example
 * `MILLI_TO_SEC` - 1e3 equals 1,000 i.e., 1,000 milliseconds in a second
 * `SEC_TO_MILLI` - 1e-3 equals 0.001 i.e., 1/1,000 of a second is a millisecond
 */
export enum TimeExchange {
  NANO_TO_MICRO = 1e3,
  NANO_TO_MILLI = 1e6,
  NANO_TO_SEC = 1e9,
  MICRO_TO_NANO = 1e-3,
  MICRO_TO_MILLI = 1e3,
  MICRO_TO_SEC = 1e6,
  MILLI_TO_NANO = 1e-6,
  MILLI_TO_MICRO = 1e-3,
  MILLI_TO_SEC = 1e3,
  SEC_TO_NANO = 1e-9,
  SEC_TO_MICRO = 1e-6,
  SEC_TO_MILLI = 1e-3,
  SEC_TO_MIN = 6e1,
  SEC_TO_HR = 3.6e3,
  SEC_TO_DY = 8.64e4,
  SEC_TO_WK = 6.048e5,
  SEC_TO_MO = 2.628e6,
  SEC_TO_YR = 3.154e7,
  MIN_TO_SEC = 6e-1,
  HR_TO_SEC = 3.6e-3,
  DY_TO_SEC = 8.64e-4,
  WK_TO_SEC = 6.048e-5,
  MO_TO_SEC = 2.628e-6,
  YR_TO_SEC = 3.154e-7,
}

export interface ITimestamp extends FirestoreTimestamp {}

/**
 * A `Timestamp` represents a point in time independent of any time zone or
 * calendar, represented as seconds and fractions of seconds at nanosecond
 * resolution in UTC Epoch time.
 *
 * It is encoded using the Proleptic Gregorian Calendar which extends the
 * Gregorian calendar backwards to year one. It is encoded assuming all minutes
 * are 60 seconds long, i.e. leap seconds are "smeared" so that no leap second
 * table is needed for interpretation. Range is from 0001-01-01T00:00:00Z to
 * 9999-12-31T23:59:59.999999999Z.
 *
 * Model and logical flow inspired by `@firebase/firestore/lite/timestamp`
 */
export class Timestamp extends FirestoreTimestamp implements ITimestamp {
  /**
   * The earliest date supported by Google Firestore timestamps
   * (0001-01-01T00:00:00Z).
   */
  public static MIN_SECONDS = -62135596800

  /**
   * The latest date supported by Google Firestore timestamps
   * (9999-12-31T23:59:59Z).
   */
  public static MAX_SECONDS = 253402322399

  /**
   * Creates a new {@link Timestamp}.
   *
   * @param seconds - The number of seconds of UTC time since Unix epoch
   *     1970-01-01T00:00:00Z. Must be from 0001-01-01T00:00:00Z to
   *     9999-12-31T23:59:59Z inclusive.
   * @param nanoseconds - The non-negative fractions of a second at nanosecond
   *     resolution. Negative second values with fractions must still have
   *     non-negative nanoseconds values that count forward in time. Must be
   *     from 0 to 999,999,999 inclusive.
   */
  constructor(
    /**
     * The number of seconds of UTC time since Unix epoch 1970-01-01T00:00:00Z.
     */
    readonly seconds: number,
    /**
     * The fractions of a second at nanosecond resolution.*
     */
    readonly nanoseconds: number,
  ) {
    super(seconds, nanoseconds)
    if (nanoseconds < 0) {
      throw new Error(
        'invalid-argument: timestamp nanoseconds out of range: ' + nanoseconds,
      )
    }
    if (nanoseconds >= 1e9) {
      throw new Error(
        'invalid-argument: timestamp nanoseconds out of range: ' + nanoseconds,
      )
    }
    if (seconds < Timestamp.MIN_SECONDS) {
      throw new Error(
        'invalid-argument: timestamp seconds out of range: ' + seconds,
      )
    }
    // This will break in the year 10,000.
    if (seconds > Timestamp.MAX_SECONDS) {
      throw new Error(
        'invalid-argument: timestamp seconds out of range: ' + seconds,
      )
    }
  }

  /**
   * Primitive comparator
   * @param left - left operand
   * @param right - right operand
   * @returns -1 if smaller, 0 if equal, 1 if greater
   */
  public static comparator<T>(left: T, right: T): number {
    return left < right ? -1 : left > right ? 1 : 0
  }

  /**
   * Creates a new {@link Timestamp} with the current date, with millisecond
   * precision.
   *
   * @returns a new {@link Timestamp} representing the current date.
   */
  public static now(): Timestamp {
    return this.fromMillis(Date.now())
  }

  /**
   * Creates a new timestamp from the given date.
   *
   * @param date - The date to convert to a {@link Timestamp} instance
   * @returns {@link Timestamp} equivalent as the provided {@link Date}
   */
  public static fromDate(date: Date): ITimestamp {
    return this.fromMillis(date.getTime())
  }

  /**
   * Creates a new timestamp from the given number of milliseconds, since Unix
   * epoch 1970-01-01T00:00:00Z
   *
   * @param milliseconds - Number of milliseconds
   * @returns New {@link Timestamp} instance from the provided milliseconds
   */
  public static fromMillis(milliseconds: number): Timestamp {
    const seconds = Math.floor(milliseconds / TimeExchange.MILLI_TO_SEC)
    const nanoseconds = Math.floor(
      (milliseconds - seconds * TimeExchange.MILLI_TO_SEC) *
        TimeExchange.NANO_TO_MILLI,
    )
    return new this(seconds, nanoseconds)
  }

  /**
   * Converts a {@link Timestamp} to a JavaScript {@link Date} object. This
   * conversion causes a loss of precision since `Date` objects only support
   * millisecond precision.
   *
   * @returns JavaScript {@link Date} object representing the same point in time
   *     as this {@link Timestamp}, with millisecond precision.
   */
  public toDate(): Date {
    return new Date(this.toMillis())
  }

  /**
   * Converts a {@link Timestamp} to a numeric timestamp (in milliseconds since
   * epoch). This operation causes a loss of precision.
   *
   * @returns The time corresponding to this {@link Timestamp}, represented as
   *     the number of milliseconds since Unix epoch 1970-01-01T00:00:00Z.
   */
  public toMillis(): number {
    return (
      this.seconds * TimeExchange.MILLI_TO_SEC +
      this.nanoseconds / TimeExchange.NANO_TO_MILLI
    )
  }

  /**
   * Returns true if this {@link Timestamp} is equal to the provided one.
   *
   * @param other - The {@link Timestamp} to compare against.
   * @returns true if this {@link Timestamp} is equal to the provided one.
   */
  public isEqual(other: ITimestamp): boolean {
    return (
      other.seconds === this.seconds && other.nanoseconds === this.nanoseconds
    )
  }

  /**
   * Returns a textual representation of this Timestamp.
   */
  public toString(): string {
    return `Timestamp(seconds=${this.seconds}, nanoseconds=${this.nanoseconds})`
  }

  /**
   * Converts this object to a primitive string, which allows Timestamp objects
   * to be compared using the `>`, `<=`, `>=` and `>` operators.
   *
   * This method returns a string of the form <seconds>.<nanoseconds> where
   * <seconds> is translated to have a non-negative value and both <seconds>
   * and <nanoseconds> are left-padded with zeroes to be a consistent length.
   * Strings with this format then have a lexicographical ordering that matches
   * the expected ordering. The <seconds> translation is done to avoid having
   * a leading negative sign (i.e. a leading '-' character) in its string
   * representation, which would affect its lexicographical ordering.
   */
  public valueOf(): string {
    const adjustedSeconds = this.seconds - Timestamp.MIN_SECONDS
    // Note: Up to 12 decimal digits are required to represent all valid
    // 'seconds' values.
    const formattedSeconds = String(adjustedSeconds).padStart(12, '0')
    const formattedNanoseconds = String(this.nanoseconds).padStart(9, '0')
    return formattedSeconds + '.' + formattedNanoseconds
  }

  /**
   * Returns a JSON-serializable representation of this Timestamp.
   */
  public toJSON(): { seconds: number; nanoseconds: number } {
    return { seconds: this.seconds, nanoseconds: this.nanoseconds }
  }

  /**
   * Returns the difference of `a` to `b` in seconds unless they are equal, in
   * which case it will compare the difference in nanoseconds
   * @param a - an instance of {@link Timestamp} to compare with {@link b}
   * @param b - an instance of {@link Timestamp} to compare against {@link a}
   */
  public static difference(a: Timestamp, b: Timestamp): number {
    return a._compareTo(b)
  }

  public _compareTo(other: ITimestamp): number {
    if (this.seconds === other.seconds) {
      return Timestamp.comparator(this.nanoseconds, other.nanoseconds)
    }
    return Timestamp.comparator(this.seconds, other.seconds)
  }
}

export default Timestamp
