// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// An automation's run history: every run the site logged for it, newest first,
/// filtered by Result and Trigger and searched by what happened, a page at a time.
struct RunHistoryScreen: View {
  let context: NativePluginContext
  let params: NativeParams
  @State private var live = LiveQuery()
  @State private var filters = RunFilters()
  @State private var page = 0
  @State private var searchText = ""

  static let pageSize = 25

  private var hostID: String? { params["hostId"] ?? context.hostID }
  private var targetID: String? { params["targetId"].flatMap { $0.isEmpty ? nil : $0 } }
  private var header: String { params["hostScope"] == "site" ? "Recent runs on this site" : "Recent runs" }

  var body: some View {
    let docs = live.docs ?? []
    let shown = Array(docs.prefix(Self.pageSize * (page + 1))).map { RunRow($0) }
    let hasMore = docs.count > Self.pageSize * (page + 1)
    List {
      Section {
        filterBar
      }
      Section {
        if live.docs == nil {
          SkeletonRows(count: 4)
        } else if live.failed && shown.isEmpty {
          AglynNotice("Could not load the runs.", tone: .error)
        } else if shown.isEmpty {
          Text(
            filters.filtering
              ? "No runs match these filters"
              : "No runs yet — every run of this automation is logged here, including the ones a condition skipped."
          )
          .foregroundStyle(.secondary)
          .accessibilityIdentifier("runs-empty")
        }
        ForEach(shown) { run in
          RunRowView(run: run).accessibilityIdentifier("run-\(run.id)")
        }
        if hasMore {
          Button("Show more runs") { page += 1 }
            .frame(maxWidth: .infinity)
            .accessibilityIdentifier("runs-more")
        }
      } header: {
        Text(header)
      }
    }
    .aglynListBackground()
    .searchable(text: $searchText, prompt: "Search what happened")
    .onSubmit(of: .search) { filters.search = searchText }
    .onChange(of: searchText) { _, text in
      if text.isEmpty { filters.search = "" }
    }
    .navigationTitle("Runs — \(params["name"] ?? "")")
    #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .accessibilityIdentifier("runs-list")
    .task(id: "\(hostID ?? "")|\(targetID ?? "")|\(filters.result?.rawValue ?? "")|\(filters.trigger ?? "")|\(filters.search)|\(page)") {
      guard let hostID else { return }
      live.start(
        context.firestore,
        runHistoryQuery(hostID: hostID, targetID: targetID, filters: filters, pageSize: Self.pageSize, page: page))
    }
    .onChange(of: filters) { _, _ in page = 0 }
    .onDisappear { live.stop() }
  }

  private var filterBar: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: AglynSpace.one) {
        AglynChoiceChip("All results", selected: filters.result == nil) { filters.result = nil }
        ForEach(RunResult.allCases) { result in
          AglynChoiceChip(result.label, selected: filters.result == result) {
            filters.result = filters.result == result ? nil : result
          }
          .accessibilityIdentifier("runs-result-\(result.rawValue)")
        }
        Divider().frame(height: 24)
        Menu {
          Button("Any trigger") { filters.trigger = nil }
          ForEach(hostEvents, id: \.type) { event in
            Button(event.label) { filters.trigger = event.type }
          }
        } label: {
          AglynChoiceChip(
            filters.trigger.map { "Trigger: \(hostEventLabel($0))" } ?? "Any trigger", systemImage: "line.3.horizontal.decrease",
            selected: filters.trigger != nil
          ) {}
          .allowsHitTesting(false)
        }
        .accessibilityIdentifier("runs-trigger")
      }
      .padding(.vertical, 2)
    }
    .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
  }
}

/// One run: its result, what happened, when, on what, and who set it off.
struct RunRowView: View {
  let run: RunRow

  private var tone: AglynTone {
    switch run.result {
    case .succeeded: .success
    case .failed: .error
    case .skipped: .warning
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      HStack(alignment: .firstTextBaseline) {
        StatusChip(run.result.label, tone: tone)
        Spacer()
        if let at = run.at {
          Text(at.formatted(date: .abbreviated, time: .shortened)).font(AglynFont.caption).foregroundStyle(.secondary)
        } else {
          Text("--").font(AglynFont.caption).foregroundStyle(.secondary)
        }
      }
      Text(run.summary).font(AglynFont.body)
      if let duration = run.durationMs {
        Text("\(duration)ms").font(AglynFont.caption.monospacedDigit()).foregroundStyle(.secondary)
      }
      HStack(spacing: AglynSpace.one) {
        Label(run.triggerLabel, systemImage: "bolt").lineLimit(1)
        Label(run.who, systemImage: "person").lineLimit(1)
      }
      .font(AglynFont.caption)
      .foregroundStyle(.secondary)
    }
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
  }
}
