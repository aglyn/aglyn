// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import XCTest

@testable import AglynSite

/// The media file browser's pure parts (AGL-4004): what a tile says a file is, which preview it asks the CDN for,
/// the subfolders a view reads, the keyboard's walk through the grid, and what a click selects.
final class MediaBrowserTests: XCTestCase {
  private func item(_ fields: [String: Any]) -> MediaItem {
    MediaItem(FirestoreDocument(id: "m1", data: fields))!
  }

  func testTheTypeLabelIsTheConsolesMap() {
    XCTAssertEqual(mediaFileType("application/pdf").label, "PDF")
    XCTAssertEqual(
      mediaFileType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").label, "XLSX")
    XCTAssertEqual(mediaFileType("text/csv; charset=utf-8").label, "CSV")
    XCTAssertEqual(mediaFileType("audio/mpeg").label, "MP3")
    XCTAssertEqual(mediaFileType("image/svg+xml").label, "SVG")
    XCTAssertEqual(mediaFileType("image/jpeg").label, "JPEG")
    XCTAssertEqual(mediaFileType("video/mp4").symbol, "film")
    XCTAssertEqual(mediaFileType("").label, "FILE")
    XCTAssertEqual(mediaFileType("application/x-unknown").symbol, "doc")
  }

  func testTheCaptionIsTypeAndSize() {
    let pdf = item(["fileName": "menu.pdf", "contentType": "application/pdf", "kind": "pdf", "sizeBytes": 1_310_720])
    XCTAssertEqual(pdf.caption, "PDF · 1.2 MB")
  }

  func testAnSVGAsksForTheIconPNGNotAWidthVariant() {
    let svg = item(["contentType": "image/svg+xml", "kind": "image", "cdnPath": "/api/media/cdn/h/m1"])
    XCTAssertEqual(svg.thumbnail(origin: "https://app.test/", width: 320), "https://app.test/api/media/cdn/h/m1?icon=png-384")
    XCTAssertEqual(mediaIconSize(atLeast: 640), 512)
    let png = item(["contentType": "image/png", "kind": "image", "cdnPath": "/api/media/cdn/h/m1"])
    XCTAssertEqual(png.thumbnail(origin: "https://app.test", width: 320), "https://app.test/api/media/cdn/h/m1?w=320")
  }

  func testAFilmShowsItsPosterOnlyWhenItHasOne() {
    let bare = item(["contentType": "video/mp4", "kind": "video", "cdnPath": "/api/media/cdn/h/m1"])
    XCTAssertNil(bare.thumbnail(origin: "https://app.test"))
    let posted = item([
      "contentType": "video/mp4", "kind": "video", "cdnPath": "/api/media/cdn/h/m1", "poster": ["path": "p.jpg"],
    ])
    XCTAssertEqual(posted.thumbnail(origin: "https://app.test"), "https://app.test/api/media/cdn/h/m1?poster=1&w=320")
  }

  func testIncludeSubfoldersReadsTheSubtreeUntilItPassesThirty() {
    let folders = [
      MediaFolder(id: "a", name: "A", parentID: nil, order: nil),
      MediaFolder(id: "b", name: "B", parentID: "a", order: nil),
      MediaFolder(id: "c", name: "C", parentID: "b", order: nil),
      MediaFolder(id: "d", name: "D", parentID: nil, order: nil),
    ]
    let subtree = mediaFolderSubtree("a", folders: folders)
    XCTAssertEqual(subtree, ["a", "b", "c"])
    XCTAssertEqual(mediaFolderIDs(.one("a"), subtree: subtree, scopeTokens: nil).ids, ["a", "b", "c"])
    // Two scope tokens times sixteen folders passes Firestore's thirty disjunctions: only the open folder is read.
    let wide = ["a"] + (1...15).map { "s\($0)" }
    let dropped = mediaFolderIDs(.one("a"), subtree: wide, scopeTokens: ["org", "host:h"])
    XCTAssertEqual(dropped.ids, ["a"])
    XCTAssertTrue(dropped.dropped)
    let request = mediaRequest(folder: .one("a"), scopeTokens: nil, type: nil, sort: .newest, search: "", subtree: subtree)
    XCTAssertEqual(request.base?.first?.op, .in)
  }

  func testArrowsWalkTheGridByRowAndColumn() {
    let ids = ["f:1", "a", "b", "c", "d", "e"]
    XCTAssertEqual(mediaGridStep(ids, from: nil, columns: 3, move: .down), "f:1")
    XCTAssertEqual(mediaGridStep(ids, from: "a", columns: 3, move: .right), "b")
    XCTAssertEqual(mediaGridStep(ids, from: "a", columns: 3, move: .down), "d")
    XCTAssertEqual(mediaGridStep(ids, from: "b", columns: 3, move: .up), nil)
    XCTAssertEqual(mediaGridStep(ids, from: "e", columns: 3, move: .right), nil)
  }

  func testAClickSelectsTogglesOrExtendsTheRun() {
    let order = ["a", "b", "c", "d"]
    XCTAssertEqual(mediaSelection(["a"], anchor: "a", clicked: "c", toggle: false, range: false, order: order), ["c"])
    XCTAssertEqual(mediaSelection(["a"], anchor: "a", clicked: "c", toggle: true, range: false, order: order), ["a", "c"])
    XCTAssertEqual(mediaSelection(["a", "c"], anchor: "a", clicked: "c", toggle: true, range: false, order: order), ["a"])
    XCTAssertEqual(mediaSelection(["a"], anchor: "a", clicked: "c", toggle: false, range: true, order: order), ["a", "b", "c"])
  }

  func testABulkDeleteNamesWhatItDeleted() {
    XCTAssertEqual(mediaDeletedMessage(["a.jpg"]), "Deleted \"a.jpg\"")
    XCTAssertEqual(mediaDeletedMessage(["a", "b"]), "Deleted 2 files: \"a\" and \"b\"")
    XCTAssertEqual(mediaDeletedMessage(["a", "b", "c", "d", "e"]), "Deleted 5 files: \"a\", \"b\", \"c\" and 2 more")
    XCTAssertEqual(mediaRestoredMessage(["a", "b", "c"]), "Restored 3 files: \"a\", \"b\" and \"c\"")
  }
}
