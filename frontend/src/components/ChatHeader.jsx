import { useEffect } from "react";
import { X, Sparkles } from "lucide-react";
import { useAuthStore } from "../store/useAuthStore";
import { useChatStore } from "../store/useChatStore";
import { formatLastSeen } from "../lib/utils";

const ChatHeader = () => {
    const { selectedUser, setSelectedUser, openAsk } = useChatStore();
    const { onlineUsers, lastSeen, fetchPresence } = useAuthStore();

    // Refresh last-seen times when opening / switching a conversation.
    useEffect(() => {
        fetchPresence();
    }, [selectedUser?._id, fetchPresence]);

    const isOnline = onlineUsers.includes(selectedUser._id);

    return (
        <div className="p-2.5 border-b border-base-300">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="avatar">
                        <div className="size-10 rounded-full relative">
                            <img src={selectedUser.profilePic || "/avatar.png"} alt={selectedUser.fullName} />
                        </div>
                    </div>

                    {/* User info */}
                    <div>
                        <h3 className="font-medium">{selectedUser.fullName}</h3>
                        <p className="text-sm text-base-content/70">
                            {isOnline ? "Online" : formatLastSeen(lastSeen[selectedUser._id])}
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={openAsk}
                        className="btn btn-sm btn-ghost gap-1"
                        title="Ask AI about this chat"
                    >
                        <Sparkles className="size-4 text-primary" />
                        <span className="hidden sm:inline">Ask AI</span>
                    </button>
                    <button onClick={() => setSelectedUser(null)} title="Close">
                        <X />
                    </button>
                </div>
            </div>
        </div>
    );
};
export default ChatHeader;