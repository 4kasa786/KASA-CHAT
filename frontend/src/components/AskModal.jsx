import { useEffect, useState } from "react";
import { Sparkles, X, Loader2, CornerDownLeft } from "lucide-react";
import { useChatStore } from "../store/useChatStore";

const AskModal = () => {
    const {
        askAboutChat,
        askAnswer,
        askSources,
        isAsking,
        askError,
        hasAsked,
        closeAsk,
        goToMessage,
        selectedUser,
    } = useChatStore();
    const [question, setQuestion] = useState("");

    useEffect(() => {
        const onKey = (e) => e.key === "Escape" && closeAsk();
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [closeAsk]);

    const handleSubmit = (e) => {
        e.preventDefault();
        askAboutChat(question);
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-20"
            onClick={closeAsk}
        >
            <div
                className="bg-base-100 w-full max-w-lg rounded-xl shadow-2xl border border-base-300 max-h-[75vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header + question input */}
                <div className="border-b border-base-300">
                    <div className="flex items-center justify-between p-4 pb-2">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                            <Sparkles className="size-4 text-primary" />
                            Ask AI about your chat with {selectedUser?.fullName}
                        </span>
                        <button onClick={closeAsk} className="opacity-60 hover:opacity-100">
                            <X className="size-5" />
                        </button>
                    </div>
                    <form onSubmit={handleSubmit} className="flex items-center gap-2 px-4 pb-4">
                        <input
                            autoFocus
                            type="text"
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            placeholder="e.g. what did we decide about the deadline?"
                            className="flex-1 bg-base-200 rounded-lg px-3 py-2 text-sm outline-none"
                        />
                        <button
                            type="submit"
                            disabled={isAsking || !question.trim()}
                            className="btn btn-sm btn-primary gap-1"
                        >
                            <CornerDownLeft className="size-4" /> Ask
                        </button>
                    </form>
                </div>

                {/* Answer + citations */}
                <div className="overflow-y-auto p-4">
                    {isAsking && (
                        <div className="flex items-center justify-center gap-2 py-8 text-sm opacity-70">
                            <Loader2 className="size-4 animate-spin" /> Thinking...
                        </div>
                    )}

                    {!isAsking && askError && (
                        <div className="py-8 text-center text-sm text-error">{askError}</div>
                    )}

                    {!isAsking && !askError && !hasAsked && (
                        <div className="py-8 text-center text-sm opacity-50">
                            Ask anything about this conversation. The answer comes only from your messages, with sources you can click.
                        </div>
                    )}

                    {!isAsking && !askError && hasAsked && (
                        <>
                            {/* The grounded answer */}
                            <div className="bg-base-200 rounded-lg p-3 text-sm whitespace-pre-wrap">
                                {askAnswer}
                            </div>

                            {/* Citation cards — click to jump to the source message */}
                            {askSources.length > 0 && (
                                <div className="mt-4">
                                    <div className="text-xs font-semibold opacity-60 mb-2">Sources</div>
                                    <div className="flex flex-col gap-2">
                                        {askSources.map((s, i) => (
                                            <button
                                                key={s._id}
                                                onClick={() => goToMessage(s)}
                                                className="w-full text-left p-2.5 rounded-lg border border-base-300 hover:bg-base-200 transition-colors flex gap-2"
                                            >
                                                <span className="text-xs font-semibold text-primary shrink-0">
                                                    [{i + 1}]
                                                </span>
                                                <span className="min-w-0">
                                                    <span className="text-xs opacity-60">{s.senderName}: </span>
                                                    <span className="text-sm line-clamp-2">{s.text}</span>
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AskModal;
