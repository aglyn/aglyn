// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

// The theme editor's font control (the fonts plugin's `FontPicker`, `FontBrowserDialog`, `FontDetail` and
// `FontFamilyCard`, AGL-3656): the site's body font and heading font, each drawn in the site's own words in its own face,
// with what the fonts cost a visitor; a browser of the whole Google Fonts catalog and the site's uploaded fonts; and one
// family's styles, cost and pairings. Every choice is an edit to the editor's draft, which the editor's Save keeps. Faces
// come from the shared `WebFontLoader`; the system font stands in while one loads, offline, or when it cannot.

/// What a cost badge stands at: measuring, measured, or not measurable (`FontCostState`).
struct FontCostState: Equatable {
  var cost: FontCost?
  var loading = true
  var error: String?
}

/// Every answer the cost route gave this session, so going back to an earlier choice answers at once (`useFontCost`).
@MainActor
final class FontCostCache {
  static let shared = FontCostCache()
  private var answers: [String: Task<FontCost, Error>] = [:]

  func cost(_ api: FontPickerAPI, _ selection: ThemeFontSelection) async throws -> FontCost {
    let key = "\(api.hostID)|\(selection.hashValue)|\(String(describing: selection))"
    if let known = answers[key] { return try await known.value }
    let request = Task { try await api.cost(selection) }
    answers[key] = request
    do {
      return try await request.value
    } catch {
      // A failed answer is not kept: the next look asks again.
      answers[key] = nil
      throw error
    }
  }
}

extension View {
  /// Keeps `state` on what `selection`'s fonts cost, asked a moment after the last change (`useFontCost`).
  fileprivate func measuringFonts(_ selection: ThemeFontSelection?, api: FontPickerAPI, into state: Binding<FontCostState>) -> some View {
    task(id: selection) {
      guard let selection else { return }
      state.wrappedValue.loading = true
      state.wrappedValue.error = nil
      try? await Task.sleep(for: .milliseconds(250))
      guard !Task.isCancelled else { return }
      do {
        let cost = try await FontCostCache.shared.cost(api, selection)
        guard !Task.isCancelled else { return }
        state.wrappedValue = FontCostState(cost: cost, loading: false)
      } catch is CancellationError {
      } catch {
        state.wrappedValue = FontCostState(
          cost: nil, loading: false, error: (error as? ConsoleAPIError)?.message ?? "The size could not be measured.")
      }
    }
  }
}

/// What all the site's fonts cost a visitor (`ALL_FONTS_COST_TOOLTIP`).
let allFontsCostHelp =
  "What a visitor downloads for all your fonts together: the Latin files your text styles and italics use, served from your site’s own address."
/// What one font costs a visitor (`FONT_COST_TOOLTIP`).
let oneFontCostHelp =
  "What a visitor downloads for this font: the Latin files your text styles and italics use, served from your site’s own address. Measured the way your published pages load them."

/// A download size as one small badge, with its measuring and failed states (`DownloadCostBadge`).
struct FontCostBadge: View {
  var bytes: Int?
  var files = 0
  var approximate = false
  var loading = false
  var error: String?
  var help: String

  init(_ state: FontCostState, help: String) {
    bytes = state.cost?.bytes
    files = state.cost?.files ?? 0
    approximate = state.cost.map { !$0.complete } ?? false
    loading = state.loading
    error = state.error
    self.help = help
  }

  init(bytes: Int?, files: Int, approximate: Bool, help: String) {
    self.bytes = bytes
    self.files = files
    self.approximate = approximate
    self.help = help
  }

  var body: some View {
    Group {
      if loading {
        HStack(spacing: AglynSpace.half) {
          ProgressView().controlSize(.mini)
          Text("Measuring…")
        }
        .foregroundStyle(.secondary)
      } else if let bytes, error == nil {
        Label(fontCostLabel(FontCost(bytes: bytes, files: files, complete: !approximate)), systemImage: "arrow.down.to.line")
          .foregroundStyle(bytes == 0 ? AglynColor.success : Color.primary)
      } else {
        Label("Size unavailable", systemImage: "exclamationmark.circle").foregroundStyle(AglynColor.warning)
      }
    }
    .font(AglynFont.caption)
    .padding(.horizontal, AglynSpace.one)
    .padding(.vertical, AglynSpace.half)
    .overlay(Capsule().strokeBorder(AglynColor.divider))
    .help(error ?? help)
    .accessibilityElement(children: .combine)
    .accessibilityHint(error ?? help)
  }
}

/// The font a preview falls back to while its face loads: the category's own kind of system face (`genericFamily`).
func fallbackFont(_ category: String, _ style: AglynTextStyle, weight: Int) -> Font {
  let design: Font.Design =
    switch category {
    case "serif": .serif
    case "monospace": .monospaced
    default: .default
    }
  return .system(size: AglynFont.size(style), weight: fontWeight(weight), design: design)
}

private func fontWeight(_ weight: Int) -> Font.Weight {
  switch weight {
  case ..<150: .ultraLight
  case ..<250: .thin
  case ..<350: .light
  case ..<450: .regular
  case ..<550: .medium
  case ..<650: .semibold
  case ..<750: .bold
  case ..<850: .heavy
  default: .black
  }
}

/// Text drawn in one face of a Google family, loaded by the shared `WebFontLoader`; the category's system face meanwhile.
struct FontFaceText: View {
  let text: String
  /// The Google family to load; nil draws the system face (the theme default, an uploaded font).
  let family: String?
  var category = "sans-serif"
  var weight = 400
  var italic = false
  let style: AglynTextStyle
  var lineLimit: Int?

  var body: some View {
    let loaded = family.flatMap { WebFontLoader.shared.font(family: $0, weight: weight, italic: italic, text: text, style: style) }
    Text(text)
      .font(loaded ?? fallbackFont(category, style, weight: weight))
      .lineLimit(lineLimit)
  }
}

/// A font's upright weights and italics from an uploaded family's faces (`customChoice`).
func customFontChoice(_ font: InstalledFont) -> ThemeFontChoice {
  let upright = Array(Set(font.faces.filter { $0.style == "normal" }.map(\.weight))).sorted()
  let italics = Array(Set(font.faces.filter { $0.style == "italic" }.map(\.weight))).sorted()
  return ThemeFontChoice(
    family: font.family.trimmed, category: font.category ?? "sans-serif", weights: upright.isEmpty ? [400] : upright,
    italics: italics, source: "custom")
}

/// The theme editor's font control: the body and heading fonts, each drawn in its face, and what they cost (`FontPicker`).
struct ThemeFontsControl: View {
  let api: FontPickerAPI
  let fontsAPI: FontsAPI
  let sample: SiteSample
  let canEdit: Bool
  @Binding var fonts: ThemeFontSelection
  @State private var browsing: FontPickerRole?
  @State private var cost = FontCostState()

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.oneAndHalf) {
      AglynWrapRow {
        Text("Fonts").font(AglynFont.strongSubheadline)
        FontCostBadge(cost, help: allFontsCostHelp)
      }
      FontRoleCard(role: .body, choice: fonts.body, bodyChoice: fonts.body, sample: sample, canEdit: canEdit) { browsing = .body }
      FontRoleCard(
        role: .heading, choice: fonts.heading, bodyChoice: fonts.body, sample: sample, canEdit: canEdit, onChange: { browsing = .heading },
        onClear: fonts.heading == nil ? nil : { fonts.heading = nil })
    }
    .measuringFonts(fonts, api: api, into: $cost)
    .sheet(item: $browsing) { role in
      FontBrowserSheet(role: role, api: api, fontsAPI: fontsAPI, sample: sample, selection: fonts) { fonts = $0 }
    }
  }
}

/// One role's card: what it draws in, in the site's words (`FontRoleCard`).
private struct FontRoleCard: View {
  let role: FontPickerRole
  let choice: ThemeFontChoice?
  let bodyChoice: ThemeFontChoice?
  let sample: SiteSample
  let canEdit: Bool
  let onChange: () -> Void
  var onClear: (() -> Void)?

  var body: some View {
    // What the role draws in: its own font, else the body's, else the base.
    let drawn = choice ?? (role == .heading ? bodyChoice : nil)
    let weight = role == .heading ? (drawn?.weights.max() ?? 700) : (drawn?.weights.min() ?? 400)
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      HStack(alignment: .center, spacing: AglynSpace.one) {
        VStack(alignment: .leading, spacing: 2) {
          Text(role.label.uppercased()).font(AglynFont.caption).foregroundStyle(.secondary)
          Text(title).font(AglynFont.headline)
          Text(subheader).font(AglynFont.caption).foregroundStyle(.secondary)
        }
        Spacer(minLength: AglynSpace.one)
        if let onClear {
          Button("Use body font", action: onClear).buttonStyle(.borderless).disabled(!canEdit)
        }
        Button("Change", action: onChange)
          .buttonStyle(.borderless)
          .disabled(!canEdit)
          .accessibilityLabel("Change the \(role.label.lowercased()) font")
          .accessibilityIdentifier("font-change-\(role.rawValue)")
      }
      FontFaceText(
        text: role == .heading ? sample.heading : sample.paragraph, family: drawn?.source == "google" ? drawn?.family : nil,
        category: drawn?.category ?? "sans-serif", weight: weight,
        style: role == .heading ? AglynFont.Scale.h5 : AglynFont.Scale.body1)
    }
    .padding(AglynSpace.two)
    .frame(maxWidth: .infinity, alignment: .leading)
    .aglynCardSurface()
    .accessibilityIdentifier("font-role-\(role.rawValue)")
  }

  private var title: String { choice?.family ?? (role == .body ? "Theme default" : "Same as body text") }

  private var subheader: String {
    if let choice { return "\(fontCategoryLabel(choice.category)) · \(fontChoiceStylesLabel(choice))" }
    if role == .heading, let bodyChoice { return "\(bodyChoice.family), in each heading’s own weight" }
    return "The visitor’s system font"
  }
}

/// What the browser has open: the theme default, a Google family, or an uploaded font.
enum FontTarget: Hashable {
  case themeDefault
  case google(GoogleFontFamily)
  case custom(InstalledFont)
}

extension InstalledFont: Hashable {
  public func hash(into hasher: inout Hasher) { hasher.combine(family) }
}

extension InstalledFace: Hashable {
  public func hash(into hasher: inout Hasher) {
    hasher.combine(weight)
    hasher.combine(style)
  }
}

/// The whole Google Fonts catalog for one role, searched and narrowed by category, drawn in the site's own words, with the
/// site's uploaded fonts above it (`FontBrowserDialog`). A family opens its detail.
private struct FontBrowserSheet: View {
  let role: FontPickerRole
  let api: FontPickerAPI
  let fontsAPI: FontsAPI
  let sample: SiteSample
  let selection: ThemeFontSelection
  let apply: (ThemeFontSelection) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var catalog: LiveValue<[GoogleFontFamily]> = .loading
  @State private var installed: [InstalledFont] = []
  @State private var attempt = 0
  @State private var search = ""
  @State private var category = "all"
  @State private var path: [FontTarget] = []

  private var current: ThemeFontChoice? { role == .body ? selection.body : selection.heading }

  var body: some View {
    NavigationStack(path: $path) {
      list
        .navigationTitle(role == .body ? "Choose the font for body text" : "Choose the font for headings")
        .aglynScreenTitle(role == .body ? "Body text font" : "Heading font")
        #if os(iOS)
          .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        .navigationDestination(for: FontTarget.self) { target in
          FontDetailView(
            role: role, target: target, api: api, sample: sample, selection: selection, catalog: catalog.value ?? [],
            apply: { next in
              apply(next)
              dismiss()
            })
        }
    }
    .aglynSheetMinimumSize(width: 420, height: 560)
    .task(id: attempt) {
      catalog = .loading
      do {
        catalog = .ready(try await api.catalog())
      } catch is CancellationError {
      } catch {
        catalog = .failed("The font list could not be loaded. Check your connection and try again.")
      }
    }
    .task { installed = (try? await fontsAPI.installed()) ?? [] }
  }

  private var filtering: Bool { !search.trimmed.isEmpty || category != "all" }

  private var matchingCustom: [InstalledFont] {
    guard category == "all" else { return [] }
    let words = search.trimmed.lowercased()
    return installed.filter { words.isEmpty || $0.family.lowercased().contains(words) }
  }

  private func isSelected(_ family: String?) -> Bool {
    guard let family else { return current == nil }
    return current?.family.lowercased() == family.lowercased()
  }

  @ViewBuilder private var list: some View {
    List {
      if !filtering {
        Section {
          let bodyFamily = role == .heading ? selection.body : nil
          FontFamilyRow(
            label: role == .body ? "Theme default" : "Same as body text",
            detail: role == .body ? "The visitor’s system font · nothing to download" : "Headings use the body font",
            sample: sample.title, family: bodyFamily?.source == "google" ? bodyFamily?.family : nil,
            category: bodyFamily?.category ?? "sans-serif", selected: isSelected(nil), value: .themeDefault)
        }
      }
      if !matchingCustom.isEmpty {
        Section("Your fonts") {
          ForEach(matchingCustom) { font in
            FontFamilyRow(
              label: font.family, detail: "\(fontCategoryLabel(font.category ?? "sans-serif")) · uploaded", sample: sample.title,
              family: nil, category: font.category ?? "sans-serif", selected: isSelected(font.family), value: .custom(font))
          }
        }
      }
      switch catalog {
      case .loading:
        Section { SkeletonRows(count: 6) }
      case .failed(let message):
        Section {
          AglynNotice(message, tone: .error)
          Button("Try again") { attempt += 1 }
        }
      case .ready(let families):
        let results = searchFontFamilies(families, query: search, category: category == "all" ? "" : category)
        if results.isEmpty {
          AglynEmptyState("No fonts match", systemImage: "textformat", message: "Try another name, or another category.") {
            Button("Show all fonts") {
              search = ""
              category = "all"
            }
          }
          .listRowBackground(Color.clear)
        } else {
          Section {
            ForEach(results) { family in
              FontFamilyRow(
                label: family.family,
                detail: "\(fontCategoryLabel(family.category)) · \(stylesLabel(family.weights.count + family.italics.count))",
                sample: sample.title, family: family.family, category: family.category, selected: isSelected(family.family),
                value: .google(family))
            }
          } header: {
            Text(summary(results.count))
          }
        }
      }
    }
    .safeAreaInset(edge: .top, spacing: 0) {
      AglynChipRow([AglynChipOption("all", "All")] + fontCategoryLabels.map { AglynChipOption($0.value, $0.label) }, selected: category) {
        category = $0
      }
      .background(.bar)
    }
    .aglynSearchable(text: $search, prompt: "Inter, Lora, Playfair…")
  }

  /// The list's count line (`SearchableVirtualList`'s summary).
  private func summary(_ count: Int) -> String {
    let families = "\(count.formatted()) \(count == 1 ? "family" : "families")"
    let matched = filtering ? (count == 1 ? " matches" : " match") : ""
    return "Google Fonts · \(families)\(matched), most popular first"
  }
}

private func stylesLabel(_ count: Int) -> String { "\(count) \(count == 1 ? "style" : "styles")" }

/// One family in the browser: its name and the site's name drawn in it, loaded as the row comes into view
/// (`FontFamilyCard`).
private struct FontFamilyRow: View {
  let label: String
  let detail: String
  let sample: String
  let family: String?
  let category: String
  let selected: Bool
  let value: FontTarget

  var body: some View {
    NavigationLink(value: value) {
      VStack(alignment: .leading, spacing: AglynSpace.half) {
        HStack {
          VStack(alignment: .leading, spacing: 2) {
            Text(label).font(AglynFont.strongSubheadline).lineLimit(1)
            Text(detail).font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(1)
          }
          Spacer()
          if selected { Image(systemName: "checkmark").foregroundStyle(AglynColor.tint) }
        }
        FontFaceText(text: sample, family: family, category: category, style: AglynFont.Scale.h5, lineLimit: 1)
      }
      .padding(.vertical, AglynSpace.half)
    }
    .accessibilityLabel("\(label), \(detail)")
    .accessibilityAddTraits(selected ? .isSelected : [])
    .accessibilityIdentifier("font-row-\(label)")
  }
}

/// One family chosen from the list: the site's words in it, the styles to load, what it costs and what pairs with it; or
/// the theme default (`FontDetail`, and the dialog's default card).
private struct FontDetailView: View {
  let role: FontPickerRole
  let target: FontTarget
  let api: FontPickerAPI
  let sample: SiteSample
  let selection: ThemeFontSelection
  let catalog: [GoogleFontFamily]
  let apply: (ThemeFontSelection) -> Void
  @State private var candidate: ThemeFontChoice?
  @State private var cost = FontCostState()

  private var other: FontPickerRole { role == .body ? .heading : .body }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: AglynSpace.two) {
        switch target {
        case .themeDefault: defaultCard
        case .google, .custom:
          if let candidate { familyCard(candidate) }
          pairingsSection
        }
      }
      .padding(AglynSpace.two)
    }
    .navigationTitle(title)
    .aglynScreenTitle(title)
    .onAppear { if candidate == nil { candidate = initialChoice } }
    .measuringFonts(candidateSelection, api: api, into: $cost)
  }

  private var title: String {
    switch target {
    case .themeDefault: role == .body ? "Theme default" : "Same as body text"
    case .google(let family): family.family
    case .custom(let font): font.family
    }
  }

  private var current: ThemeFontChoice? { role == .body ? selection.body : selection.heading }

  /// What the family opens on: the role's own choice if it is this family, else the family's default for the role.
  private var initialChoice: ThemeFontChoice? {
    switch target {
    case .themeDefault: return nil
    case .google(let family):
      if let current, current.family.lowercased() == family.family.lowercased() { return current }
      return defaultFontChoice(family, role: role)
    case .custom(let font): return customFontChoice(font)
    }
  }

  private func with(_ choice: ThemeFontChoice?, for role: FontPickerRole, in base: ThemeFontSelection) -> ThemeFontSelection {
    var next = base
    if role == .body { next.body = choice } else { next.heading = choice }
    return next
  }

  private var candidateSelection: ThemeFontSelection? { candidate.map { with($0, for: role, in: selection) } }

  // MARK: The theme default

  private var defaultCard: some View {
    VStack(alignment: .leading, spacing: AglynSpace.two) {
      HStack(alignment: .center) {
        VStack(alignment: .leading, spacing: 2) {
          Text(title).font(AglynFont.headline)
          Text(role == .body ? "No font to download" : "One font for the whole site").font(AglynFont.caption).foregroundStyle(.secondary)
        }
        Spacer()
        Button(role == .body ? "Use theme default" : "Use body font") { apply(with(nil, for: role, in: selection)) }
          .buttonStyle(.aglynProminent)
          .accessibilityIdentifier("font-use")
      }
      Text(
        role == .body
          ? "Text is drawn in the font each visitor’s device already has — San Francisco on Apple devices, Segoe UI on Windows, Roboto on Android. It costs nothing to download and appears at once."
          : "Headings are drawn in the body text’s font, in their own weights. Pick a font here to give them one of their own."
      )
      .font(AglynFont.subheadline).foregroundStyle(.secondary)
      if role == .body {
        FontCostBadge(bytes: 0, files: 0, approximate: false, help: "System fonts are already on the visitor’s device.")
      }
    }
    .padding(AglynSpace.two)
    .frame(maxWidth: .infinity, alignment: .leading)
    .aglynCardSurface()
  }

  // MARK: A family

  private var google: GoogleFontFamily? { if case .google(let family) = target { family } else { nil } }

  private func familyCard(_ choice: ThemeFontChoice) -> some View {
    let offeredWeights = google?.weights ?? (customOffered?.weights ?? choice.weights)
    let offeredItalics = google?.italics ?? (customOffered?.italics ?? [])
    let headingWeight = choice.weights.max() ?? 700
    let bodyWeight = choice.weights.min() ?? 400
    let loads = google?.family
    // The preview's other line: body text under a heading font, in the body font; headings over a body font, in the theme's
    // heading font if it has one.
    let companion = role == .heading ? selection.body : selection.heading
    return VStack(alignment: .leading, spacing: AglynSpace.three) {
      HStack(alignment: .center) {
        VStack(alignment: .leading, spacing: 2) {
          Text(choice.family).font(AglynFont.headline)
          Text(subheader(choice, offeredWeights.count + offeredItalics.count)).font(AglynFont.caption).foregroundStyle(.secondary)
        }
        Spacer()
        Button(role == .body ? "Use for body text" : "Use for headings") { apply(with(choice, for: role, in: selection)) }
          .buttonStyle(.aglynProminent)
          .accessibilityIdentifier("font-use")
      }
      VStack(alignment: .leading, spacing: AglynSpace.oneAndHalf) {
        let headingText = role == .heading ? sample.heading : sample.title
        if role == .body, let companion {
          FontFaceText(
            text: headingText, family: companion.source == "google" ? companion.family : nil, category: companion.category,
            weight: companion.weights.max() ?? 700, style: AglynFont.Scale.h3)
        } else {
          FontFaceText(text: headingText, family: loads, category: choice.category, weight: headingWeight, style: AglynFont.Scale.h3)
        }
        if role == .heading, let companion {
          FontFaceText(
            text: sample.paragraph, family: companion.source == "google" ? companion.family : nil, category: companion.category,
            weight: companion.weights.min() ?? 400, style: AglynFont.Scale.body1)
        } else {
          FontFaceText(text: sample.paragraph, family: loads, category: choice.category, weight: bodyWeight, style: AglynFont.Scale.body1)
        }
      }
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        Text("Styles to load").font(AglynFont.strongSubheadline)
        AglynWrapRow {
          ForEach(offeredWeights, id: \.self) { weight in
            AglynChoiceChip(fontWeightLabel(weight), selected: choice.weights.contains(weight)) { toggle(weight) }
              .accessibilityIdentifier("font-weight-\(weight)")
          }
          if !offeredItalics.isEmpty {
            if role == .body {
              // The page loads body text's italic whatever the theme lists, so emphasis is a true italic: shown, not offered.
              AglynChoiceChip("Italic", selected: true) {}
                .italic()
                .allowsHitTesting(false)
                .help("Body text always loads its italic, so emphasis in your text is a true italic.")
                .accessibilityHint("Body text always loads its italic, so emphasis in your text is a true italic.")
            } else {
              AglynChoiceChip("Italic", selected: !choice.italics.isEmpty) { toggleItalic(offeredItalics) }.italic()
            }
          }
        }
        Text("Your headings and text styles load the weights they use as well, matched to the nearest one this font has.")
          .font(AglynFont.caption).foregroundStyle(.secondary)
      }
      AglynWrapRow {
        Text("Download size").font(AglynFont.strongSubheadline)
        Text("This font").font(AglynFont.caption).foregroundStyle(.secondary)
        thisFontBadge(choice)
        if let all = cost.cost, all.families.count > 1 {
          Text("All your fonts").font(AglynFont.caption).foregroundStyle(.secondary)
          FontCostBadge(bytes: all.bytes, files: all.files, approximate: !all.complete, help: allFontsCostHelp)
        }
      }
    }
    .padding(AglynSpace.two)
    .frame(maxWidth: .infinity, alignment: .leading)
    .aglynCardSurface()
  }

  private var customOffered: ThemeFontChoice? { if case .custom(let font) = target { customFontChoice(font) } else { nil } }

  private func thisFontBadge(_ choice: ThemeFontChoice) -> FontCostBadge {
    let share = cost.cost?.share(of: choice.family)
    var state = cost
    state.cost = cost.cost.map { _ in
      FontCost(bytes: share?.bytes ?? 0, files: share?.files ?? 0, complete: share?.complete ?? true)
    }
    return FontCostBadge(state, help: oneFontCostHelp)
  }

  private func subheader(_ choice: ThemeFontChoice, _ styles: Int) -> String {
    [
      fontCategoryLabel(choice.category), "\(styles) \(styles == 1 ? "style" : "styles")",
      google?.axes.contains { $0.tag == "wght" } == true ? "Variable" : nil, google == nil ? "Your font" : nil,
    ]
    .compactMap { $0 }.joined(separator: " · ")
  }

  private func toggle(_ weight: Int) {
    guard var next = candidate else { return }
    let selected = next.weights.contains(weight)
    // A font always loads at least one weight.
    if selected && next.weights.count == 1 { return }
    next.weights = selected ? next.weights.filter { $0 != weight } : (next.weights + [weight]).sorted()
    candidate = next
  }

  private func toggleItalic(_ offered: [Int]) {
    guard var next = candidate else { return }
    if !next.italics.isEmpty {
      next.italics = []
    } else {
      let wanted = next.weights.filter { offered.contains($0) }
      next.italics = wanted.isEmpty ? Array(offered.prefix(1)) : wanted
    }
    candidate = next
  }

  // MARK: Pairings

  @ViewBuilder private var pairingsSection: some View {
    let pairings = google.map { suggestFontPairings($0, role: other, catalog: catalog) } ?? []
    if !pairings.isEmpty, let candidate {
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        Text(role == .body ? "Headings that pair well" : "Body text that pairs well").font(AglynFont.strongSubheadline)
        ForEach(pairings, id: \.family.family) { pairing in
          PairingCard(pairing: pairing, sample: sample, role: role) {
            let partner = defaultFontChoice(pairing.family, role: other)
            apply(role == .body ? ThemeFontSelection(body: candidate, heading: partner) : ThemeFontSelection(body: partner, heading: candidate))
          }
        }
      }
    }
  }
}

/// A suggested partner, drawn in the role it would play (`PairingCard`).
private struct PairingCard: View {
  let pairing: FontPairing
  let sample: SiteSample
  let role: FontPickerRole
  let use: () -> Void

  var body: some View {
    // The suggestion plays the other role: headings for a body font, text for a heading font.
    let weight = role == .body ? max(pairing.family.weights.filter { $0 <= 700 }.max() ?? 0, pairing.family.weights.first ?? 400) : 400
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      HStack(alignment: .center) {
        VStack(alignment: .leading, spacing: 2) {
          Text(pairing.family.family).font(AglynFont.strongSubheadline)
          Text(pairing.reason).font(AglynFont.caption).foregroundStyle(.secondary)
        }
        Spacer()
        Button("Use pair", action: use).buttonStyle(.borderless).accessibilityIdentifier("font-pair-\(pairing.family.family)")
      }
      FontFaceText(
        text: sample.title, family: pairing.family.family, category: pairing.family.category, weight: weight, style: AglynFont.Scale.h6,
        lineLimit: 1)
    }
    .padding(AglynSpace.two)
    .frame(maxWidth: .infinity, alignment: .leading)
    .aglynCardSurface()
  }
}
