import HomeFinKit
import SwiftUI

/// Netflix's Search: a glass field, "Recommended series & films" as a list until you type, then
/// a poster grid. Titles that aren't on the server yet can be requested from the results.
struct SearchView: View {
    var requests: RequestsConfig?
    @Environment(AppModel.self) private var model
    @Environment(\.isCompactLayout) private var compact
    @State private var query = ""
    @State private var results: [Item] = []
    @State private var notHere: [MediaResult] = []
    @State private var suggestions: [Item] = []
    @State private var searching = false
    @State private var requesting: MediaResult?
    @State private var scrolled = false
    @FocusState private var focused: Bool

    private var columns: [GridItem] { [GridItem(.adaptive(minimum: compact ? 104 : 150), spacing: 8)] }
    private var typing: Bool { query.trimmingCharacters(in: .whitespaces).count >= 2 }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if !typing {
                        Text("Recommended series & films").font(.system(size: 19, weight: .bold))
                        ForEach(suggestions) { item in
                            SuggestionRow(item: item)
                        }
                    } else {
                        if results.isEmpty && notHere.isEmpty && !searching {
                            ContentUnavailableView.search(text: query)
                        }
                        if !results.isEmpty {
                            Text("Series & Films").font(.system(size: 19, weight: .bold))
                            LazyVGrid(columns: columns, spacing: 10) {
                                ForEach(results) { item in
                                    Button { model.show(item) } label: { PosterCard(item: item, width: nil) }
                                        .buttonStyle(CardButtonStyle())
                                }
                            }
                        }
                        if !notHere.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Not here yet").font(.system(size: 19, weight: .bold))
                                Text(requests?.policy == "approve" ? "Ask for it and it'll be added once an admin approves." : "Ask for it and it'll be added.")
                                    .font(.callout).foregroundStyle(Theme.secondary)
                            }
                            .padding(.top, 14)
                            LazyVGrid(columns: columns, spacing: 14) {
                                ForEach(notHere) { result in
                                    Button { requesting = result } label: { RequestPoster(result: result, width: nil) }
                                        .buttonStyle(CardButtonStyle())
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, Theme.gutter)
                .padding(.bottom, 40)
                .animation(.easeOut(duration: 0.25), value: results)
                .animation(.easeOut(duration: 0.25), value: notHere)
                .animation(.easeOut(duration: 0.25), value: typing)
            }
            .scrollDismissesKeyboard(.immediately)
            .trackScrolled($scrolled)
            .pinnedHeader(scrolled: scrolled) {
                VStack(spacing: 6) {
                    TabHeader { Text("Search").font(.system(size: 28, weight: .bold)) }
                    GlassSearchField(prompt: "Search series, films…", text: $query, focus: $focused)
                        .padding(.horizontal, Theme.gutter)
                        .padding(.bottom, 10)
                }
            }
            .homeFinBackground()
            .hideNavigationBar()
            .task(id: query) { await search() }
            .task { await loadSuggestions() }
            .sheet(item: $requesting) { result in
                RequestSheet(result: result, config: requests)
            }
        }
    }

    private func search() async {
        let term = query.trimmingCharacters(in: .whitespaces)
        guard term.count >= 2, let jellyfin = model.jellyfin else {
            results = []
            notHere = []
            return
        }
        // Wait for typing to pause.
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        searching = true
        async let library = jellyfin.search(term)
        async let requestable = requestableResults(term)
        results = (try? await library) ?? []
        notHere = await requestable
        searching = false
    }

    private func requestableResults(_ term: String) async -> [MediaResult] {
        guard requests?.enabled == true, requests?.policy != "off", let accounts = model.accounts else { return [] }
        let found = (try? await accounts.searchRequests(term)) ?? []
        return Array(found.filter { $0.state != "available" }.prefix(12))
    }

    private func loadSuggestions() async {
        guard suggestions.isEmpty, let jellyfin = model.jellyfin else { return }
        suggestions = (try? await jellyfin.items(["IncludeItemTypes": "Movie,Series", "SortBy": "Random", "Limit": "24",
                                                  "Filters": "IsUnplayed"])) ?? []
    }
}

/// A suggestion: 16:9 still with its badges, the title, and a play circle at the end.
struct SuggestionRow: View {
    var item: Item
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 14) {
            Button { model.show(item) } label: {
                HStack(spacing: 14) {
                    Artwork(url: model.jellyfin?.landscapeURL(item, maxWidth: 500), placeholder: item.name)
                        .frame(width: 146, height: 74)
                        .overlay(alignment: .topLeading) {
                            if model.top10Ids.contains(item.id) { Top10Badge(scale: 0.8) }
                        }
                        .overlay(alignment: .bottom) {
                            if let ribbon = item.ribbon() { Ribbon(text: ribbon).scaleEffect(0.85, anchor: .bottom) }
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                    Text(item.name ?? "")
                        .font(.system(size: 16, weight: .semibold))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button { model.play(item) } label: {
                Image(systemName: "play.circle")
                    .font(.system(size: 36, weight: .thin))
            }
            .buttonStyle(PressScaleStyle())
            .accessibilityLabel("Play \(item.name ?? "")")
        }
        .contextMenu { TitleMenu(item: item) }
    }
}
