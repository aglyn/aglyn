// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import XCTest

@testable import AglynSite

/// A newer copy under an open editor keeps what was typed and moves every other field to it (AGL-4047, the console's
/// `rebaseSeedEdits`, #2576 and #2581). Kotlin's SeedEditsTest asserts the same.
final class SeedEditsTests: XCTestCase {
  func testAChangedValueKeepsItAndAnUntouchedOneFollowsTheNewCopy() {
    XCTAssertEqual(rebased("Mine", previous: "Old", next: "Server"), "Mine")
    XCTAssertEqual(rebased("Old", previous: "Old", next: "Server"), "Server")
    XCTAssertEqual(rebased("Anything", previous: nil, next: "Server"), "Server", "nothing laid over yet")
    let fields = rebased(
      ["title": "Typed", "seo.title": "Old", "cleared": ""] as [String: String],
      previous: ["title": "Old", "seo.title": "Old", "cleared": "Was"],
      next: ["title": "Server", "seo.title": "Server", "cleared": "Server", "added": "New"])
    XCTAssertEqual(fields, ["title": "Typed", "seo.title": "Server", "cleared": "", "added": "New"])
    XCTAssertEqual(seedCheckingText("site settings"), "Checking your site settings with the server…")
  }

  func testARebaserMovesOnlyTheFieldsNobodyChanged() {
    struct Draft: Equatable { var name: String; var price: String; var notes: String }
    let previous = Draft(name: "Cake", price: "20", notes: "")
    var typed = previous
    typed.name = "Layer cake"
    let out = rebased(typed, previous: previous, next: Draft(name: "Cake", price: "24", notes: "Order a day ahead")) {
      $0.field(\.name); $0.field(\.price); $0.field(\.notes)
    }
    XCTAssertEqual(out, Draft(name: "Layer cake", price: "24", notes: "Order a day ahead"))
  }

  func testTheThemeEditorKeepsItsChangesOverANewerSavedTheme() {
    let previous = ThemeValues(
      colors: ["light": ["primary": "#111111", "divider": nil]], darkScheme: "auto", fontFamily: "__system__",
      borderRadius: 4, spacing: nil, navHeightXs: nil, navHeightSm: nil)
    var draft = previous
    draft.colors["light"]?["primary"] = "#222222"
    draft.spacing = 6
    var next = previous
    next.colors["light"]?["divider"] = "#cccccc"
    next.fontFamily = "Inter"
    next.spacing = 2
    let out = rebasedTheme(draft, previous: previous, next: next)
    XCTAssertEqual(out.colors["light"]?["primary"], "#222222", "changed here")
    XCTAssertEqual(out.colors["light"]?["divider"], "#cccccc", "untouched: the newer theme's")
    XCTAssertEqual(out.fontFamily, "Inter")
    XCTAssertEqual(out.spacing, 6)
    XCTAssertEqual(rebasedTheme(previous, previous: previous, next: next), next, "an untouched editor is the newer theme")
  }

  func testAnEntryKeepsItsTypedFieldsOverANewerCopy() {
    let before = EntryDraft(ContentEntry(FirestoreDocument(id: "e", data: ["title": "Spring menu", "excerpt": "Old", "tags": ["a"]])))
    var draft = before
    draft.title = "Spring menu 2026"
    let next = EntryDraft(ContentEntry(FirestoreDocument(id: "e", data: ["title": "Spring menu", "excerpt": "New", "tags": ["a", "b"]])))
    let out = draft.rebased(previous: before, next: next)
    XCTAssertEqual(out.title, "Spring menu 2026")
    XCTAssertEqual(out.excerpt, "New")
    XCTAssertEqual(out.tags, ["a", "b"])
  }
}
