// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * THE CRM'S REPORTS (the Kotlin `CrmReports.kt`): the console's own
 * `pipelineTotals`, `leadFunnel` and `crmReportRange`, ported and replayed
 * against its answers, over the same scoped reads.
 */

struct StageTotal: Equatable {
  let stage: Stage
  var count = 0
  var amountCents: Int64 = 0
  var weightedCents: Int64 = 0
}

struct PipelineTotals: Equatable {
  var count = 0
  var amountCents: Int64 = 0
  var weightedCents: Int64 = 0
  var stages: [StageTotal] = []
  var unplacedCount = 0
  var unplacedCents: Int64 = 0
}

/// `pipelineTotals`: open deals only, by the pipeline's open stages, weighted by probability.
func pipelineTotals(_ deals: [[String: Any]], _ pipeline: Pipeline) -> PipelineTotals {
  let stages = pipeline.openStages.sorted { $0.order < $1.order }
  var totals = PipelineTotals(stages: stages.map { StageTotal(stage: $0) })
  for deal in deals {
    if (deal["status"] as? String ?? "open") != "open" { continue }
    let amount = max(0, Int64(((deal["amountCents"] as? NSNumber)?.doubleValue ?? 0).rounded()))
    totals.count += 1
    totals.amountCents += amount
    guard let index = stages.firstIndex(where: { $0.id == deal["stageId"] as? String }) else {
      totals.unplacedCount += 1
      totals.unplacedCents += amount
      continue
    }
    let own = (deal["probability"] as? NSNumber)?.doubleValue
    let probability = own.map { min(100, max(0, $0)) } ?? Double(min(100, max(0, stages[index].probability)))
    let weighted = Int64((Double(amount) * probability / 100).rounded())
    totals.stages[index].count += 1
    totals.stages[index].amountCents += amount
    totals.stages[index].weightedCents += weighted
    totals.weightedCents += weighted
  }
  return totals
}

struct LeadFunnel: Equatable {
  var total = 0
  var byStatus: [String: Int] = [:]
  var open = 0
  var reasons: [(label: String, count: Int)] = []

  static func == (a: LeadFunnel, b: LeadFunnel) -> Bool {
    a.total == b.total && a.byStatus == b.byStatus && a.open == b.open && a.reasons.map(\.label) == b.reasons.map(\.label)
      && a.reasons.map(\.count) == b.reasons.map(\.count)
  }
}

/// `leadFunnel`: every lead by status, and why the unqualified ones were closed.
func leadFunnel(_ leads: [[String: Any]]) -> LeadFunnel {
  var funnel = LeadFunnel(total: leads.count, byStatus: Dictionary(uniqueKeysWithValues: leadStatuses.map { ($0, 0) }))
  var reasons: [String: (label: String, count: Int)] = [:]
  var order: [String] = []
  for lead in leads {
    let raw = lead["status"] as? String ?? ""
    let status = leadStatuses.contains(raw) ? raw : "new"
    funnel.byStatus[status, default: 0] += 1
    guard status == "unqualified" else { continue }
    let label = (lead["unqualifiedReason"] as? String ?? "").split(whereSeparator: \.isWhitespace).joined(separator: " ")
    let key = label.isEmpty ? "$none" : label.lowercased()
    if reasons[key] == nil { order.append(key) }
    reasons[key] = (reasons[key]?.label ?? (label.isEmpty ? "No reason given" : label), (reasons[key]?.count ?? 0) + 1)
  }
  funnel.open = (funnel.byStatus["new"] ?? 0) + (funnel.byStatus["nurturing"] ?? 0) + (funnel.byStatus["working"] ?? 0)
  funnel.reasons = order.compactMap { reasons[$0] }.sorted {
    $0.count != $1.count ? $0.count > $1.count : $0.label.localizedCompare($1.label) == .orderedAscending
  }
  return funnel
}

/// `crmReportRange`: this month from the first of the local month; day periods count back from now.
func crmReportRangeStart(_ period: String, now: Date) -> Date {
  if period == "month" {
    return Calendar.current.date(from: Calendar.current.dateComponents([.year, .month], from: now)) ?? now
  }
  let days: Double = period == "7d" ? 7 : period == "30d" ? 30 : 90
  return now.addingTimeInterval(-days * 86_400)
}

private struct BarRow: View {
  let label: String
  let value: Int
  let max: Int
  var caption: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(label)
        Spacer()
        Text([String(value), caption].compactMap { $0 }.joined(separator: " · ")).monospacedDigit().foregroundStyle(.secondary)
      }
      ProgressView(value: Double(value), total: Double(Swift.max(max, 1))).tint(AglynColor.primary)
    }
    .accessibilityElement(children: .combine)
  }
}

struct ReportsSection: View {
  let context: NativePluginContext
  let scope: CrmScope
  let reference: CrmReference
  @State private var period = "30d"
  @State private var deals = LiveQueryList(pageSize: 500) { $0.data }
  @State private var leads = LiveQueryList(pageSize: 500) { $0.data }
  @State private var contacts = LiveQueryList(pageSize: 500) { $0.data }
  @State private var activity = LiveQueryList(pageSize: 1000) { $0.data }
  @State private var tasks = LiveQueryList(pageSize: 500, map: crmTask)

  var body: some View {
    let pipeline = reference.pipeline(nil)
    let now = Date()
    let from = crmReportRangeStart(period, now: now)
    Form {
      Section {
        Picker("Period", selection: $period) {
          ForEach(ContractValues.shared.nativeCrmReportPeriods, id: \.self) {
            Text(ContractValues.shared.crmReportPeriodLabels[$0] ?? $0).tag($0)
          }
        }
        .pickerStyle(.segmented)
      }
      Section("Pipeline · \(pipeline.name)") {
        if deals.ready {
          let totals = pipelineTotals(deals.rows, pipeline)
          LabeledContent("Open deals", value: "\(totals.count) · \(formatCents(totals.amountCents))")
          LabeledContent("Weighted", value: formatCents(totals.weightedCents))
          let most = totals.stages.map(\.count).max() ?? 0
          ForEach(totals.stages, id: \.stage.id) { BarRow(label: $0.stage.name, value: $0.count, max: most, caption: formatCents($0.amountCents)) }
        } else {
          SkeletonRows(count: 3)
        }
      }
      Section("Deals closed") {
        let closed = deals.rows.filter { (millis($0["closedAtMs"]) ?? 0) >= Int64(from.timeIntervalSince1970 * 1000) }
        let won = closed.filter { $0["status"] as? String == "won" }
        let lost = closed.filter { $0["status"] as? String == "lost" }
        let sum = { (rows: [[String: Any]]) in rows.reduce(Int64(0)) { $0 + (($1["amountCents"] as? NSNumber)?.int64Value ?? 0) } }
        LabeledContent("Won", value: "\(won.count) · \(formatCents(sum(won)))")
        LabeledContent("Lost", value: "\(lost.count) · \(formatCents(sum(lost)))")
        LabeledContent("Win rate", value: closed.isEmpty ? "—" : "\(won.count * 100 / closed.count)%")
      }
      Section("Lead funnel") {
        let funnel = leadFunnel(leads.rows)
        LabeledContent("Leads", value: "\(funnel.total)")
        LabeledContent("Open", value: "\(funnel.open)")
        let most = funnel.byStatus.values.max() ?? 0
        ForEach(leadStatuses, id: \.self) { BarRow(label: leadStatusLabel($0), value: funnel.byStatus[$0] ?? 0, max: most) }
        ForEach(funnel.reasons.prefix(5), id: \.label) { LabeledContent($0.label, value: "\($0.count)") }
        let sources = Dictionary(grouping: leads.rows) { ($0["leadSource"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "No lead source" }
          .mapValues(\.count).sorted { $0.value > $1.value }
        ForEach(sources.prefix(8), id: \.key) { BarRow(label: $0.key, value: $0.value, max: sources.first?.value ?? 0) }
      }
      Section("Contacts by stage") {
        let stages = contacts.rows.map { contactView($0, groupID: scope.groupID)["lifecycleStage"] as? String }
        let counts = lifecycleStages.map { stage in (stageLabel(stage) ?? stage, stages.filter { $0 == stage }.count) }
          + [("No stage", stages.filter { $0 == nil }.count)]
        let most = counts.map(\.1).max() ?? 0
        LabeledContent("Contacts", value: "\(contacts.rows.count)")
        ForEach(counts.filter { $0.1 > 0 }, id: \.0) { BarRow(label: $0.0, value: $0.1, max: most) }
      }
      Section("Activity") {
        let kinds = Dictionary(grouping: activity.rows) { $0["kind"] as? String ?? "other" }.mapValues(\.count)
        LabeledContent("Logged", value: "\(activity.rows.count)")
        ForEach(ContractValues.shared.nativeCrmActivityKinds, id: \.self) {
          BarRow(label: ContractValues.shared.crmActivityKindLabels[$0] ?? $0, value: kinds[$0] ?? 0, max: kinds.values.max() ?? 0)
        }
      }
      Section("Tasks") {
        let today = startOfLocalDay(Int64(now.timeIntervalSince1970 * 1000))
        LabeledContent("Open", value: "\(tasks.rows.count)")
        LabeledContent("Overdue", value: "\(tasks.rows.filter { ($0.dueAtMs ?? .max) < today }.count)")
        LabeledContent("Due today", value: "\(tasks.rows.filter { ($0.dueAtMs ?? -1) >= today && ($0.dueAtMs ?? .max) < today + 86_400_000 }.count)")
        LabeledContent("Unassigned", value: "\(tasks.rows.filter { $0.assigneeUID == nil }.count)")
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .accessibilityIdentifier("crm-reports")
    .task(id: scope.readTokens) {
      let reader = context.firestore
      deals.show(reader) { _ in scopedQuery(scope, "deals", limit: 500) }
      leads.show(reader) { _ in scopedQuery(scope, "leads", limit: 500) }
      contacts.show(reader) { _ in scopedQuery(scope, "contacts", limit: 500) }
      tasks.show(reader) { _ in scopedQuery(scope, "crmTasks", filters: [ListQueryConstraint(path: "status", op: .equal, value: "open")], limit: 500) }
    }
    .task(id: period) {
      let since = Int64(crmReportRangeStart(period, now: Date()).timeIntervalSince1970 * 1000)
      activity.show(context.firestore) { _ in
        scopedQuery(
          scope, "crmActivities", filters: [ListQueryConstraint(path: "atMs", op: .greaterThanOrEqual, value: since)],
          order: [.init("atMs", descending: true)], limit: 1000)
      }
    }
    .onDisappear {
      for stop in [deals.stop, leads.stop, contacts.stop, activity.stop, tasks.stop] { stop() }
    }
  }
}
