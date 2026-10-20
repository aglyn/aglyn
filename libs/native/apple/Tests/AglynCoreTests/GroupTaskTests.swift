// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

/// A view that loads in `.task` and draws only once loaded must not wrap itself in a `Group`. A `Group` hands its
/// modifiers to its children, so while the `if` inside draws nothing the task has no view to run on, the read never
/// starts and the view never draws: Inbox's unread count and its Needs you line stayed empty that way (AGL-3945), and so
/// did a spec screen's zone row with a `showWhen` (AGL-3966). A stack is always there, so its task runs. Read from the
/// checkout, as `AppConfigTests` does.
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
        for (index, line) in lines.enumerated() where Self.opensAGroup(line) {
          if let problem = Self.loadsOnAnEmptyGroup(lines, at: index) { found.append("\(relative):\(index + 1) \(problem)") }
        }
      }
    }
    XCTAssertEqual(found, [], "Use VStack(spacing: 0) so the task runs while nothing is drawn")
  }

  /// The shapes the sweep must catch, and the ones it must leave alone. The first is the zone row as it was before
  /// d4aab9d348: a List row that drew nothing until its own `showWhen` read was in, with the read in the Group's task.
  func testTheDetectorCatchesEveryShapeOfTheTrap() {
    let zoneRowBefore = """
        Group {
          if shown {
            Button {
              open(params)
            } label: {
              AglynRow(spec.label, subtitle: spec.subtitle, systemImage: spec.icon)
            }
            .buttonStyle(.aglynRow)
            .accessibilityIdentifier("zone-\\(spec.id)")
          }
        }
        .task(id: params.sorted { $0.key < $1.key }.map { "\\($0.key)=\\($0.value)" }) {
          await model.load()
        }
      """
    XCTAssertEqual(Self.detect(zoneRowBefore), ".task")

    // A comment between the Group and its `if`.
    XCTAssertEqual(
      Self.detect(
        """
          Group {
            // Only once the plan is read.
            if let access = model.access {
              Card(access)
            }
          }
          .onAppear { model.start() }
        """), ".onAppear")

    // A modifier that runs over several lines before the task.
    XCTAssertEqual(
      Self.detect(
        """
          Group {
            if model.ready {
              Card()
            }
          }
          .frame(
            maxWidth: .infinity,
            alignment: .leading)
          .task { await model.load() }
        """), ".task")

    // A chain of `else if`s with no last `else` can still draw nothing, so it is the same trap.
    XCTAssertEqual(
      Self.detect(
        """
          Group{
            if let access = model.access, !access.carried {
              Locked(access)
            } else if model.access?.carried == true, model.hasProducts {
              Glance()
            }
          }
          .task(id: hostID) { model.start() }
        """), ".task")

    // A last `else` always draws something, so its task runs.
    XCTAssertNil(
      Self.detect(
        """
          Group {
            if !model.ready {
              Skeleton()
            } else if let form = model.form {
              Detail(form)
            } else {
              Gone()
            }
          }
          .task { model.start() }
        """))

    // A stack is always there.
    XCTAssertNil(
      Self.detect(
        """
          VStack(spacing: 0) {
            if shown {
              Row()
            }
          }
          .task { await model.load() }
        """))

    // A Group that draws something first is not empty.
    XCTAssertNil(
      Self.detect(
        """
          Group {
            Header()
            if shown {
              Row()
            }
          }
          .task { await model.load() }
        """))

    // A Group with no task waits on nothing.
    XCTAssertNil(
      Self.detect(
        """
          Group {
            if shown {
              Row()
            }
          }
          .padding()
        """))
  }

  private static func detect(_ source: String) -> String? {
    let lines = source.components(separatedBy: "\n")
    guard let start = lines.firstIndex(where: opensAGroup) else { return nil }
    return loadsOnAnEmptyGroup(lines, at: start)
  }

  static func opensAGroup(_ line: String) -> Bool {
    let code = line.trimmingCharacters(in: .whitespaces)
    return code == "Group {" || code == "Group{"
  }

  private static func isBlankOrComment(_ line: String) -> Bool {
    let code = line.trimmingCharacters(in: .whitespaces)
    return code.isEmpty || code.hasPrefix("//")
  }

  /// How many more brackets a line opens than it closes.
  private static func depth(_ line: String) -> Int {
    line.reduce(0) { total, character in
      switch character {
      case "(", "{", "[": total + 1
      case ")", "}", "]": total - 1
      default: total
      }
    }
  }

  /// `Group {` whose first line of code is an `if` without a last plain `else`, closed and followed by `.task` or
  /// `.onAppear`, across blank lines, comments and modifiers that run over several lines.
  static func loadsOnAnEmptyGroup(_ lines: [String], at start: Int) -> String? {
    let indent = String(lines[start].prefix { $0 == " " })
    var first = start + 1
    while first < lines.count, isBlankOrComment(lines[first]) { first += 1 }
    guard first < lines.count, lines[first].trimmingCharacters(in: .whitespaces).hasPrefix("if ") else { return nil }
    let branchIndent = String(lines[first].prefix { $0 == " " })
    var close = first
    while close < lines.count, !(lines[close].hasPrefix(indent + "}") && lines[close].trimmingCharacters(in: .whitespaces) == "}") {
      close += 1
    }
    guard close < lines.count else { return nil }
    let body = lines[(first + 1)..<close]
    // Anything drawn after the `if` closes means the Group is never empty.
    if let end = body.lastIndex(where: { $0.hasPrefix(branchIndent + "}") }),
      body[(end + 1)...].contains(where: { !isBlankOrComment($0) })
    {
      return nil
    }
    let lastElse = body.contains { $0.hasPrefix(branchIndent + "} else {") }
    if lastElse { return nil }
    var next = close + 1
    var open = 0
    while next < lines.count {
      let line = lines[next]
      let code = line.trimmingCharacters(in: .whitespaces)
      defer { next += 1 }
      if open > 0 {
        open += depth(line)
        continue
      }
      if isBlankOrComment(line) { continue }
      guard code.hasPrefix(".") else { return nil }
      if code.hasPrefix(".task") || code.hasPrefix(".onAppear") { return code.components(separatedBy: "(")[0].components(separatedBy: " ")[0] }
      open += depth(line)
    }
    return nil
  }
}
