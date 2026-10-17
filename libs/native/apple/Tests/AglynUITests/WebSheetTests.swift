// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynUI

/// Plain web pages open in the in-app web sheet; mail, phone and app links go to the system (AGL-3893).
final class WebSheetTests: XCTestCase {
  func testOnlyWebPagesOpenInTheSheet() throws {
    XCTAssertTrue(AglynWebPage.opensInSheet(try XCTUnwrap(URL(string: "https://juniper-street.aglyn.app/"))))
    XCTAssertTrue(AglynWebPage.opensInSheet(try XCTUnwrap(URL(string: "HTTP://example.test/preview"))))
    XCTAssertFalse(AglynWebPage.opensInSheet(try XCTUnwrap(URL(string: "mailto:dana@example.test"))))
    XCTAssertFalse(AglynWebPage.opensInSheet(try XCTUnwrap(URL(string: "tel:+15555550100"))))
    XCTAssertFalse(AglynWebPage.opensInSheet(try XCTUnwrap(URL(string: "aglyn://orders"))))
  }
}
