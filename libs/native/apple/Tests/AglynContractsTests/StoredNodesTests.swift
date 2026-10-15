// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Decodes what the console's encoder (`compress`) makes of trees and scalars,
/// from libs/native/contracts/function-cases.generated.json.
final class StoredNodesTests: XCTestCase {
  private static let cases: [(args: [Any], result: String)] = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // AglynContractsTests
      .deletingLastPathComponent()  // Tests
      .deletingLastPathComponent()  // apple
      .deletingLastPathComponent()  // native
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    let entry = (root["functions"] as! [String: Any])["compress"] as! [String: Any]
    return (entry["cases"] as! [[String: Any]]).map { (args: $0["args"] as! [Any], result: $0["result"] as! String) }
  }()

  func testEveryValueTheConsoleEncodesDecodesToItself() throws {
    XCTAssertGreaterThanOrEqual(Self.cases.count, 15)
    for item in Self.cases {
      let decoded = try decodeMsgPack(try XCTUnwrap(Data(base64Encoded: item.result)))
      XCTAssertTrue((decoded as AnyObject).isEqual(item.args[0]), "\(item.args[0]) decoded as \(decoded)")
    }
  }

  func testAStoredFieldIsReadWhicheverFormItIsIn() throws {
    let tree: [String: Any] = ["root": ["$id": "root", "componentId": "div", "nodes": [Any]()] as [String: Any]]
    XCTAssertEqual(decodeStoredNodes(tree)?.keys.sorted(), ["root"])
    let encoded = try XCTUnwrap(
      Self.cases.first { ($0.args[0] as? [String: Any])?["root"] != nil }?.result)
    XCTAssertEqual(decodeStoredNodes(encoded)?.keys.sorted(), ["n1", "n2", "root"])
    XCTAssertEqual(decodeStoredNodes(Data(base64Encoded: encoded)!)?.keys.sorted(), ["n1", "n2", "root"])
    XCTAssertNil(decodeStoredNodes(nil))
    XCTAssertNil(decodeStoredNodes(12))
    XCTAssertNil(decodeStoredNodes("not base64 at all!"))
    XCTAssertNil(decodeStoredNodes(Data([0x91, 0x01]).base64EncodedString()))
  }

  func testBytesThatAreNotAValueAreRefused() {
    XCTAssertThrowsError(try decodeMsgPack(Data([0x92, 0x01])))
    XCTAssertThrowsError(try decodeMsgPack(Data([0xc1])))
    XCTAssertThrowsError(try decodeMsgPack(Data([0x01, 0x02])))
    XCTAssertThrowsError(try decodeMsgPack(Data([0xa2, 0xff, 0xfe])))
    XCTAssertThrowsError(try decodeMsgPack(Data([0xdd, 0x7f, 0xff, 0xff, 0xff])))
  }
}
