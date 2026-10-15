// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynCommercePlugin

/// A product's images and paid delivery. The words and rules of paid media replay the console's own, from
/// `functionCases` in libs/native/contracts/function-cases.generated.json (the Kotlin plugin replays the same file).
final class ProductMediaTests: XCTestCase {
  private func cases(_ name: String) throws -> [JSONValue] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<7 { url.deleteLastPathComponent() }
    let file = url.appendingPathComponent("native/contracts/function-cases.generated.json")
    let all = try XCTUnwrap(JSONValue.decode(Data(contentsOf: file)))
    return try XCTUnwrap(all["functions"]?[name]?["cases"]?.arrayValue)
  }

  private func reference(_ json: JSONValue) -> PaidMediaReference {
    PaidMediaReference(
      kind: json["kind"]?.stringValue ?? "", id: json["id"]?.stringValue ?? "", name: json["name"]?.stringValue ?? "",
      hostID: json["hostId"]?.stringValue ?? "", collectionID: json["collectionId"]?.stringValue)
  }

  func testTheLibraryAMediaRouteIsAskedOfIsTheConsoles() throws {
    let all = try cases("paidMediaScopeBody")
    XCTAssertGreaterThan(all.count, 3)
    for item in all {
      let scope = try XCTUnwrap(item["args"]?.arrayValue?.first?.stringValue)
      var expected: [String: String] = [:]
      if case .object(let record)? = item["result"] { expected = record.mapValues { $0.stringValue ?? "" } }
      XCTAssertEqual(paidMediaScopeBody(scope), expected, scope)
    }
  }

  func testOnlyThePlacesBesideTheProductCount() throws {
    let all = try cases("usesBesideProduct")
    XCTAssertGreaterThan(all.count, 3)
    for item in all {
      let args = try XCTUnwrap(item["args"]?.arrayValue)
      let product = args[1]
      let kept = usesBesideProduct(
        (args[0].arrayValue ?? []).map(reference), hostID: product["hostId"]?.stringValue ?? "", productID: product["productId"]?.stringValue)
      XCTAssertEqual(kept, (item["result"]?.arrayValue ?? []).map(reference), "\(args)")
    }
  }

  func testWhatTheAuthorConfirmsIsTheConsolesSentence() throws {
    let all = try cases("paidMediaConfirmation")
    XCTAssertGreaterThan(all.count, 30)
    for item in all {
      let options = try XCTUnwrap(item["args"]?.arrayValue?.first)
      let checked: PaidMediaUsageCheck =
        switch options["checked"]?.stringValue {
        case "full": .full
        case "partial": .partial
        default: .failed
        }
      let kind: PaidMediaKind = options["kind"]?.stringValue == "download" ? .download : .video
      XCTAssertEqual(
        paidMediaConfirmation(others: (options["others"]?.arrayValue ?? []).map(reference), checked: checked, kind: kind),
        item["result"]?.stringValue, "\(options)")
    }
  }

  func testWhatAStoredFileNamesIsClassifiedByItsAddress() {
    XCTAssertEqual(paidMediaSource("media:host-1/abc"), .asset(scope: "host-1", mediaID: "abc"))
    XCTAssertEqual(paidMediaSource("media:org:acme:host-1/abc@pin1"), .asset(scope: "org:acme:host-1", mediaID: "abc"))
    XCTAssertEqual(paidMediaSource("/api/media/cdn/host-1/abc"), .asset(scope: "host-1", mediaID: "abc"))
    XCTAssertEqual(paidMediaSource("https://cdn.example.com/lesson.mp4"), .external)
    XCTAssertEqual(paidMediaSource("  "), .malformed)
    XCTAssertEqual(paidMediaSource("media:"), .malformed)
    XCTAssertEqual(paidMediaSource("ftp://files.example/a.zip"), .malformed)
  }

  func testAnAssetsDocumentLivesInItsLibrary() {
    XCTAssertEqual(paidMediaDocumentPath(scope: "host-1", mediaID: "abc"), ["hosts", "host-1", "media", "abc"])
    XCTAssertEqual(paidMediaDocumentPath(scope: "org:acme", mediaID: "abc"), ["orgs", "acme", "media", "abc"])
    XCTAssertEqual(paidMediaDocumentPath(scope: "org:acme:host-1", mediaID: "abc"), ["orgs", "acme", "media", "abc"])
  }

  // MARK: the lists

  private let stored: [String: Any] = [
    "name": "Course", "type": "digital", "slug": "course", "variants": [["id": "default", "priceUsd": 40]],
    "mediaUrls": ["media:host-1/one", "media:host-1/two"],
    "digitalFiles": [["url": "media:host-1/f1", "fileName": "workbook.pdf", "version": "2", "note": "kept"]],
    "gatedVideos": [["url": "media:host-1/v1", "title": "Lesson one"]],
    "downloadLimit": 3, "createdAt": Date(),
  ]

  private func product(_ edit: ProductMediaEdit) -> [String: JSONValue] {
    guard case .object(let record) = productMediaSaveJSON(stored, edit) else { return [:] }
    return record
  }

  func testTheListsReadFromTheStoredProduct() {
    let draft = ProductMediaDraft(storedProductJSON(stored))
    XCTAssertTrue(draft.isDigital)
    XCTAssertEqual(draft.images, ["media:host-1/one", "media:host-1/two"])
    XCTAssertEqual(draft.files, [DigitalFileEntry(id: 0, url: "media:host-1/f1", fileName: "workbook.pdf", version: "2")])
    XCTAssertEqual(draft.videos, [MembersVideoEntry(id: 0, url: "media:host-1/v1", title: "Lesson one")])
    XCTAssertEqual(draft.downloadLimit, 3)
    XCTAssertFalse(ProductMediaDraft(["type": "physical"]).isDigital)
    XCTAssertEqual(ProductMediaDraft([:]).images, [])
  }

  func testImagesAreAddedAtTheEndAndRemovedByPosition() {
    XCTAssertEqual(
      product(.addImages(["media:host-1/three", "media:host-1/four"]))["mediaUrls"]?.arrayValue?.compactMap(\.stringValue),
      ["media:host-1/one", "media:host-1/two", "media:host-1/three", "media:host-1/four"])
    XCTAssertEqual(product(.removeImage(0))["mediaUrls"]?.arrayValue?.compactMap(\.stringValue), ["media:host-1/two"])
    XCTAssertEqual(product(.removeImage(9))["mediaUrls"]?.arrayValue?.count, 2, "a position that is not there changes nothing")
  }

  func testAnEditSendsTheWholeStoredProductWithOnlyThatListChanged() {
    let sent = product(.removeVideo(0))
    XCTAssertEqual(sent["gatedVideos"], .array([]))
    XCTAssertEqual(sent["name"]?.stringValue, "Course")
    XCTAssertEqual(sent["slug"]?.stringValue, "course")
    XCTAssertEqual(sent["digitalFiles"]?.arrayValue?.count, 1)
    XCTAssertEqual(sent["downloadLimit"], .number(3))
    XCTAssertNil(sent["createdAt"], "a stored timestamp is left out; the route keeps its own")
  }

  func testAFileCarriesItsVersionAndKeepsWhatElseItHolds() {
    let versioned = product(.setVersion(0, "2026-10-14-and-some-more-text"))["digitalFiles"]?.arrayValue?.first
    XCTAssertEqual(versioned?["version"]?.stringValue, "2026-10-14-and-some-"  , "a version is cut to 20 characters")
    XCTAssertEqual(versioned?["note"]?.stringValue, "kept")
    XCTAssertEqual(versioned?["fileName"]?.stringValue, "workbook.pdf")
    let added = product(.addFile(url: "media:host-1/f2", fileName: "bonus.zip"))["digitalFiles"]?.arrayValue
    XCTAssertEqual(added?.count, 2)
    XCTAssertEqual(added?.last, .object(["url": "media:host-1/f2", "fileName": "bonus.zip"]))
    XCTAssertEqual(product(.removeFile(0))["digitalFiles"], .array([]))
  }

  func testAVideoIsAddedWithTheFilesNameAsItsTitle() {
    let added = product(.addVideo(url: "media:host-1/v2", title: "Lesson two.mp4"))["gatedVideos"]?.arrayValue
    XCTAssertEqual(added?.last, .object(["url": "media:host-1/v2", "title": "Lesson two.mp4"]))
  }

  func testTheDownloadLimitIsAtLeastOneAndBlankIsUnlimited() {
    XCTAssertEqual(product(.setDownloadLimit(5))["downloadLimit"], .number(5))
    XCTAssertEqual(product(.setDownloadLimit(0))["downloadLimit"], .number(1))
    XCTAssertNil(product(.setDownloadLimit(nil))["downloadLimit"])
    XCTAssertEqual(downloadLimitFromText(" 4 "), .some(4))
    XCTAssertEqual(downloadLimitFromText("2.6"), .some(3))
    XCTAssertEqual(downloadLimitFromText("0"), .some(1))
    XCTAssertEqual(downloadLimitFromText(""), .some(nil))
    XCTAssertNil(downloadLimitFromText("many"))
  }
}
