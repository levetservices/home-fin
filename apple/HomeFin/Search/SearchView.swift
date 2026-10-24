import HomeFinKit
import SwiftUI

/// Search the library; titles that aren't here yet can be requested right from the results.
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

    private var columns: [GridItem] { [GridItem(.adaptive(minimum: compact ? 104 : 150), spacing: 10)] }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if query.trimmingCharacters(in: .whitespaces).count < 2 {
                        if !suggestions.isEmpty {
                            Text("Recommended for you").font(.system(size: 19, weight: .bold))
                            grid(suggestions)
                        }
                    } else {
                        if results.isEmpty && notHere.isEmpty && !searching {
                            ContentUnavailableView.search(text: query)
                        }
                        if !results.isEmpty { grid(results) }
                        if !notHere.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Not here yet").font(.system(size: 19, weight: .bold))
                                Text(requests?.policy == "approve" ? "Ask for it and it'll be added once an admin approves." : "Ask for it and it'll be added.")
                                    .font(.callout).foregroundStyle(Theme.secondary)
                            }
                            .padding(.top, 10)
                            LazyVGrid(columns: columns, spacing: 14) {
                                ForEach(notHere) { result in
                                    Button { requesting = result } label: { RequestPoster(result: result, width: compact ? 104 : 150) }
                                        .buttonStyle(CardButtonStyle())
                                }
                            }
                        }
                    }
                }
                .padding(Theme.gutter)
                .animation(.easeOut(duration: 0.25), value: results)
                .animation(.easeOut(duration: 0.25), value: notHere)
            }
            .homeFinBackground()
            .navigationTitle("Search")
            .searchable(text: $query, prompt: "Films and shows")
            .navigationDestination(for: Item.self) { item in
                DetailView(itemId: item.isEpisode ? (item.seriesId ?? item.id) : item.id)
            }
            .task(id: query) { await search() }
            .task { await loadSuggestions() }
            .sheet(item: $requesting) { result in
                RequestSheet(result: result, config: requests)
            }
        }
    }

    private func grid(_ items: [Item]) -> some View {
        LazyVGrid(columns: columns, spacing: 14) {
            ForEach(items) { item in
                NavigationLink(value: item) { PosterCard(item: item, width: compact ? 104 : 150) }
                    .buttonStyle(CardButtonStyle())
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
        suggestions = (try? await jellyfin.items(["IncludeItemTypes": "Movie,Series", "SortBy": "Random", "Limit": "18",
                                                  "Filters": "IsUnplayed"])) ?? []
    }
}
