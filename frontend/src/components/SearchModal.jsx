import { useEffect, useState } from "react";
import { Search, X, Loader2, Bot } from "lucide-react";
import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";
import { formatMessageTime } from "../lib/utils";

const SearchModal = () => {
    const {
        searchMessages,
        searchResults,
        isSearching,
        searchError,
        hasSearched,
        closeSearch,
        goToMessage,
        users,
    } = useChatStore();
    const { authUser } = useAuthStore();
    const [query, setQuery] = useState("");

    // Close on Escape.
    useEffect(() => {
        const onKey = (e) => e.key === "Escape" && closeSearch();
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [closeSearch]);

    const handleSubmit = (e) => {
        e.preventDefault();
        searchMessages(query);
    };

    // Who sent a result message — "You", the AI bot, or a contact's name.
    const senderLabel = (result) => {
        if (result.isBot) return "AI Bot";
        if (result.senderId === authUser?._id) return "You";
        return users.find((u) => u._id === result.senderId)?.fullName || "Unknown";
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-20"
            onClick={closeSearch}
        >
            <div
                className="bg-base-100 w-full max-w-lg rounded-xl shadow-2xl border border-base-300 max-h-[70vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Search input */}
                <form onSubmit={handleSubmit} className="flex items-center gap-2 p-4 border-b border-base-300">
                    <Search className="size-5 opacity-60 shrink-0" />
                    <input
                        autoFocus
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search your messages by meaning..."
                        className="flex-1 bg-transparent outline-none text-sm"
                    />
                    <button type="button" onClick={closeSearch} className="shrink-0 opacity-60 hover:opacity-100">
                        <X className="size-5" />
                    </button>
                </form>

                {/* Results */}
                <div className="overflow-y-auto p-2">
                    {isSearching && (
                        <div className="flex items-center justify-center gap-2 py-8 text-sm opacity-70">
                            <Loader2 className="size-4 animate-spin" /> Searching...
                        </div>
                    )}

                    {!isSearching && searchError && (
                        <div className="py-8 text-center text-sm text-error">{searchError}</div>
                    )}

                    {!isSearching && !searchError && hasSearched && searchResults.length === 0 && (
                        <div className="py-8 text-center text-sm opacity-70">
                            No semantically similar messages found.
                        </div>
                    )}

                    {!isSearching && !searchError && !hasSearched && (
                        <div className="py-8 text-center text-sm opacity-50">
                            Try "deadline", "what day is it", or any idea — search finds messages by meaning, not exact words.
                        </div>
                    )}

                    {!isSearching &&
                        searchResults.map((result) => (
                            <button
                                key={result._id}
                                onClick={() => goToMessage(result)}
                                className="w-full text-left p-3 rounded-lg hover:bg-base-200 transition-colors flex flex-col gap-1"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold flex items-center gap-1 opacity-80">
                                        {result.isBot && <Bot className="size-3" />}
                                        {senderLabel(result)}
                                    </span>
                                    <span className="flex items-center gap-2 shrink-0">
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                                            {Math.round(result.score * 100)}% match
                                        </span>
                                        <span className="text-[10px] opacity-50">
                                            {formatMessageTime(result.createdAt)}
                                        </span>
                                    </span>
                                </div>
                                <p className="text-sm line-clamp-2">{result.text}</p>
                            </button>
                        ))}
                </div>
            </div>
        </div>
    );
};

export default SearchModal;
