import HomeFinKit
import SwiftUI

/// Requests: search Sonarr / Radarr, your requests and the household's, and (admins) the approval queue.
struct RequestsView: View {
    var config: RequestsConfig?
    @Environment(AppModel.self) private var model
    @Environment(\.isCompactLayout) private var compact
    @State private var query = ""
    @State private var results: [MediaResult] = []
    @State private var lists: RequestLists?
    @State private var queue: RequestQueue?
    @State private var requesting: MediaResult?
    @State private var busy: Int?
    @State private var error: String?
    @State private var declining: MediaRequest?
    @State private var declineReason = ""
    @State private var scrolled = false
    @FocusState private var searchFocused: Bool

    private var columns: [GridItem] { [GridItem(.adaptive(minimum: compact ? 104 : 150), spacing: 10)] }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    ErrorNote(message: error)
                    if config?.enabled != true {
                        ContentUnavailableView("Requests aren't set up",
                                               systemImage: "plus.rectangle.on.rectangle",
                                               description: Text(config?.isAdmin == true ? "Connect Sonarr and Radarr in Home Fin's web Settings → Requests." : "Ask whoever runs this server."))
                    } else if query.trimmingCharacters(in: .whitespaces).count >= 2 {
                        LazyVGrid(columns: columns, spacing: 14) {
                            ForEach(results) { result in
                                Button { requesting = result } label: { RequestPoster(result: result, width: nil) }
                                    .buttonStyle(CardButtonStyle())
                            }
                        }
                    } else {
                        if let queue, config?.isAdmin == true, !(queue.pending + queue.failed).isEmpty {
                            section("Waiting for you") {
                                ForEach(queue.pending + queue.failed) { request in queueRow(request) }
                            }
                        }
                        section("Your requests") {
                            if lists?.mine.isEmpty ?? true {
                                Text("Nothing yet. Search above to ask for a film or show.").foregroundStyle(Theme.secondary)
                            }
                            requestGrid(lists?.mine ?? [], caption: { request in
                                request.status == "declined" ? "Declined\(request.reason.map { ": \($0)" } ?? "")" : seasonsText(request)
                            })
                        }
                        if let household = lists?.household, !household.isEmpty {
                            section("Asked for by the household") {
                                requestGrid(household, caption: { "Asked by \($0.requestedBy)" })
                            }
                        }
                    }
                }
                .padding(.horizontal, Theme.gutter)
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.immediately)
            .trackScrolled($scrolled)
            .pinnedHeader(scrolled: scrolled) {
                VStack(spacing: 6) {
                    TabHeader { Text("Requests").font(.system(size: 28, weight: .bold)) }
                    if config?.enabled == true {
                        GlassSearchField(prompt: config?.movies == true && config?.tv == true ? "Find a film or series to ask for…" : "Search…",
                                         text: $query, focus: $searchFocused)
                            .padding(.horizontal, Theme.gutter)
                            .padding(.bottom, 10)
                    }
                }
            }
            .homeFinBackground()
            .hideNavigationBar()
            .refreshable { await load() }
            .task { await load() }
            .task(id: query) { await search() }
            .sheet(item: $requesting, onDismiss: { Task { await load() } }) { result in
                RequestSheet(result: result, config: config)
            }
            .alert("Decline this request?", isPresented: Binding(get: { declining != nil }, set: { if !$0 { declining = nil } })) {
                TextField("Reason (optional)", text: $declineReason)
                Button("Decline", role: .destructive) { decline() }
                Button("Cancel", role: .cancel) { declining = nil }
            }
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.system(size: 20, weight: .bold))
            content()
        }
    }

    private func requestGrid(_ requests: [MediaRequest], caption: @escaping (MediaRequest) -> String) -> some View {
        LazyVGrid(columns: columns, spacing: 14) {
            ForEach(requests) { request in
                VStack(alignment: .leading, spacing: 4) {
                    RequestPoster(result: asResult(request), width: nil)
                    Text(caption(request)).font(.caption2).foregroundStyle(Theme.secondary).lineLimit(1)
                }
                .contextMenu {
                    if request.status == "pending" {
                        Button("Cancel request", role: .destructive) {
                            Task {
                                try? await model.accounts?.cancelRequest(request.id)
                                await load()
                            }
                        }
                    }
                }
            }
        }
    }

    private func queueRow(_ request: MediaRequest) -> some View {
        HStack(spacing: 12) {
            Artwork(url: request.poster.flatMap(URL.init(string:)))
                .frame(width: 46, height: 69)
                .clipShape(RoundedRectangle(cornerRadius: 4))
            VStack(alignment: .leading, spacing: 3) {
                Text("\(request.title)\(request.year.map { " (\($0))" } ?? "")").font(.system(size: 15, weight: .semibold))
                Text("\(seasonsText(request)) · asked by \(request.requestedBy)").font(.caption).foregroundStyle(Theme.secondary)
                if request.status == "failed", let reason = request.reason {
                    Text(reason).font(.caption).foregroundStyle(Color(hex: "#e87c03"))
                }
            }
            Spacer()
            Button(request.status == "failed" ? "Try again" : "Approve") { approve(request) }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy == request.id)
            if request.status == "pending" {
                Button("Decline") { declineReason = ""; declining = request }
                    .buttonStyle(GlassPillButtonStyle(height: 38))
            }
        }
        .padding(10)
        .glass(in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // MARK: data

    private func load() async {
        guard let accounts = model.accounts, config?.enabled == true else { return }
        async let mine = accounts.requests()
        async let adminQueue: RequestQueue? = config?.isAdmin == true ? (try? await accounts.requestQueue()) : nil
        do {
            let fresh = try await mine
            withAnimation(.easeOut(duration: 0.25)) { lists = fresh }
        } catch {
            self.error = error.localizedDescription
        }
        let freshQueue = await adminQueue
        withAnimation(.easeOut(duration: 0.25)) { queue = freshQueue }
    }

    private func search() async {
        let term = query.trimmingCharacters(in: .whitespaces)
        guard term.count >= 2, let accounts = model.accounts else {
            results = []
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        let found = (try? await accounts.searchRequests(term)) ?? []
        withAnimation(.easeOut(duration: 0.2)) { results = found }
    }

    private func approve(_ request: MediaRequest) {
        busy = request.id
        Task {
            do {
                try await model.accounts?.approveRequest(request.id)
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
            busy = nil
            await load()
        }
    }

    private func decline() {
        guard let request = declining else { return }
        declining = nil
        Task {
            try? await model.accounts?.declineRequest(request.id, reason: declineReason)
            await load()
        }
    }

    private func seasonsText(_ request: MediaRequest) -> String {
        guard request.type == "tv" else { return "Film" }
        guard let seasons = request.seasons else { return "All seasons" }
        return (seasons.count > 1 ? "Seasons " : "Season ") + seasons.map(String.init).joined(separator: ", ")
    }

    private func asResult(_ request: MediaRequest) -> MediaResult {
        MediaResult(type: request.type, id: request.mediaId, title: request.title, year: request.year,
                    poster: request.poster, state: request.state, progress: request.progress)
    }
}

/// A Sonarr / Radarr poster with its status pill.
struct RequestPoster: View {
    var result: MediaResult
    /// nil fills the width it's given (grids).
    var width: CGFloat?

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            ZStack(alignment: .topLeading) {
                Artwork(url: result.poster.flatMap(URL.init(string:)), placeholder: result.title)
                    .frame(width: width, height: width.map { $0 * 1.5 })
                    .aspectRatio(2 / 3, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
                if let label = RequestState.label(result.state, progress: result.progress) {
                    Text(label)
                        .font(.system(size: 10, weight: .bold))
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Capsule().fill(RequestState.colour(result.state)))
                        .padding(6)
                }
            }
            Text(result.title).font(.system(size: 13, weight: .medium)).lineLimit(1)
            Text([result.year.map(String.init), result.type == "tv" ? "Series" : "Film"].compactMap { $0 }.joined(separator: " · "))
                .font(.caption2).foregroundStyle(Theme.secondary)
        }
        .frame(width: width)
        .foregroundStyle(.white)
    }
}

enum RequestState {
    static func label(_ state: String?, progress: Int?) -> String? {
        switch state {
        case "available": return "In the library"
        case "partial": return "Partly here"
        case "downloading": return progress.map { "Downloading \($0)%" } ?? "Downloading"
        case "processing": return "On its way"
        case "pending": return "Requested"
        case "declined": return "Declined"
        case "failed": return "Couldn't add"
        default: return nil
        }
    }

    static func colour(_ state: String?) -> Color {
        switch state {
        case "available": return Color(hex: "#1f9d55")
        case "partial", "downloading", "processing": return Color(hex: "#2f6fdb")
        case "pending": return Color(hex: "#d97706")
        default: return Color(hex: "#5f5f5f")
        }
    }

    static func canRequest(_ state: String?, type: String) -> Bool {
        state == nil || state == "declined" || state == "failed" || (type == "tv" && state == "partial")
    }
}

/// The request pop-up: details, seasons for shows, and Request.
struct RequestSheet: View {
    var result: MediaResult
    var config: RequestsConfig?
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var seasons: Set<Int> = []
    @State private var busy = false
    @State private var done: MediaRequest?
    @State private var error: String?

    private var allowed: Bool {
        guard let config, config.policy != "off" else { return false }
        return result.type == "movie" ? config.movies : config.tv
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ZStack(alignment: .bottomLeading) {
                    Artwork(url: (result.backdrop ?? result.poster).flatMap(URL.init(string:)))
                        .frame(height: 220)
                        .clipped()
                    LinearGradient(colors: [.clear, Theme.background], startPoint: .center, endPoint: .bottom)
                }
                VStack(alignment: .leading, spacing: 12) {
                    Text(result.title).font(.system(size: 26, weight: .heavy))
                    Text(facts)
                        .font(.callout).foregroundStyle(Theme.secondary)
                    if let label = RequestState.label(done?.state ?? result.state, progress: result.progress) {
                        Text(label).font(.caption.bold()).padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Capsule().fill(RequestState.colour(done?.state ?? result.state)))
                    }
                    if !result.overview.isEmpty { Text(result.overview).font(.system(size: 15)) }
                    if result.type == "tv", let all = result.seasons, all.count > 1, RequestState.canRequest(result.state, type: "tv"), allowed, done == nil {
                        seasonPicker(all)
                    }
                    ErrorNote(message: error)
                    actions
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 30)
            }
        }
        .homeFinBackground()
        .foregroundStyle(.white)
        .presentationBackground(Theme.background)
        .presentationDetents([.medium, .large])
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 560)
        #endif
    }

    private var facts: String {
        var parts: [String] = []
        if let year = result.year { parts.append(String(year)) }
        parts.append(result.type == "tv" ? "Series" : "Film")
        parts += result.genres.prefix(2)
        if let network = result.network { parts.append(network) }
        return parts.joined(separator: " • ")
    }

    private func seasonPicker(_ all: [Int]) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                chip("All seasons", selected: seasons.isEmpty) { seasons = [] }
                ForEach(all, id: \.self) { number in
                    chip("Season \(number)", selected: seasons.contains(number)) {
                        if seasons.contains(number) { seasons.remove(number) } else { seasons.insert(number) }
                    }
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button { withAnimation(Theme.spring) { action() } } label: {
            Text(title)
                .font(.system(size: 14, weight: selected ? .bold : .regular))
                .padding(.horizontal, 14).padding(.vertical, 8)
                .foregroundStyle(selected ? .black : .white)
                .background(Capsule().fill(selected ? Color.white : .clear))
                .overlay(Capsule().stroke(.white.opacity(selected ? 0 : 0.4)))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private var actions: some View {
        if let done {
            Label(done.status == "pending" ? "Requested. You'll see it in Requests once it's approved." : "Requested. It's on its way.",
                  systemImage: "checkmark.circle.fill")
                .foregroundStyle(Color(hex: "#4ade80"))
                .transition(.scale.combined(with: .opacity))
        } else if result.state == "available" {
            Text("Already in the library.").foregroundStyle(Theme.secondary)
        } else if allowed && RequestState.canRequest(result.state, type: result.type) {
            VStack(alignment: .leading, spacing: 8) {
                Button(action: send) {
                    if busy { ProgressView().tint(.white) } else {
                        Label(result.state == "declined" || result.state == "failed" ? "Request again" : "Request", systemImage: "plus")
                    }
                }
                .buttonStyle(BrandButtonStyle())
                .disabled(busy)
                Text(config?.policy == "auto" ? "It starts downloading straight away." : "An admin approves requests before they download.")
                    .font(.caption).foregroundStyle(Theme.secondary)
            }
        } else if config?.policy == "off" {
            Text("Requests are turned off for your profile.").foregroundStyle(Theme.secondary)
        }
    }

    private func send() {
        busy = true
        error = nil
        Task {
            do {
                let request = try await model.accounts?.request(type: result.type, id: result.id, seasons: seasons.isEmpty ? nil : seasons.sorted())
                withAnimation(Theme.spring) { done = request }
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}
