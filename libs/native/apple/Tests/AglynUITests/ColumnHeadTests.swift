// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

#if os(macOS)
  import AppKit
  import SwiftUI
  import XCTest

  @testable import AglynUI

  /// An area's head in a list column on the Mac and iPad (Figma 13:483): a hub's own sections join it there, and an
  /// area's section chips never run past the column's edge.
  @MainActor
  final class ColumnHeadTests: XCTestCase {
    private enum Hub: String, CaseIterable, Identifiable, Hashable {
      case contacts, leads, companies
      var id: String { rawValue }
    }

    private func head(sections: [AglynAreaSection] = []) -> AglynAreaHead {
      AglynAreaHead(title: "CRM", crumbs: AnyView(EmptyView()), star: AnyView(EmptyView()), sections: sections)
    }

    private func section(_ id: String) -> AglynAreaSection {
      AglynAreaSection(id: id, label: id, selected: false) {}
    }

    func testAHubsSectionsJoinAHeadThatHasNone() {
      let joined = head().withSections([section("contacts"), section("leads")])
      XCTAssertEqual(joined.sections.map(\.id), ["contacts", "leads"])
      XCTAssertEqual(joined.title, "CRM")
    }

    func testTheShellsOwnSectionsAreKept() {
      let kept = head(sections: [section("submissions")]).withSections([section("contacts")])
      XCTAssertEqual(kept.sections.map(\.id), ["submissions"])
    }

    private final class Seen { var placed = false }

    private func placed<V: View>(_ view: V) -> Bool {
      let seen = Seen()
      let host = NSHostingView(
        rootView: view
          .environment(\.aglynWideChrome, true)
          .onPreferenceChange(AglynListColumnHeadPlacedKey.self) { seen.placed = $0 })
      host.frame = NSRect(x: 0, y: 0, width: 1200, height: 800)
      host.layoutSubtreeIfNeeded()
      RunLoop.main.run(until: Date().addingTimeInterval(0.2))
      return seen.placed
    }

    func testAHubsListBesideItsDetailTakesTheHead() {
      let hub = AglynSectionHub(Hub.allCases, selection: .constant(.contacts), label: \.rawValue, systemImage: { _ in "person" }) {
        AglynListDetailColumns { Text("List") } detail: { Text("Detail") }
      }
      XCTAssertTrue(placed(hub.environment(\.aglynColumnHeadOffer, head())))
    }

    func testAHubWithNoListColumnLeavesTheHeadToTheShell() {
      let hub = AglynSectionHub(Hub.allCases, selection: .constant(.contacts), label: \.rawValue, systemImage: { _ in "person" }) {
        Text("Overview")
      }
      XCTAssertFalse(placed(hub.environment(\.aglynColumnHeadOffer, head())))
    }

    func testAnEmptyListWithItsDetailFoldedLeavesTheHeadAndItsCrumbsToTheShell() {
      let folded = AglynListDetailColumns(showsDetail: false) { Text("No custom roles yet") } detail: { Text("Detail") }
      XCTAssertFalse(placed(folded.environment(\.aglynColumnHeadOffer, head())))
      let open = AglynListDetailColumns(showsDetail: true) { Text("List") } detail: { Text("Detail") }
      XCTAssertTrue(placed(open.environment(\.aglynColumnHeadOffer, head())))
    }

    private func height(_ sections: [AglynAreaSection], width: CGFloat) -> CGFloat {
      let host = NSHostingController(rootView: AglynAreaSectionChips(sections, inset: 24).environment(\.aglynWideChrome, true))
      return host.sizeThatFits(in: CGSize(width: width, height: 1000)).height
    }

    func testSectionChipsWrapRatherThanRunPastTheColumn() {
      let inbox = [
        AglynAreaSection(id: "submissions", label: "Submissions", selected: true) {},
        AglynAreaSection(id: "members", label: "Members & leads", selected: false) {},
        AglynAreaSection(id: "campaigns", label: "Campaigns", selected: false) {},
      ]
      // A narrow list column cannot hold all three on one row; a wide one can.
      XCTAssertGreaterThan(height(inbox, width: 300), height(inbox, width: 900) * 1.5)
    }

    private final class Chrome {
      var primary: String?
      var entries: [String] = []
    }

    /// The chrome that reaches the shell from `view`, on the Mac and iPad.
    private func chrome<V: View>(_ view: V) -> Chrome {
      let seen = Chrome()
      let host = NSHostingView(
        rootView: view
          .environment(\.aglynWideChrome, true)
          .backgroundPreferenceValue(AglynScreenChromeKey.self) { chrome in
            let _ = { seen.primary = chrome.primary?.id; seen.entries = chrome.entries.map(\.id) }()
            Color.clear
          })
      host.frame = NSRect(x: 0, y: 0, width: 900, height: 600)
      host.layoutSubtreeIfNeeded()
      RunLoop.main.run(until: Date().addingTimeInterval(0.2))
      return seen
    }

    private func funnels() -> some View {
      Text("Funnels list")
        .aglynPrimaryAction(id: "funnels-add", "New funnel", systemImage: "plus") {}
        .aglynScreenToolbar(id: "funnels") { Button("Create with AI") {} }
    }

    /// A screen shown as a section of Analytics' detail keeps New funnel and Create with AI in its own head; on its
    /// own, they go to the area's head as before (AGL-4058).
    func testASectionKeepsItsActionsOutOfTheAreasHead() {
      let alone = chrome(funnels())
      XCTAssertEqual(alone.primary, "funnels-add")
      XCTAssertEqual(alone.entries, ["funnels"])
      let section = chrome(funnels().aglynSectionHead("Funnels"))
      XCTAssertNil(section.primary)
      XCTAssertEqual(section.entries, [])
    }
  }
#endif
