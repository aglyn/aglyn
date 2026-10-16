// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the image editor's cases in libs/native/contracts/function-cases.generated.json: the TypeScript's own answers.
final class ImageEditTests: XCTestCase {
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
    guard let entry = Self.functions[name] as? [String: Any], let list = entry["cases"] as? [[String: Any]], !list.isEmpty else {
      XCTFail("no cases for \(name)", file: file, line: line)
      return []
    }
    return list.map { (args: $0["args"] as? [Any] ?? [], result: $0["result"] as Any) }
  }

  private func number(_ value: Any?) -> Double { (value as! NSNumber).doubleValue }

  private func rect(_ value: Any?) -> ImageEditRect? {
    guard let object = value as? [String: Any] else { return nil }
    return ImageEditRect(x: number(object["x"]), y: number(object["y"]), w: number(object["w"]), h: number(object["h"]))
  }

  func testTheSizeAndScaleFollowTheTurn() {
    for item in cases("imageEditWorkedSize") {
      let size = imageEditWorkedSize(width: Int(number(item.args[0])), height: Int(number(item.args[1])), rotation: Int(number(item.args[2])))
      let expected = item.result as! [String: Any]
      XCTAssertEqual(size.width, Int(number(expected["w"])), "\(item.args)")
      XCTAssertEqual(size.height, Int(number(expected["h"])), "\(item.args)")
    }
    for item in cases("imageEditPreviewScale") {
      XCTAssertEqual(imageEditPreviewScale(workedWidth: number(item.args[0]), workedHeight: number(item.args[1])), number(item.result), "\(item.args)")
    }
  }

  func testADragDrawsTheSameCropTheConsoleDoes() {
    for item in cases("imageEditCropFromDrag") {
      let start = item.args[0] as! [String: Any]
      let now = item.args[1] as! [String: Any]
      let aspect = item.args[2] is NSNull ? nil : number(item.args[2])
      let crop = imageEditCropFromDrag(
        startX: number(start["x"]), startY: number(start["y"]), nowX: number(now["x"]), nowY: number(now["y"]), aspect: aspect,
        previewWidth: number(item.args[3]), previewHeight: number(item.args[4]))
      XCTAssertEqual(crop, rect(item.result), "\(item.args)")
    }
  }

  func testAnEditCutsAndSizesAsTheConsoleDoes() {
    for item in cases("imageEditOutput") {
      let worked = item.args[0] as! [String: Any]
      let out = imageEditOutput(
        workedWidth: Int(number(worked["w"])), workedHeight: Int(number(worked["h"])), crop: rect(item.args[1]), scale: number(item.args[2]),
        maxWidth: number(item.args[3]))
      let expected = item.result as! [String: Any]
      let crop = expected["crop"] as! [String: Any]
      XCTAssertEqual(
        [out.cropX, out.cropY, out.cropW, out.cropH, out.width, out.height],
        [crop["x"], crop["y"], crop["w"], crop["h"], expected["width"], expected["height"]].map { Int(number($0)) }, "\(item.args)")
    }
  }

  func testTheCopyIsNamedAndTypedAsTheConsoleDoes() {
    for item in cases("imageEditCopyName") { XCTAssertEqual(imageEditCopyName(item.args[0] as! String), item.result as? String, "\(item.args)") }
    for item in cases("imageEditContentType") { XCTAssertEqual(imageEditContentType(item.args[0] as! String), item.result as? String, "\(item.args)") }
  }

  func testTheOriginalIsAskedForWithDownload() {
    for item in cases("mediaOriginalSrc") { XCTAssertEqual(mediaOriginalSrc(item.args[0] as! String), item.result as? String, "\(item.args)") }
  }

  func testTheAspectsAreTheConsoles() {
    XCTAssertEqual(imageEditAspects.map(\.label), ["Free", "1:1", "4:3", "3:2", "16:9"])
    XCTAssertEqual(imageEditAspects.map(\.ratio), [nil, 1, 4.0 / 3, 1.5, 16.0 / 9])
    XCTAssertEqual(ContractValues.shared.imageEditPreviewMax, 480)
  }
}
