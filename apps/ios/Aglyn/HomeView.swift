// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// Home answers one question: what needs me now? (AGL-3945, Figma Home "Needs you" 2:6; Calm rules.) The site in one
/// line, then only what is waiting on the person (each line opens its list, already filtered), then where they left off,
/// then the one-line AI prompt that starts Create with AI. No charts here: those are Overview's.
struct HomeView: View {
  @Environment(\.aglynWideChrome) private var wide
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @State private var site = SiteStatus()
  @State private var prompt = ""
  /// The Needs-you lines on screen: a line with nothing waiting draws nothing.
  @State private var lines = AglynNeedsYouLines()

  /// The plugins' "Needs you" lines (the `homeNeedsYou` slot): each draws one line, or nothing when nothing waits.
  static let needsYouSlot = "homeNeedsYou"

  private var picked: WorkspaceSite? { model.scopedSite(navigation) }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: AglynSpace.three) {
        if let workspace = model.workspace, workspace.ready, workspace.orgs.isEmpty {
          FirstRunView()
        } else {
          scopeLine
          needsYou
          pickUp
          if picked != nil, model.registry.screen("ai.create") != nil { aiPrompt }
        }
      }
      .padding(.horizontal, wide ? AglynContentInsets.horizontal : AglynSpace.two)
      .padding(.vertical, wide ? 24 : AglynSpace.two)
      // Home fills its column at every width, its cards on the content edges (Zach, 2026-10-19: no capped column).
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    // The content's ground is the surface on the Mac and iPad (Figma Home 2:6), the canvas on a phone.
    .background(wide ? AglynColor.paper : AglynColor.page)
    .navigationTitle("Home")
    .refreshable { model.refresh() }
    .task(id: "\(picked?.id ?? ""):\(model.refreshToken)") {
      site.start(reader: model.reader, hostID: picked?.id)
    }
  }

  // MARK: The site, in one line

  @ViewBuilder
  private var scopeLine: some View {
    if let picked {
      let address = HostStatus.siteAddress(picked.subdomain)
      HStack(spacing: AglynSpace.one) {
        AglynBrandPicture(model.mediaURL(picked.favicon, hostID: picked.id), size: 28, cornerRadius: 14) {
          IconBadge("globe", tone: .neutral, size: 28, circle: true)
        }
        Text(picked.name).font(AglynFont.title2).lineLimit(1)
        if let chip = site.chip { StatusChip(chip.text, tone: chip.tone) }
        Spacer(minLength: AglynSpace.one)
        if let address, let url = URL(string: "https://\(address)/") {
          Button("Visit site") { navigation.openWeb(AglynWebPage(url)) }
            .buttonStyle(.aglynSecondary)
            .accessibilityIdentifier("home-visit-site")
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("home-site-line")
    } else if let org = model.workspace?.org {
      HStack(spacing: AglynSpace.one) {
        PinTile(orgID: org.id, size: 28)
        Text(org.name).font(AglynFont.title2).lineLimit(1)
        if let plan = model.workspace?.orgLogos[org.id]?.planLabel { StatusChip(plan) }
        Spacer()
      }
      .accessibilityIdentifier("home-workspace-line")
    }
  }

  // MARK: Needs you

  private var needsYou: some View {
    let widgets = model.registry.widgets(for: .aglyn, slot: Self.needsYouSlot).filter { picked != nil || !$0.requiresSite }
    let paymentDue = model.workspace?.orgLogo?.paymentDue == true
    return VStack(alignment: .leading, spacing: AglynSpace.one) {
      AglynSectionHeader("Needs you")
      VStack(spacing: 0) {
        // The workspace's own plan payment, the shell's line (read from the workspace's document).
        if paymentDue {
          AglynNeedsYouLine(
            id: "plan-payment", systemImage: "creditcard", text: "Your plan's payment did not go through", place: "Billing",
            tone: .error
          ) {
            navigation.mode = .workspaceSettings
            navigation.select(.plugin("core.billing"))
          }
        }
        if let context = model.context(for: navigation) {
          ForEach(widgets) { line in
            line.make(context).id("\(line.id):\(context.hostID ?? ""):\(model.refreshToken)")
          }
        }
      }
      .environment(\.aglynNeedsYou, lines)
      .aglynCardSurface()
      .opacity(lines.any ? 1 : 0)
      if !lines.any {
        Text("Nothing needs you right now.").foregroundStyle(.secondary)
          .accessibilityIdentifier("home-nothing-waiting")
      }
    }
  }

  // MARK: Pick up where you left off

  @ViewBuilder
  private var pickUp: some View {
    let items = (model.preferences?.recents ?? []).filter { item in
      item.orgId == model.workspace?.org?.id && (picked == nil || item.hostId == nil || item.hostId == picked?.id)
    }.prefix(6)
    if !items.isEmpty {
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        AglynSectionHeader("Pick up where you left off")
        AglynCardGrid(minimum: 180, maxColumns: 3) {
          ForEach(Array(items), id: \.key) { item in
            Button {
              open(item)
            } label: {
              VStack(alignment: .leading, spacing: 6) {
                Image(systemName: icon(item)).font(.title3).foregroundStyle(AglynColor.tint)
                Text(item.label).font(AglynFont.strongSubheadline).lineLimit(1)
                Text(detail(item)).font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(1)
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(AglynSpace.oneAndHalf)
              .aglynCardSurface()
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("home-recent-\(item.id)")
          }
        }
      }
    }
  }

  private func icon(_ item: RecentItem) -> String {
    NativeNav.manifest.lists.flatMap(\.groups).flatMap(\.rows).first { $0.id == item.id || $0.screen == item.screen }?
      .icon.apple ?? "clock"
  }

  private func detail(_ item: RecentItem) -> String {
    let site = item.hostId.flatMap { id in model.workspace?.sites.first { $0.id == id }?.name }
    return [site ?? model.workspace?.org?.name, relativeTime(Date(timeIntervalSince1970: Double(item.openedAtMs) / 1000))]
      .compactMap { $0 }.joined(separator: " · ")
  }

  private func open(_ item: RecentItem) {
    if let hostID = item.hostId {
      model.workspace?.selectSite(hostID)
      navigation.inSite = true
    }
    navigation.select(ShellSection.opening(item.screen, item.params))
  }

  // MARK: The AI prompt

  private var aiPrompt: some View {
    HStack(spacing: AglynSpace.one) {
      Image(systemName: "sparkles").foregroundStyle(AglynColor.tint).accessibilityHidden(true)
      TextField("Describe what you want to build", text: $prompt, axis: .vertical)
        .textFieldStyle(.plain)
        .lineLimit(1...3)
        .onSubmit(startAI)
        .accessibilityIdentifier("home-ai-prompt")
      Button {
        startAI()
      } label: {
        Label("Start", systemImage: "arrow.up.circle.fill").labelStyle(.iconOnly).font(.title2)
      }
      .buttonStyle(.plain)
      .foregroundStyle(AglynColor.tint)
      .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      .accessibilityIdentifier("home-ai-start")
    }
    .padding(AglynSpace.oneAndHalf)
    .aglynCardSurface()
  }

  /// Opens Create with AI on a page, the brief already written (the existing flow: it asks, then starts the job).
  private func startAI() {
    let brief = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !brief.isEmpty else { return }
    navigation.push(.screen("ai.create", ["kind": "page", "brief": brief]))
    prompt = ""
  }
}
