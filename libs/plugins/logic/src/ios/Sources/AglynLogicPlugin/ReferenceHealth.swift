// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// How much of each collection the audit judges against: one number so every window agrees.
let referenceCeiling = 100

/// Reference health: every automation, workflow and computed-variable reference cross-checked against what still exists,
/// so broken wiring surfaces here instead of failing silently on a visitor's pageview. The Kotlin plugin's ReferenceHealth.kt.
struct ReferenceHealthView: View {
  let context: NativePluginContext
  @State private var actions = LiveQuery()
  @State private var workflows = LiveQuery()
  @State private var variables = LiveQuery()
  @State private var functions = LiveQuery()
  @State private var overlays = LiveQuery()
  @State private var webhooks = LiveQuery()
  @State private var screens = LiveQuery()
  @State private var datasets = LiveQuery()
  @State private var campaigns = LiveQuery()
  @State private var lists = LiveQuery()

  private func window(_ query: LiveQuery) -> (rows: [FirestoreDocument], truncated: Bool)? {
    query.state.value.map { (Array($0.prefix(referenceCeiling)), $0.count > referenceCeiling) }
  }

  var body: some View {
    let core = [actions, workflows, variables, functions, overlays, webhooks, screens].map(window)
    Group {
      if core.contains(where: { $0 == nil }) {
        List { SkeletonRows(count: 4) }.aglynListBackground()
      } else {
        report(core.compactMap { $0 })
      }
    }
    .task(id: "\(context.hostID ?? "")-\(context.orgID ?? "")") { start() }
    .onDisappear { [actions, workflows, variables, functions, overlays, webhooks, screens, datasets, campaigns, lists].forEach { $0.stop() } }
  }

  private func start() {
    guard let hostID = context.hostID else { return }
    func host(_ name: String) -> FirestoreQuery { ceilingQuery(["hosts", hostID, name], limit: referenceCeiling) }
    let reader = context.firestore
    actions.start(reader, host("actions"))
    workflows.start(reader, host("workflows"))
    variables.start(reader, host("variables"))
    functions.start(reader, host("functions"))
    overlays.start(reader, host("overlays"))
    webhooks.start(reader, host("webhooks"))
    screens.start(reader, host("screens"))
    if let orgID = context.orgID {
      let shared = [ListQueryConstraint(path: "visibleTo", op: .arrayContainsAny, value: [OrgAccess.orgScopeToken, OrgAccess.hostScopeToken(hostID)])]
      datasets.start(reader, ceilingQuery(["orgs", orgID, "datasets"], filters: shared, limit: referenceCeiling))
      campaigns.start(reader, ceilingQuery(["orgs", orgID, "emailCampaigns"], filters: shared, limit: referenceCeiling))
      lists.start(reader, ceilingQuery(["orgs", orgID, "lists"], limit: referenceCeiling))
    }
  }

  @ViewBuilder
  private func report(_ core: [(rows: [FirestoreDocument], truncated: Bool)]) -> some View {
    let optional = [datasets, campaigns, lists].map(window)
    let truncated = core.contains { $0.truncated } || optional.contains { $0?.truncated == true }
    let issues = auditHostReferences(
      actions: core[0].rows.filter(\.alive), workflows: core[1].rows.filter(\.alive), variables: core[2].rows.filter(\.alive),
      known: KnownTargets(
        workflows: knownSet(core[1].rows), functions: knownSet(core[3].rows),
        datasets: optional[0].map { knownSet($0.rows, nameKey: "displayName").union(knownSet($0.rows)) },
        lists: optional[2].map { knownSet($0.rows) }, campaigns: optional[1].map { knownSet($0.rows) },
        overlays: knownSet(core[4].rows), webhooks: knownSet(core[5].rows), screens: knownSet(core[6].rows, nameKey: "displayName")))
    List {
      if truncated {
        AglynNotice(
          "Audited against the first \(referenceCeiling) rows of each collection, ordered by id. At least one of them holds more, so a step pointing past that window is listed here as broken when it is not, and a step held past it is not checked at all.",
          tone: .info)
      }
      if issues.isEmpty {
        AglynNotice(truncated ? "Every reference the audit read resolves." : "Every automation, workflow, and variable reference resolves.", tone: .success)
          .accessibilityIdentifier("health-ok")
      } else {
        AglynNotice("\(issues.count) broken reference\(issues.count == 1 ? "" : "s") — these steps do nothing until re-pointed or removed.", tone: .warning)
          .accessibilityIdentifier("health-broken")
        ForEach(issues) { issue in
          AglynRow(issue.sourceName, subtitle: "\(issue.source) → missing \(issue.refType) \(issue.missing.isEmpty ? "(empty)" : issue.missing)", systemImage: "link.badge.plus")
        }
      }
    }
    .aglynListBackground()
    .accessibilityIdentifier("reference-health")
  }
}
