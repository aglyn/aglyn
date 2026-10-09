// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The board's columns: every stage of the pipeline in order, its deals, and the stage's total.
func boardColumns(_ pipeline: Pipeline, _ deals: [CrmRow]) -> [BoardColumn<CrmRow>] {
  pipeline.stages.map { stage in
    let inStage = deals.filter { deal in
      let status = deal.data["status"] as? String ?? "open"
      switch stage.kind {
      case "won": return status == "won"
      case "lost": return status == "lost"
      default: return status == "open" && deal.data["stageId"] as? String == stage.id
      }
    }
    let total = inStage.reduce(Int64(0)) { $0 + ((($1.data["amountCents"]) as? NSNumber)?.int64Value ?? 0) }
    return BoardColumn(id: stage.id, title: stage.name, caption: inStage.isEmpty ? nil : formatCents(total), items: inStage)
  }
}

/// Deals: the pipeline as a board (the default in a wide window) or the list beside the picked deal.
struct DealsSection: View {
  let context: NativePluginContext
  let scope: CrmScope
  let api: CrmAPI
  let reference: CrmReference
  var initial: String?
  @State private var board: Bool?

  var body: some View {
    WideLayoutReader { wide in
      let showBoard = board ?? (wide && initial == nil)
      VStack(spacing: 0) {
        Picker("View", selection: Binding(get: { showBoard }, set: { board = $0 })) {
          Label("Pipeline", systemImage: "rectangle.split.3x1").tag(true)
          Label("List", systemImage: "list.bullet").tag(false)
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, AglynSpace.two)
        .accessibilityIdentifier("deals-view")
        if showBoard {
          DealsBoard(context: context, scope: scope, api: api, reference: reference)
        } else {
          RecordsSection(context: context, kind: .deal, scope: scope, api: api, reference: reference, initial: initial)
        }
      }
    }
  }
}

struct DealsBoard: View {
  let context: NativePluginContext
  let scope: CrmScope
  let api: CrmAPI
  let reference: CrmReference
  @State private var pipelineID = ""
  @State private var list: LiveQueryList<CrmRow>?
  @State private var error: String?

  var body: some View {
    let pipeline = reference.pipeline(pipelineID.isEmpty ? nil : pipelineID)
    VStack(spacing: 0) {
      if reference.activePipelines.count > 1 {
        Picker("Pipeline", selection: $pipelineID) { ForEach(reference.activePipelines) { Text($0.name).tag($0.id) } }
          .padding(.horizontal, AglynSpace.two)
      }
      if let error { AglynNotice(error, tone: .error) { self.error = nil }.padding(.horizontal, AglynSpace.two) }
      if let list, list.ready {
        if list.rows.isEmpty {
          AglynEmptyState("No deals in \(pipeline.name) yet", systemImage: "dollarsign.circle", message: "Add a deal from the list, or convert a lead with one.")
        } else {
          AglynBoard(columns: boardColumns(pipeline, list.rows), emptyColumn: "No deals") { column, deal in
            DealCard(deal: deal, pipeline: pipeline, columnID: column.id, canMove: scope.canWrite) {
              context.navigate(CrmKind.deal.detailScreen, ["deal": deal.id])
            } onMove: { stageID in
              move(deal, to: stageID, in: pipeline)
            }
          }
          .accessibilityIdentifier("board")
        }
      } else if list?.failure != nil {
        AglynEmptyState("Could not load the pipeline", systemImage: "exclamationmark.triangle")
      } else {
        List { SkeletonRows(count: 6) }.aglynListBackground()
      }
    }
    .task(id: pipeline.id) {
      let model = list ?? LiveQueryList(pageSize: 300) { crmRow(.deal, $0, scope) }
      list = model
      model.show(context.firestore) {
        scopedQuery(
          scope, "deals", filters: [ListQueryConstraint(path: "pipelineId", op: .equal, value: pipeline.id)],
          order: [.init("updatedAt", descending: true)], limit: $0)
      }
    }
    .onDisappear { list?.stop() }
  }

  private func move(_ deal: CrmRow, to stageID: String, in pipeline: Pipeline) {
    error = nil
    Task {
      do {
        let target = pipeline.stages.first { $0.id == stageID }
        switch target?.kind {
        case "won": try await api.closeDeal(deal.id, won: true)
        case "lost": try await api.closeDeal(deal.id, won: false)
        default: try await api.moveDeal(deal.id, stageID: stageID)
        }
      } catch {
        self.error = problemText(error)
      }
    }
  }
}

private struct DealCard: View {
  let deal: CrmRow
  let pipeline: Pipeline
  let columnID: String
  let canMove: Bool
  let onOpen: () -> Void
  let onMove: (String) -> Void

  var body: some View {
    Button(action: onOpen) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 2) {
          Text(deal.title).font(AglynFont.strongSubheadline).lineLimit(2).multilineTextAlignment(.leading)
          if let cents = (deal.data["amountCents"] as? NSNumber)?.int64Value {
            Text(formatCents(cents, currency: deal.data["currency"] as? String)).font(AglynFont.subheadline)
          }
          if let close = millis(deal.data["expectedCloseAtMs"]) {
            Text("Closes \(Date(timeIntervalSince1970: Double(close) / 1000).formatted(date: .abbreviated, time: .omitted))")
              .font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
        Spacer(minLength: 0)
        if canMove {
          Menu {
            ForEach(pipeline.stages.filter { $0.id != columnID }) { stage in
              Button("Move to \(stage.name)") { onMove(stage.id) }
            }
          } label: {
            Image(systemName: "ellipsis.circle").foregroundStyle(.secondary)
          }
          .menuStyle(.borderlessButton)
          .fixedSize()
          .accessibilityLabel("Move \(deal.title)")
          .accessibilityIdentifier("deal-move-\(deal.id)")
        }
      }
      .padding(AglynSpace.oneAndHalf)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(AglynColor.page, in: RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier("deal-card-\(deal.id)")
  }
}
