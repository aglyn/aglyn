// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

/// A view that loads in `.task` and draws only once loaded must not wrap itself in a `Group`. A `Group` hands its
/// modifiers to its children, so while the `if` inside draws nothing the task has no view to run on, the read never
/// starts and the view never draws: Inbox's unread count and its Needs you line stayed empty that way (AGL-3945).
/// A stack is always there, so its task runs. Read from the checkout, as `AppConfigTests` does.
final class GroupTaskTests: XCTestCase {
  /// Where the `if` does not wait on the task: Setup's site screens draw for a picked site, and the task only binds it.
  private let allowed: Set<String> = [
    "libs/native/apple/Sources/AglynSite/SetupScreens.swift"
  ]

  func testNoViewLoadsInATaskOnAGroupThatDrawsNothingUntilLoaded() throws {
    let repo = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // AglynCoreTests
      .deletingLastPathComponent()  // Tests
      .deletingLastPathComponent()  // apple
      .deletingLastPathComponent()  // native
      .deletingLastPathComponent()  // libs
      .deletingLastPathComponent()  // repo
      // The umbrella test package reaches the checkout through a symlink, and the enumerator hands back resolved paths.
      .resolvingSymlinksInPath()
    let roots = ["libs/native/apple/Sources", "libs/plugins", "apps/ios"]
    var found: [String] = []
    for root in roots {
      guard let walker = FileManager.default.enumerator(at: repo.appendingPathComponent(root), includingPropertiesForKeys: nil)
      else { continue }
      for case let file as URL in walker {
        if [".build", "build", "node_modules", "Tests", "AglynUITests", "AglynTests"].contains(file.lastPathComponent) {
          walker.skipDescendants()
          continue
        }
        let relative = String(file.resolvingSymlinksInPath().path.dropFirst(repo.path.count + 1))
        guard file.pathExtension == "swift", !allowed.contains(relative) else { continue }
        let lines = try String(contentsOf: file, encoding: .utf8).components(separatedBy: "\n")
        for (index, line) in lines.enumerated() where line.trimmingCharacters(in: .whitespaces) == "Group {" {
          if let problem = Self.loadsOnAnEmptyGroup(lines, at: index) { found.append("\(relative):\(index + 1) \(problem)") }
        }
      }
    }
    XCTAssertEqual(found, [], "Use VStack(spacing: 0) so the task runs while nothing is drawn")
  }

  /// `Group {` whose first line is an `if` with no `else`, closed and followed by `.task` or `.onAppear`.
  static func loadsOnAnEmptyGroup(_ lines: [String], at start: Int) -> String? {
    let indent = String(lines[start].prefix { $0 == " " })
    var first = start + 1
    while first < lines.count, lines[first].trimmingCharacters(in: .whitespaces).isEmpty { first += 1 }
    guard first < lines.count, lines[first].trimmingCharacters(in: .whitespaces).hasPrefix("if ") else { return nil }
    var close = first
    while close < lines.count, !(lines[close].hasPrefix(indent + "}") && lines[close].trimmingCharacters(in: .whitespaces) == "}") {
      close += 1
    }
    guard close < lines.count else { return nil }
    let elseAtTop = lines[(start + 1)..<close].contains { $0.hasPrefix(indent + "  } else") }
    if elseAtTop { return nil }
    var next = close + 1
    while next < lines.count, lines[next].trimmingCharacters(in: .whitespaces).hasPrefix(".") {
      let modifier = lines[next].trimmingCharacters(in: .whitespaces)
      if modifier.hasPrefix(".task") || modifier.hasPrefix(".onAppear") { return modifier.components(separatedBy: "(")[0] }
      next += 1
    }
    return nil
  }
}
