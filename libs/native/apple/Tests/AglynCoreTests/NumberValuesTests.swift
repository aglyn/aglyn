// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// A stored 0 or 1 stays a number: `as Bool` also matches an NSNumber holding either.
final class NumberValuesTests: XCTestCase {
  private let numbers: [Any] = [NSNumber(value: 1), NSNumber(value: 0), NSNumber(value: 2), 1, 0, Int64(1), 1.0, 0.5]

  func testBothConvertersKeepANumberANumber() {
    let expected: [Double] = [1, 0, 2, 1, 0, 1, 1, 0.5]
    for (value, number) in zip(numbers, expected) {
      XCTAssertEqual(JSONValue.from(value), .number(number), "\(value)")
      XCTAssertEqual(jsonValue(value), .number(number), "\(value)")
    }
  }

  func testBothConvertersKeepAFlagAFlag() {
    for (value, flag) in [(NSNumber(value: true), true), (NSNumber(value: false), false)] as [(NSNumber, Bool)] {
      XCTAssertEqual(JSONValue.from(value), .bool(flag))
      XCTAssertEqual(jsonValue(value), .bool(flag))
    }
    XCTAssertEqual(JSONValue.from(true), .bool(true))
    XCTAssertEqual(jsonValue(false), .bool(false))
  }

  func testAFirestoreDocumentsIntegerAndFlagKeepTheirKinds() {
    let decoded = RestFirestoreReader.decodeValue(["integerValue": "1"]) as Any
    XCTAssertEqual(jsonValue(decoded), .number(1))
    let flag = RestFirestoreReader.decodeValue(["booleanValue": true]) as Any
    XCTAssertEqual(jsonValue(flag), .bool(true))
  }

  func testNestedValuesKeepTheirKinds() {
    XCTAssertEqual(jsonValue(["minNights": NSNumber(value: 1), "active": NSNumber(value: true)] as [String: Any]),
      .object(["minNights": .number(1), "active": .bool(true)]))
  }
}
