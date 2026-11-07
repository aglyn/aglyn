// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import XCTest

@testable import AglynCommercePlugin

final class PosDisplayScreenTests: XCTestCase {
  func testAScreenOpensThePluginsPublicPageWithTheWayBack() {
    XCTAssertEqual(
      customerDisplayScreenHref(AglynContracts.PosDisplayScreen(params: ["host": "shop-1"], path: "/display-sign", pluginId: "waivers")),
      "/kiosk/waivers/display-sign?host=shop-1&return=/kiosk/commerce/pos-display")
  }

  func testAScreenOutOfShapeOpensNothing() {
    XCTAssertNil(customerDisplayScreenHref(AglynContracts.PosDisplayScreen(params: [:], path: "/../console", pluginId: "waivers")))
    XCTAssertNil(customerDisplayScreenHref(AglynContracts.PosDisplayScreen(params: [:], path: "/display-sign", pluginId: "Waivers!")))
  }
}
