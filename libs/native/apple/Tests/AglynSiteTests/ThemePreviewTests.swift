// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynSite

/// The theme picker's preview (AGL-3668): what `/api/hosts/theme` `preview` answers, read as the kit draws it, and the
/// console's words around it. The Kotlin `ThemePreviewTest` reads the same answer.
final class ThemePreviewTests: XCTestCase {
  private let answer = #"""
    {"name":"Minimal","edited":true,
     "light":{"scheme":"light","fontFamily":"\"Inter\", sans-serif","background":{"default":"#ffffff","paper":"#fdfdfd"},
       "text":{"primary":"rgba(0, 0, 0, 0.87)","secondary":"#6b6b74","disabled":"#a1a1aa"},"divider":"#e4e4e7",
       "primary":{"main":"#18181b","contrastText":"#fafafa","dark":"#000000"},
       "secondary":{"main":"#52525b","contrastText":"#fafafa"},"tertiary":{"main":"#71717a","contrastText":"#ffffff","dark":"#52525b"},
       "error":{"main":"#dc2626","contrastText":"#ffffff","dark":"#b91c1c"},"warning":{"main":"#f59e0b","contrastText":"#09090b","dark":"#b45309"},
       "info":{"main":"#2563eb","contrastText":"#ffffff","dark":"#1d4ed8"},"success":{"main":"#16a34a","contrastText":"#ffffff","dark":"#15803d"},
       "surface":{"main":"#f4f4f5","contrastText":"#18181b"},"tint":{"primary":"#f4f4f5","secondary":"#f4f4f5","tertiary":"#fafafa"},
       "selected":"rgba(0, 0, 0, 0.08)","radius":8,
       "typography":[{"key":"h1","sizePx":36,"raw":"2.25rem","weight":800},{"key":"body1","sizePx":16,"raw":"1rem","weight":null},{"key":"bad"}]},
     "dark":{"primary":{"main":"#fafafa","contrastText":"#18181b"},"background":{"default":"#09090b","paper":"#09090b"}}}
    """#

  func testTheAnswerReadsAsTheKitDrawsIt() throws {
    let read = themePreviewAnswer(of: try JSONDecoder().decode(JSONValue.self, from: Data(answer.utf8)))
    XCTAssertEqual(read.name, "Minimal")
    XCTAssertTrue(read.edited)
    let light = read.kit(dark: false)
    XCTAssertEqual(light.primary, ThemePreviewAccent(main: "#18181b", contrastText: "#fafafa", dark: "#000000"))
    // A colour with no darker shade of its own draws its main.
    XCTAssertEqual(light.secondary.dark, "#52525b")
    XCTAssertEqual(light.background.paper, "#fdfdfd")
    XCTAssertEqual(light.selected, "rgba(0, 0, 0, 0.08)")
    XCTAssertEqual(light.radius, 8)
    // A rung without a size is left out; a rung without a weight keeps its size.
    XCTAssertEqual(light.typography.map(\.key), ["h1", "body1"])
    XCTAssertEqual(light.typography.first?.weight, 800)
    XCTAssertNil(light.typography.last?.weight)
    let dark = read.kit(dark: true)
    XCTAssertEqual(dark.primary.main, "#fafafa")
    XCTAssertEqual(dark.background.default, "#09090b")
    XCTAssertEqual(dark.divider, "")
  }

  func testTheConsoleWordsAroundThePreview() {
    XCTAssertEqual(themePreviewLead(name: "Minimal", edited: false), "Previewing Minimal.")
    XCTAssertEqual(themePreviewLead(name: "Minimal", edited: true), "Previewing Minimal with the edits you made to it.")
    XCTAssertEqual(
      themePreviewNotice(candidate: "Minimal", current: "Spring", currentEdited: true),
      "Using Minimal repaints the live site now. Spring stays in this list with your edits to it, so you can switch back. "
        + "Unsaved changes in the editor below are discarded.")
    XCTAssertEqual(
      themePreviewNotice(candidate: "Minimal", current: nil, currentEdited: false),
      "Using Minimal repaints the live site now. The current theme stays in this list, so you can switch back. "
        + "Unsaved changes in the editor below are discarded.")
  }
}
