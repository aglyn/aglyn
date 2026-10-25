// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynUI

/// An SVG brand picture is read as the media CDN's PNG of it (AGL-3996): ImageIO decodes no SVG, and `?w=` returns it
/// unchanged, so a workspace logo uploaded as an SVG drew its initials on the rail.
final class RasterArtTests: XCTestCase {
  func testACdnAddressAsksForThePngAtLeastAsWideAsItsWidth() {
    let url = URL(string: "https://app.aglyn.com/api/media/cdn/org:Ok7u/6RSz?w=160")!
    XCTAssertEqual(AglynRasterArt.pngURL(for: url)?.absoluteString, "https://app.aglyn.com/api/media/cdn/org:Ok7u/6RSz?icon=png-192")
    let small = URL(string: "http://localhost:4400/api/media/cdn/org:a/b?w=64")!
    XCTAssertEqual(AglynRasterArt.pngURL(for: small)?.absoluteString, "http://localhost:4400/api/media/cdn/org:a/b?icon=png-72")
    let huge = URL(string: "https://app.aglyn.com/api/media/cdn/org:a/b?w=2000")!
    XCTAssertEqual(AglynRasterArt.pngURL(for: huge)?.absoluteString, "https://app.aglyn.com/api/media/cdn/org:a/b?icon=png-512")
  }

  func testAnAddressOffTheCdnOrAlreadyARepresentationHasNone() {
    XCTAssertNil(AglynRasterArt.pngURL(for: URL(string: "https://example.com/logo.svg")!))
    XCTAssertNil(AglynRasterArt.pngURL(for: URL(string: "https://app.aglyn.com/api/media/cdn/org:a/b?icon=png-32")!))
  }

  func testAnSvgResponseIsVectorAndAPngIsNot() throws {
    let svg = Data("<svg xmlns=\"http://www.w3.org/2000/svg\"/>".utf8)
    let url = URL(string: "https://app.aglyn.com/api/media/cdn/org:a/b")!
    let svgResponse = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "image/svg+xml"])!
    XCTAssertTrue(AglynRasterArt.isVector(svg, response: svgResponse))
    // A one-pixel PNG.
    let png = try XCTUnwrap(Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="))
    let pngResponse = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "image/png"])!
    XCTAssertFalse(AglynRasterArt.isVector(png, response: pngResponse))
  }
}
