// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

final class MediaURLTests: XCTestCase {
  func testAReferenceIsServedFromTheConsolesCDNForTheSiteBeingShown() {
    XCTAssertEqual(
      mediaPreviewURL("media:h/m1", origin: "https://console.test/", hostID: "h")?.absoluteString,
      "https://console.test/api/media/cdn/h/m1?w=320")
    XCTAssertEqual(
      mediaPreviewURL("media:org:o1/m2", origin: "https://console.test", hostID: "h9")?.absoluteString,
      "https://console.test/api/media/cdn/org:o1:h9/m2?w=320")
    XCTAssertEqual(
      mediaPreviewURL("media:org:o1/m2", origin: "https://console.test", hostID: nil, width: 96)?.absoluteString,
      "https://console.test/api/media/cdn/org:o1/m2?w=96")
  }

  func testACDNPathAsTheMediaPickerStoresItIsReadFromTheConsole() {
    // A workspace logo and a site favicon hold `media.cdnPath ?? media.url` (the console's MediaUrlField).
    XCTAssertEqual(
      mediaPreviewURL("/api/media/cdn/org:o1/logo", origin: "http://localhost:4370", hostID: nil, width: 160)?
        .absoluteString,
      "http://localhost:4370/api/media/cdn/org:o1/logo?w=160")
    XCTAssertEqual(
      mediaPreviewURL("/img/a.png", origin: "https://console.test", hostID: "h")?.absoluteString,
      "https://console.test/img/a.png")
  }

  func testAnAddressStaysAsItIs() {
    XCTAssertEqual(
      mediaPreviewURL("https://example.com/a.png", origin: "https://console.test", hostID: "h")?.absoluteString,
      "https://example.com/a.png")
  }

  func testNothingOrAnythingThatIsNotAnHTTPAddressIsNoPicture() {
    XCTAssertNil(mediaPreviewURL(nil, origin: "https://console.test", hostID: "h"))
    XCTAssertNil(mediaPreviewURL("  ", origin: "https://console.test", hostID: "h"))
    XCTAssertNil(mediaPreviewURL("javascript:alert(1)", origin: "https://console.test", hostID: nil))
    XCTAssertNil(mediaPreviewURL("//evil.example/a.png", origin: "https://console.test", hostID: nil))
    XCTAssertNil(mediaPreviewURL("a bowl on a shelf", origin: "https://console.test", hostID: nil))
    XCTAssertNil(mediaPreviewURL("media:not a ref", origin: "https://console.test", hostID: nil))
  }
}
