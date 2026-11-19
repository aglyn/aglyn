// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers
import XCTest

@testable import AglynScreens

/// Waivers, part two (AGL-4042): the `signature`, `photo` and `group` field kinds, and the sign-at-the-window and paper
/// waiver forms sending what the console's send. The Kotlin renderer's `WaiversSignSpecsTest` checks the same.
final class WaiversSignTests: XCTestCase {
  let strokes: SignatureInk.Strokes = [
    [SignaturePoint(100, 100), SignaturePoint(200, 300), SignaturePoint(400, 500)],
    [SignaturePoint(900, 900)],
    [SignaturePoint(0, 0), SignaturePoint(1000, 1000)],
  ]

  override func setUp() {
    ScreenValues.timeZone = TimeZone(identifier: "UTC")!
  }

  func testADrawnSignatureIsTakenAsTheConsolesPadTakesIt() {
    XCTAssertEqual(SignatureInk.at(CGPoint(x: 150, y: 25), in: CGSize(width: 300, height: 100)), SignaturePoint(500, 250))
    XCTAssertEqual(SignatureInk.at(CGPoint(x: 400, y: -5), in: CGSize(width: 300, height: 100)), SignaturePoint(1000, 0))
    XCTAssertEqual(SignatureInk.at(CGPoint(x: 0.5, y: 0), in: CGSize(width: 300, height: 100)), SignaturePoint(2, 0))
    let started = SignatureInk.begin([], SignaturePoint(10, 10))
    XCTAssertNil(SignatureInk.extend(started, SignaturePoint(11, 11)))
    XCTAssertEqual(SignatureInk.extend(started, SignaturePoint(12, 11)), [[SignaturePoint(10, 10), SignaturePoint(12, 11)]])
    let full: SignatureInk.Strokes = [(0..<SignatureInk.maxPoints).map { SignaturePoint($0 % 1000, 0) }]
    XCTAssertNil(SignatureInk.extend(full, SignaturePoint(500, 500)))
    XCTAssertEqual(SignatureInk.begin(full, SignaturePoint(1, 1)).count, 2)
  }

  func testTheSignatureIsKeptAsStrokesAndTheSameOneBitPngAsKotlin() throws {
    let png = SignatureInk.png(strokes)
    // The same bytes the Kotlin kit makes (bin/signature-png-ref.py computes them independently).
    XCTAssertEqual(png.count, 60468)
    XCTAssertEqual(
      SHA256.hash(data: png).map { String(format: "%02x", $0) }.joined(),
      "f213b44458fca0eabc3f5b4e5bb5da81c4ded6a7295d51769990f2ea259514a3")
    let source = try XCTUnwrap(CGImageSourceCreateWithData(png as CFData, nil))
    let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
    XCTAssertEqual(image.width, 1200)
    XCTAssertEqual(image.height, 400)

    let stored = SignatureInk.encode(strokes)
    let value = try XCTUnwrap(JSONValue.decode(Data(stored.utf8)))
    XCTAssertEqual(value["strokes"], JSONValue.decode(Data("[[[100,100],[200,300],[400,500]],[[900,900]],[[0,0],[1000,1000]]]".utf8)))
    XCTAssertTrue(value["png"]?.stringValue?.hasPrefix("data:image/png;base64,iVBORw0KGgo") == true)
    XCTAssertEqual(SignatureInk.strokes(of: stored), strokes)
    XCTAssertEqual(SignatureInk.encode([]), "")
    XCTAssertEqual(SignatureInk.json(""), .null)
    let field = try XCTUnwrap(FieldSpec(JSONValue.decode(Data(#"{"key":"drawn","label":"Signature","kind":"signature"}"#.utf8))!))
    XCTAssertEqual(fieldJSON(field, .text(stored)), value)
  }

  func testAPagePhotoIsShrunkToSixteenHundredPixelsAndNeverGrown() throws {
    XCTAssertEqual(PagePhoto.longerSide(width: 4032, height: 3024), 1600)
    XCTAssertEqual(PagePhoto.longerSide(width: 800, height: 600), 800)
    // A photo larger than the edge comes back a JPEG 1600 wide.
    let context = try XCTUnwrap(
      CGContext(
        data: nil, width: 2000, height: 1000, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceGray(),
        bitmapInfo: CGImageAlphaInfo.none.rawValue))
    let picture = try XCTUnwrap(context.makeImage())
    let encoded = NSMutableData()
    let destination = try XCTUnwrap(CGImageDestinationCreateWithData(encoded, UTType.png.identifier as CFString, 1, nil))
    CGImageDestinationAddImage(destination, picture, nil)
    XCTAssertTrue(CGImageDestinationFinalize(destination))
    let url = try XCTUnwrap(PagePhoto.dataURL(encoded as Data))
    XCTAssertTrue(url.hasPrefix("data:image/jpeg;base64,/9j/"))
    let shrunk = try XCTUnwrap(PagePhoto.image(url))
    XCTAssertEqual(shrunk.width, 1600)
    XCTAssertEqual(shrunk.height, 800)
    XCTAssertNil(PagePhoto.dataURL(Data("not a photo".utf8)))
  }

  func testAGroupStartsWithItsMinimumAndSendsEachSetTrimmed() throws {
    let field = try XCTUnwrap(
      FieldSpec(
        JSONValue.decode(
          Data(
            #"{"key":"minors","label":"","kind":"group","min":1,"max":10,"fields":[{"key":"name","label":"Minor’s full name","kind":"text"},{"key":"dateOfBirth","label":"Minor’s date of birth","kind":"date"}]}"#
              .utf8))!))
    XCTAssertEqual(initialValue(field, in: .object([:])), .text("[{}]"))
    let typed = FieldGroups.encode([["name": " Sam Lee "], ["name": "Kim", "dateOfBirth": "2016-02-03"]])
    XCTAssertEqual(FieldGroups.items(typed), [["name": " Sam Lee "], ["name": "Kim", "dateOfBirth": "2016-02-03"]])
    XCTAssertEqual(
      fieldJSON(field, .text(typed)),
      JSONValue.decode(Data(#"[{"name":"Sam Lee","dateOfBirth":""},{"name":"Kim","dateOfBirth":"2016-02-03"}]"#.utf8)))
  }

  private func screen(_ id: String) throws -> ScreenSpec {
    let url = ScreenSpecTests.specFiles.first { $0.lastPathComponent == "waivers.screens.json" }
    return try XCTUnwrap(ScreenCatalog.parse(try Data(contentsOf: try XCTUnwrap(url))).first { $0.id == id })
  }

  func testASigningAtTheWindowSendsWhatTheConsolesFormSends() throws {
    let spec = try screen("waivers.sign")
    let block = try XCTUnwrap(spec.blocks.first { $0.id == "sign" })
    let submit = try XCTUnwrap(block["submit"].flatMap(ActionSpec.init))
    XCTAssertEqual(submit.url, "/api/waivers/sign-at-window")
    XCTAssertEqual(submit.navigate?.screen, "waivers.signed")
    let drawn = SignatureInk.encode(strokes)
    let context = try XCTUnwrap(
      JSONValue.decode(
        Data(
          #"""
          {"site":{"id":"h1"},"data":{"w":{"waiver":{"id":"w1","version":3,"title":"Rider release"}}},
           "form":{"name":"Pat Lee","email":"","phone":"","dateOfBirth":"1990-01-02","forMinors":true,
             "minors":[{"name":"Sam Lee","dateOfBirth":"2015-04-02"}],"relationship":"Parent","checked":["read"],"consent":true,
             "method":"drawn","drawn":\#(drawn)}}
          """#.utf8)))
    guard case .object(var sent) = ScreenValues.resolveBody(try XCTUnwrap(submit.body), in: context) else { return XCTFail("no body") }
    sent["attemptKey"] = nil
    XCTAssertEqual(
      JSONValue.object(sent),
      JSONValue.decode(
        Data(
          #"""
          {"hostId":"h1","waiverId":"w1","version":3,"signer":{"name":"Pat Lee","email":"","phone":"","dateOfBirth":"1990-01-02"},
           "minors":[{"name":"Sam Lee","dateOfBirth":"2015-04-02"}],"guardianRelationship":"Parent","checked":["read"],
           "signature":{"kind":"drawn","strokes":[[[100,100],[200,300],[400,500]],[[900,900]],[[0,0],[1000,1000]]]},
           "signatureImage":"\#(SignatureInk.dataURL(strokes))","consent":true,"website":""}
          """#.utf8)))
  }

  func testAPaperWaiverIsRecordedWithItsPhoto() throws {
    let spec = try screen("waivers.paper")
    let block = try XCTUnwrap(spec.blocks.first { $0.id == "record" })
    let submit = try XCTUnwrap(block["submit"].flatMap(ActionSpec.init))
    XCTAssertEqual(submit.url, "/api/waivers/paper")
    XCTAssertTrue(submit.back)
    let context = try XCTUnwrap(
      JSONValue.decode(
        Data(
          #"""
          {"site":{"id":"h1"},"form":{"waiverId":"w3","signedOn":"2026-11-15","name":"Riley Park","email":"","phone":"","dateOfBirth":"",
             "photo":"data:image/jpeg;base64,/9j/AQ=="}}
          """#.utf8)))
    guard case .object(var sent) = ScreenValues.resolveBody(try XCTUnwrap(submit.body), in: context) else { return XCTFail("no body") }
    sent["attemptKey"] = nil
    XCTAssertEqual(
      JSONValue.object(sent),
      JSONValue.decode(
        Data(
          #"""
          {"hostId":"h1","waiverId":"w3","signedOnDayKey":"2026-11-15","signer":{"name":"Riley Park","email":"","phone":"","dateOfBirth":""},
           "minors":[],"guardianRelationship":"","photo":"data:image/jpeg;base64,/9j/AQ=="}
          """#.utf8)))
  }
}
