// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynSite

final class PageSeoTests: XCTestCase {
  func testResolvesTitleVariablesAsTheLivePageRendersThem() {
    let resolve = { (title: String, site: String, sep: String) in
      resolveSeoTitleVariables(title, pageName: " Menu ", siteName: site, separator: sep)
    }
    XCTAssertEqual(resolve("{{page.name}} {{site.separator}} {{site.name}}", "Bakery", "|"), "Menu | Bakery")
    // No separator set: the default dash. No site name: the separator has nothing after it and goes.
    XCTAssertEqual(resolve("{{page.name}} {{site.separator}} {{site.name}}", "Bakery", ""), "Menu \u{2013} Bakery")
    XCTAssertEqual(resolve("{{page.name}} {{site.separator}} {{site.name}}", "", "|"), "Menu")
    // An unknown variable renders as itself; a title with none is published verbatim.
    XCTAssertEqual(resolve("{{ page.name }} {{oops}}", "", ""), "Menu {{oops}}")
    XCTAssertEqual(resolve("  Plain  title ", "", ""), "  Plain  title ")
    XCTAssertTrue(hasSeoTitleVariables("a {{site.name}}"))
  }

  func testASaveCarriesForwardWhatTheCardDoesNotEdit() {
    let existing: [String: Any] = ["title": "Old", "breadcrumb": "Crumb", "image": "media:h/1", "imageWidth": 1200, "imageHeight": 630, "keep": true]
    let titled = buildScreenSeoUpdate(existing, title: "  New ", description: nil, breadcrumb: nil, image: nil)
    XCTAssertEqual(titled?["title"] as? String, "New")
    XCTAssertEqual(titled?["breadcrumb"] as? String, "Crumb")
    XCTAssertEqual(titled?["imageWidth"] as? Int, 1200)
    XCTAssertEqual(titled?["keep"] as? Bool, true)
    // A blank typed field is removed; a cleared image takes its whole group with it.
    let cleared = buildScreenSeoUpdate(existing, title: " ", description: nil, breadcrumb: nil, image: PageSocialImage(image: "", width: 0, height: 0, alt: ""))
    XCTAssertNil(cleared?["title"])
    XCTAssertNil(cleared?["image"])
    XCTAssertNil(cleared?["imageHeight"])
    let picked = buildScreenSeoUpdate(nil, title: nil, description: nil, breadcrumb: nil, image: PageSocialImage(image: "media:h/2", width: 800, height: 400, alt: "  "))
    XCTAssertEqual(picked?["image"] as? String, "media:h/2")
    XCTAssertNil(picked?["imageAlt"])
    // Nothing left: nil, so the save deletes the map.
    XCTAssertNil(buildScreenSeoUpdate(["title": "x"], title: "", description: nil, breadcrumb: nil, image: nil))
  }

  func testReadsTheStoredSeoAndTheAltAPickBrings() {
    let seo = PageSeo(["title": "T", "image": "media:h/1", "imageWidth": 1200, "imageHeight": 630, "imageAlt": "A cake"])
    XCTAssertEqual(seo.image, PageSocialImage(image: "media:h/1", width: 1200, height: 630, alt: "A cake"))
    XCTAssertNil(PageSeo(nil).image)
    XCTAssertEqual(inheritedSocialImageAlt(current: "", assetAlt: " Bread "), "Bread")
    XCTAssertEqual(inheritedSocialImageAlt(current: "Mine", assetAlt: "Bread"), "Mine")
  }
}
