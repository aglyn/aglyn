// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the media reference cases in libs/native/contracts/function-cases.generated.json:
/// the TypeScript's own answers.
final class MediaRefTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // AglynContractsTests
      .deletingLastPathComponent()  // Tests
      .deletingLastPathComponent()  // apple
      .deletingLastPathComponent()  // native
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String, file: StaticString = #filePath, line: UInt = #line) -> [(args: [Any], result: Any)] {
    guard let entry = Self.functions[name] as? [String: Any], let list = entry["cases"] as? [[String: Any]] else {
      XCTFail("no cases for \(name)", file: file, line: line)
      return []
    }
    return list.map { (args: $0["args"] as? [Any] ?? [], result: $0["result"] as Any) }
  }

  /// A JSON string, or nil for null and for anything that is not a string.
  private func text(_ value: Any?) -> String? { value as? String }

  func testPickedFilesAreStoredAsTheConsoleStoresThem() {
    let all = cases("mediaNodeSrc")
    XCTAssertGreaterThanOrEqual(all.count, 10)
    for item in all {
      let media = item.args[0] as? [String: Any] ?? [:]
      let flag = media["private"] as? Bool
      XCTAssertEqual(
        mediaNodeSrc(url: text(media["url"]), cdnPath: text(media["cdnPath"]), isPrivate: flag), text(item.result), "\(item.args)")
    }
  }

  func testStoredValuesAreServedAsTheConsoleServesThem() {
    let all = cases("resolveMediaSrc")
    XCTAssertGreaterThanOrEqual(all.count, 10)
    for item in all {
      let options = item.args.count > 1 ? item.args[1] as? [String: Any] : nil
      XCTAssertEqual(
        resolveMediaSrc(text(item.args[0]), hostID: text(options?["hostId"])), text(item.result), "\(item.args)")
    }
  }

  func testAPickedFileGivesItsAltOnlyToAPlacementWithNone() {
    let all = cases("inheritedMediaAlt")
    XCTAssertGreaterThanOrEqual(all.count, 8)
    for item in all {
      let given = item.args[0] as? [String: Any] ?? [:]
      XCTAssertEqual(
        inheritedMediaAlt(
          placementAlt: text(given["placementAlt"]), assetAlt: text(given["assetAlt"]),
          decorative: given["decorative"] as? Bool ?? false),
        text(item.result), "\(item.args)")
    }
  }

  func testARestrictedAssetIsRequestedThroughTheFormThatNamesTheSite() {
    let all = cases("hostQualifiedCdnPath")
    XCTAssertGreaterThanOrEqual(all.count, 10)
    for item in all {
      XCTAssertEqual(
        hostQualifiedCDNPath(
          text(item.args[0]), visibleTo: item.args[1] as? [String], hostID: text(item.args[2])),
        text(item.result), "\(item.args)")
    }
  }

  func testALibraryFilmsLengthIsItsMeasuredRecordRoundedUp() {
    let all = cases("videoMediaProps")
    XCTAssertGreaterThanOrEqual(all.count, 10)
    for item in all {
      let first = item.args[0] as? [String: Any] ?? [:]
      let expected = (item.result as? [String: Any])?["durationSeconds"] as? NSNumber
      XCTAssertEqual(libraryVideoSeconds(first["assetVideo"]), expected?.intValue, "\(item.args)")
    }
  }

  func testAFilmsPosterIsAskedForOnlyFromThePlatformsOwnCDN() {
    let all = cases("mediaPosterSrc")
    XCTAssertGreaterThanOrEqual(all.count, 10)
    for item in all {
      let options = item.args.count > 1 ? item.args[1] as? [String: Any] : nil
      XCTAssertEqual(
        mediaPosterSrc(text(item.args[0]), hostID: text(options?["hostId"]), width: (options?["width"] as? NSNumber)?.doubleValue),
        text(item.result), "\(item.args)")
    }
  }
}
