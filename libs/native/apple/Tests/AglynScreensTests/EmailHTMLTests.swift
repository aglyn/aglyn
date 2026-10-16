// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynScreens

/// The staff apps' message viewer, replayed over libs/native/screens/email-html-cases.json (the Kotlin viewer replays
/// the same file): real mail from the console's renderer, and hostile and malformed messages.
@MainActor
final class EmailHTMLTests: XCTestCase {
  struct Case {
    let name: String
    let html: String
    let text: [String]
    let links: [String]
    let absent: [String]
  }

  static func cases() throws -> [Case] {
    let url = ScreenSpecTests.screensDir.appendingPathComponent("email-html-cases.json")
    let file = try XCTUnwrap(JSONValue.decode(try Data(contentsOf: url)))
    return file["cases"].array.map { entry in
      Case(
        name: ScreenValues.text(entry["name"] ?? .null), html: ScreenValues.text(entry["html"] ?? .null),
        text: entry["text"].array.map { ScreenValues.text($0) }, links: entry["links"].array.map { ScreenValues.text($0) },
        absent: entry["absent"].array.map { ScreenValues.text($0) })
    }
  }

  /// The words of the result, with the white space the importer puts between blocks folded to single spaces.
  private func words(_ text: AttributedString) -> String {
    String(text.characters).split(whereSeparator: \.isWhitespace).joined(separator: " ")
  }

  /// An address as the importer hands it back: percent-encoded, with the root path a bare host leaves out.
  private func normalized(_ address: String) -> String {
    guard var parts = URLComponents(string: address) else { return address }
    if parts.host != nil, parts.path.isEmpty { parts.path = "/" }
    return parts.string ?? address
  }

  private func links(_ text: AttributedString) -> [String] {
    text.runs.compactMap { $0.link?.absoluteString }
  }

  func testEveryCaseReadsItsWordsInOrderAndOpensOnlyItsLinks() throws {
    let all = try Self.cases()
    XCTAssertGreaterThanOrEqual(all.count, 12)
    for entry in all {
      let shown = EmailHTML.attributed(entry.html)
      let read = words(shown)
      var from = read.startIndex
      for expected in entry.text {
        let folded = expected.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard let found = read.range(of: folded, range: from..<read.endIndex) else {
          return XCTFail("\(entry.name): \"\(folded)\" is not read in order in: \(read)")
        }
        from = found.upperBound
      }
      XCTAssertEqual(Set(links(shown).map(normalized)), Set(entry.links.map(normalized)), entry.name)
      let clean = EmailHTML.sanitize(entry.html).lowercased()
      for banned in entry.absent {
        XCTAssertFalse(clean.contains(banned.lowercased()), "\(entry.name): cleaned HTML still holds \(banned)")
        XCTAssertFalse(read.lowercased().contains(banned.lowercased()), "\(entry.name): the text still holds \(banned)")
      }
    }
  }

  func testLinksKeepOnlyWhatMayBeOpened() {
    XCTAssertEqual(EmailHTML.openableAddress("https://example.com/a"), "https://example.com/a")
    XCTAssertEqual(EmailHTML.openableAddress(" mailto:a@b.co "), "mailto:a@b.co")
    XCTAssertNil(EmailHTML.openableAddress("javascript:alert(1)"))
    XCTAssertNil(EmailHTML.openableAddress("java&#115;cript:alert(1)"))
    XCTAssertNil(EmailHTML.openableAddress("jav&#x61;script&colon;alert(1)"))
    XCTAssertNil(EmailHTML.openableAddress("\tjava\nscript:alert(1)"))
    XCTAssertNil(EmailHTML.openableAddress("data:text/html;base64,AAAA"))
    XCTAssertNil(EmailHTML.openableAddress("/relative"))
    XCTAssertTrue(EmailHTML.isOpenable(URL(string: "tel:+15125550100")!))
    XCTAssertFalse(EmailHTML.isOpenable(URL(string: "file:///etc/passwd")!))
  }

  func testEmphasisSurvivesAsStyledText() {
    let shown = EmailHTML.attributed("<p>Total <b>$12.00</b> for <i>one month</i>.</p>")
    let styled = shown.runs.map { (String(shown[$0.range].characters), $0.inlinePresentationIntent) }
    XCTAssertTrue(styled.contains { $0.0 == "$12.00" && $0.1?.contains(.stronglyEmphasized) == true })
    XCTAssertTrue(styled.contains { $0.0 == "one month" && $0.1?.contains(.emphasized) == true })
  }

  func testAnEmptyMessageIsNothingToShow() {
    XCTAssertEqual(String(EmailHTML.attributed("").characters), "")
    XCTAssertEqual(String(EmailHTML.attributed("<script>x()</script>").characters), "")
  }
}
