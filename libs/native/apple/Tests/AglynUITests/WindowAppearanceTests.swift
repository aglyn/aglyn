// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI
import XCTest

@testable import AglynUI

#if os(macOS)
  import AppKit
#endif

final class WindowAppearanceTests: XCTestCase {
  func testTheAccountsChoiceMapsToAnAppearance() {
    XCTAssertEqual(AglynAppearance(appearance: "light", forcesDark: false), .light)
    XCTAssertEqual(AglynAppearance(appearance: "dark", forcesDark: false), .dark)
    XCTAssertEqual(AglynAppearance(appearance: "system", forcesDark: false), .system)
    // An unknown (older or newer) value follows the system, never a stale Dark.
    XCTAssertEqual(AglynAppearance(appearance: "", forcesDark: false), .system)
    XCTAssertEqual(AglynAppearance(appearance: "sepia", forcesDark: false), .system)
  }

  func testNightIsDarkWhateverTheAppearance() {
    for raw in ["light", "dark", "system", ""] {
      XCTAssertEqual(AglynAppearance(appearance: raw, forcesDark: true), .dark, raw)
    }
  }

  func testSystemClearsEveryOverride() {
    XCTAssertNil(AglynAppearance.system.colorScheme)
    XCTAssertEqual(AglynAppearance.light.colorScheme, .light)
    XCTAssertEqual(AglynAppearance.dark.colorScheme, .dark)
    #if os(macOS)
      XCTAssertNil(AglynAppearance.system.appearanceName)
      XCTAssertEqual(AglynAppearance.light.appearanceName, .aqua)
      XCTAssertEqual(AglynAppearance.dark.appearanceName, .darkAqua)
    #endif
  }
}
