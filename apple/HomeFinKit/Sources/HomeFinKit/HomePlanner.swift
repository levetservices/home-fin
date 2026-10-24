import Foundation

/// One row on Home.
public struct HomeRow: Identifiable, Hashable, Sendable {
    public enum Kind: String, Sendable {
        /// 16:9 cards.
        case landscape
        /// 16:9 cards with a progress bar and episode stills (Continue Watching).
        case progress
        /// Posters with big rank numbers.
        case top10
    }

    public var id: String
    public var title: String
    public var kind: Kind
    public var items: [Item]
}

public struct BillboardReason: Hashable, Sendable {
    public enum Kind: String, Sendable { case top10, new, love, star }
    public var kind: Kind
    public var text: String
}

public struct Billboard: Hashable, Sendable {
    public var item: Item
    public var reasons: [BillboardReason]
}

public struct HomePlan: Sendable {
    public var billboard: Billboard?
    public var rows: [HomeRow]
}

/// What Home is built from (fetched by `HomeLoader`, or made up in tests).
public struct HomeInputs: Sendable {
    public var viewerName: String
    public var resume: [Item] = []
    public var nextUp: [Item] = []
    public var favourites: [Item] = []
    public var catalogue: [Item] = []
    public var recentlyPlayed: [Item] = []
    /// Titles similar to the most recently watched one, and its name.
    public var becauseYouWatched: (title: String, items: [Item])?
    public var trendingSeries: [Item] = []
    public var trendingMovies: [Item] = []
    public var now = Date()

    public init(viewerName: String) {
        self.viewerName = viewerName
    }

    /// The same inputs with only series (and their episodes) or only films: Home's Series and Films pills.
    public func scoped(to scope: HomeScope) -> HomeInputs {
        guard scope != .all else { return self }
        var copy = self
        copy.resume = resume.filter(scope.includes)
        copy.nextUp = nextUp.filter(scope.includes)
        copy.favourites = favourites.filter(scope.includes)
        copy.catalogue = catalogue.filter(scope.includes)
        copy.recentlyPlayed = recentlyPlayed.filter(scope.includes)
        copy.trendingSeries = scope == .films ? [] : trendingSeries
        copy.trendingMovies = scope == .series ? [] : trendingMovies
        if let because = becauseYouWatched {
            let items = because.items.filter(scope.includes)
            copy.becauseYouWatched = items.isEmpty ? nil : (because.title, items)
        }
        return copy
    }
}

/// Netflix's home screen, as rows: same order and limits as the web client (SPEC §7.3), simplified.
public enum HomePlanner {
    static let rowLimit = 20
    static let maxAppearances = 2
    static let newDays: Double = 14

    public static func plan(_ input: HomeInputs) -> HomePlan {
        var counts: [String: Int] = [:]
        var rows: [HomeRow] = []

        func add(_ id: String, _ title: String, _ kind: HomeRow.Kind, _ items: [Item], minimum: Int = 1, limit: Bool = true) {
            var seen = Set<String>()
            var picked: [Item] = []
            for item in items where !seen.contains(item.id) {
                seen.insert(item.id)
                if limit && (counts[item.id] ?? 0) >= maxAppearances { continue }
                picked.append(item)
                if picked.count == rowLimit { break }
            }
            guard picked.count >= minimum else { return }
            for item in picked { counts[item.id, default: 0] += 1 }
            rows.append(HomeRow(id: id, title: title, kind: kind, items: picked))
        }

        // 1. Continue Watching: things in progress, then the next episode of series you're watching.
        let inProgressSeries = Set(input.resume.compactMap(\.seriesId))
        let continuing = input.resume + input.nextUp.filter { !inProgressSeries.contains($0.seriesId ?? "") }
        add("continue", "Continue Watching for \(input.viewerName)", .progress, continuing)

        // 2. The household's Top 10 series (exempt from the "twice at most" rule, like the web).
        add("top10-series", "Top 10 Series on Home Fin Today", .top10, Array(input.trendingSeries.prefix(10)), minimum: 3, limit: false)

        // 3. Because you watched …
        if let because = input.becauseYouWatched {
            add("because", "Because you watched \(because.title)", .landscape, because.items, minimum: 3)
        }

        // 4. My List.
        add("mylist", "My List", .landscape, input.favourites, limit: false)

        // 5. Top 10 films.
        add("top10-movies", "Top 10 Films on Home Fin Today", .top10, Array(input.trendingMovies.prefix(10)), minimum: 3, limit: false)

        // 6. New on Home Fin.
        let newest = input.catalogue
            .filter { isNew($0, now: input.now) }
            .sorted { (date($0.dateCreated) ?? .distantPast) > (date($1.dateCreated) ?? .distantPast) }
        add("new", "New on Home Fin", .landscape, newest, minimum: 3)

        // 7. Genre rows: the genres this viewer watches first, then the biggest ones.
        for genre in genreOrder(input) {
            let matching = input.catalogue.filter { $0.genres?.contains(genre) == true }.sorted(by: betterRated)
            add("genre-\(genre)", genreTitle(genre, matching), .landscape, matching, minimum: 4)
            if rows.count >= 12 { break }
        }

        // 8. Critically acclaimed.
        let acclaimed = input.catalogue.filter { ($0.communityRating ?? 0) >= 7.5 }.sorted(by: betterRated)
        add("acclaimed", "Critically Acclaimed", .landscape, acclaimed, minimum: 4)

        return HomePlan(billboard: billboard(input), rows: rows)
    }

    // MARK: billboard

    /// A title with artwork the viewer hasn't finished, chosen afresh each day: trending and new
    /// titles first, then the best rated. Ties are broken by a daily seed so it changes day to day.
    static func billboard(_ input: HomeInputs) -> Billboard? {
        let candidates = input.catalogue.filter { $0.backdropImageTags?.isEmpty == false && $0.userData?.played != true }
        guard !candidates.isEmpty else { return nil }
        let trendingRank = Dictionary(
            (input.trendingSeries.enumerated().map { ($1.id, $0 + 1) } + input.trendingMovies.enumerated().map { ($1.id, $0 + 1) }),
            uniquingKeysWith: min)
        let seed = dayKey(input.now) + input.viewerName

        func score(_ item: Item) -> Double {
            var value = (item.communityRating ?? 6) / 10
            if let rank = trendingRank[item.id] { value += 1.2 - Double(rank) * 0.08 }
            if isNew(item, now: input.now) { value += 0.5 }
            if item.imageTags?["Logo"] != nil { value += 0.3 }
            return value + jitter(seed + item.id) * 0.6
        }
        guard let pick = candidates.max(by: { score($0) < score($1) }) else { return nil }

        var reasons: [BillboardReason] = []
        if let rank = trendingRank[pick.id] {
            reasons.append(BillboardReason(kind: .top10, text: "No. \(rank) in \(pick.isSeries ? "Series" : "Films") Today"))
        }
        if isNew(pick, now: input.now) { reasons.append(BillboardReason(kind: .new, text: "Recently added")) }
        if reasons.isEmpty, (pick.communityRating ?? 0) >= 7.5 { reasons.append(BillboardReason(kind: .love, text: "Critically acclaimed")) }
        return Billboard(item: pick, reasons: Array(reasons.prefix(2)))
    }

    // MARK: helpers

    static func betterRated(_ a: Item, _ b: Item) -> Bool {
        (a.communityRating ?? 0) > (b.communityRating ?? 0)
    }

    static func genreOrder(_ input: HomeInputs) -> [String] {
        var weight: [String: Double] = [:]
        for item in input.recentlyPlayed + input.favourites + input.resume {
            for genre in item.genres ?? [] { weight[genre, default: 0] += 3 }
        }
        for item in input.catalogue {
            for genre in item.genres ?? [] { weight[genre, default: 0] += 1 }
        }
        return weight.sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }.map(\.key)
    }

    /// "Crime Series", "Comedy Films" or plain "Drama" when it's a mix.
    static func genreTitle(_ genre: String, _ items: [Item]) -> String {
        let series = items.filter(\.isSeries).count
        if series == items.count { return "\(genre) Series" }
        if series == 0 { return "\(genre) Films" }
        return genre
    }

    static func isNew(_ item: Item, now: Date) -> Bool {
        guard let created = date(item.dateCreated) else { return false }
        return now.timeIntervalSince(created) < newDays * 86_400
    }

    static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        // Jellyfin sends 7 fractional digits ("2024-05-01T10:20:30.1234567Z"); trim to what ISO8601 takes.
        let trimmed = value.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)
        return ISO8601DateFormatter().date(from: trimmed.hasSuffix("Z") ? trimmed : trimmed + "Z")
    }

    static func dayKey(_ date: Date) -> String {
        let days = Int(date.timeIntervalSince1970 / 86_400)
        return String(days)
    }

    /// A stable 0…1 number for a string (FNV-1a), so the daily pick doesn't change on every refresh.
    static func jitter(_ text: String) -> Double {
        var hash: UInt32 = 2_166_136_261
        for byte in text.utf8 {
            hash ^= UInt32(byte)
            hash = hash &* 16_777_619
        }
        return Double(hash % 10_000) / 10_000
    }
}

/// Fetches everything Home needs in parallel and plans it.
public struct HomeLoader: Sendable {
    public let jellyfin: JellyfinClient
    public let accounts: AccountsClient?

    public init(jellyfin: JellyfinClient, accounts: AccountsClient?) {
        self.jellyfin = jellyfin
        self.accounts = accounts
    }

    public func load(viewerName: String, scope: HomeScope = .all) async throws -> HomePlan {
        async let resume = jellyfin.resume()
        async let nextUp = jellyfin.nextUp()
        async let favourites = jellyfin.favourites()
        async let catalogue = jellyfin.catalogue()
        async let recent = jellyfin.recentlyPlayed()
        async let trending = optionalTrending()

        var input = HomeInputs(viewerName: viewerName)
        input.resume = try await resume
        input.nextUp = (try? await nextUp) ?? []
        input.favourites = (try? await favourites) ?? []
        input.catalogue = try await catalogue
        input.recentlyPlayed = (try? await recent) ?? []

        if let trending = await trending {
            async let series = jellyfin.items(ids: trending.series.map(\.id))
            async let movies = jellyfin.items(ids: trending.movies.map(\.id))
            input.trendingSeries = (try? await series) ?? []
            input.trendingMovies = (try? await movies) ?? []
        }

        // "Because you watched": the latest played film, or the series of the latest episode.
        if let last = input.recentlyPlayed.first(where: scope.includes) {
            let seedId = last.isEpisode ? (last.seriesId ?? last.id) : last.id
            let title = last.isEpisode ? (last.seriesName ?? last.name ?? "") : (last.name ?? "")
            if let similar = try? await jellyfin.similar(to: seedId), !similar.isEmpty {
                input.becauseYouWatched = (title, similar)
            }
        }
        return HomePlanner.plan(input.scoped(to: scope))
    }

    private func optionalTrending() async -> Trending? {
        guard let accounts else { return nil }
        return try? await accounts.trending()
    }
}
