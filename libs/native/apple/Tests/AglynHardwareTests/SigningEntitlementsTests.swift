// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynHardware

/// Tap to Pay on iPhone is offered only by a build signed with Apple's entitlement (the Release entitlements leave it out
/// while Apple's grant is development-only), read off the build's own executable.
final class SigningEntitlementsTests: XCTestCase {
  private let tapToPay = TapToPayIPhone.entitlement

  private func plist(_ keys: [String: Any]) -> Data {
    (try? PropertyListSerialization.data(fromPropertyList: keys, format: .xml, options: 0)) ?? Data()
  }

  private func le32(_ value: UInt32) -> [UInt8] { (0..<4).map { UInt8((value >> (8 * $0)) & 0xFF) } }
  private func le64(_ value: UInt64) -> [UInt8] { (0..<8).map { UInt8((value >> (8 * $0)) & 0xFF) } }
  private func be32(_ value: UInt32) -> [UInt8] { (0..<4).reversed().map { UInt8((value >> (8 * $0)) & 0xFF) } }
  private func name(_ text: String) -> [UInt8] { Array(text.utf8) + [UInt8](repeating: 0, count: 16 - text.utf8.count) }

  /// A thin 64-bit Mach-O whose only load command is a code signature holding `entitlements`.
  private func signed(_ entitlements: [String: Any]) -> Data {
    let xml = [UInt8](plist(entitlements))
    let blob = be32(0xFADE_7171) + be32(UInt32(8 + xml.count)) + xml
    let superblob = be32(0xFADE_0CC0) + be32(UInt32(20 + blob.count)) + be32(1) + be32(5) + be32(20) + blob
    let signatureOffset = 32 + 16
    let command = le32(0x1D) + le32(16) + le32(UInt32(signatureOffset)) + le32(UInt32(superblob.count))
    let header = le32(0xFEED_FACF) + le32(0x0100_000C) + le32(0) + le32(2) + le32(1) + le32(UInt32(command.count)) + le32(0) + le32(0)
    return Data(header + command + superblob)
  }

  /// A simulator build: the entitlements sit in `__TEXT,__entitlements`.
  private func simulator(_ entitlements: [String: Any]) -> Data {
    let xml = [UInt8](plist(entitlements))
    let commandSize = 72 + 80
    let xmlOffset = 32 + commandSize
    var section = name("__entitlements") + name("__TEXT") + le64(0) + le64(UInt64(xml.count)) + le32(UInt32(xmlOffset))
    section += [UInt8](repeating: 0, count: 80 - section.count)
    var segment = le32(0x19) + le32(UInt32(commandSize)) + name("__TEXT") + le64(0) + le64(0) + le64(0) + le64(0)
    segment += le32(5) + le32(5) + le32(1) + le32(0)
    let header = le32(0xFEED_FACF) + le32(0x0100_000C) + le32(0) + le32(2) + le32(1) + le32(UInt32(commandSize)) + le32(0) + le32(0)
    return Data(header + segment + section + xml)
  }

  private func read(_ data: Data) -> SigningEntitlements {
    SigningEntitlements.read { offset, length in
      guard offset >= 0, offset < data.count else { return nil }
      return data.subdata(in: offset..<min(data.count, offset + length))
    }
  }

  func testADevelopmentBuildSignedWithTheEntitlementOffersTapToPayOnAnIPhone() {
    let build = read(signed([tapToPay: true, "aps-environment": "development"]))
    XCTAssertTrue(build.contains(tapToPay))
    XCTAssertTrue(TapToPayIPhone.offered(entitlements: build, onPhone: true))
    XCTAssertFalse(TapToPayIPhone.offered(entitlements: build, onPhone: false))
  }

  func testAStoreBuildWithoutItOffersNoTapToPay() {
    let build = read(signed(["aps-environment": "production", "com.apple.developer.applesignin": ["Default"]]))
    XCTAssertEqual(build.keys, ["aps-environment", "com.apple.developer.applesignin"])
    XCTAssertFalse(TapToPayIPhone.offered(entitlements: build, onPhone: true))
    // Switched off is not granted.
    XCTAssertFalse(read(signed([tapToPay: false])).contains(tapToPay))
  }

  func testASimulatorBuildIsReadFromItsEntitlementsSection() {
    XCTAssertTrue(read(simulator([tapToPay: true])).contains(tapToPay))
  }

  func testAUniversalBinaryAndUnreadableFilesAnswerSafely() {
    let slice = signed([tapToPay: true])
    let fat = be32(0xCAFE_BABE) + be32(1) + be32(0x0100_000C) + be32(0) + be32(4096) + be32(UInt32(slice.count)) + be32(12)
    var data = Data(fat)
    data.append(Data(count: 4096 - data.count))
    data.append(slice)
    XCTAssertTrue(read(data).contains(tapToPay))
    XCTAssertEqual(read(Data([1, 2, 3])).keys, [])
    XCTAssertEqual(read(Data()).keys, [])
  }

  #if os(macOS)
    /// A real signed, universal system app: the walk reads what `codesign -d --entitlements` prints.
    func testARealSignedExecutableIsRead() throws {
      let url = URL(fileURLWithPath: "/System/Applications/Calculator.app/Contents/MacOS/Calculator")
      guard let data = try? Data(contentsOf: url) else { throw XCTSkip("no Calculator here") }
      XCTAssertTrue(read(data).contains("com.apple.security.app-sandbox"))
    }
  #endif
}
