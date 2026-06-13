import { useChatStore } from "../store/useChatStore";
import { useEffect, useRef } from "react";

import ChatHeader from "./ChatHeader";
import MessageInput from "./MessageInput";
import MessageSkeleton from "./skeletons/MessageSkeleton";
import { useAuthStore } from "../store/useAuthStore";
import { formatMessageTime } from "../lib/utils";

const ChatContainer = () => {
    const {
        messages,
        getMessages,
        isMessagesLoading,
        selectedUser,
        subscribeToMessages,
        unsubscribeFromMessages,
        scrollToMessageId,
        setScrollToMessageId,
    } = useChatStore();
    const { authUser } = useAuthStore();
    const messageEndRef = useRef(null);

    useEffect(() => {
        getMessages(selectedUser._id);

        subscribeToMessages();

        return () => unsubscribeFromMessages();
    }, [selectedUser._id, getMessages, subscribeToMessages, unsubscribeFromMessages]);

    useEffect(() => {
        // If we arrived here from a search result, don't auto-scroll to the bottom —
        // the effect below scrolls to the matched message instead.
        if (scrollToMessageId) return;
        if (messageEndRef.current && messages) {
            messageEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages, scrollToMessageId]);

    // Scroll to and briefly highlight a message opened from search.
    useEffect(() => {
        if (!scrollToMessageId || isMessagesLoading) return;
        const el = document.getElementById(`msg-${scrollToMessageId}`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-primary", "rounded-lg");
        const timer = setTimeout(() => {
            el.classList.remove("ring-2", "ring-primary", "rounded-lg");
            setScrollToMessageId(null);
        }, 2000);
        return () => clearTimeout(timer);
    }, [scrollToMessageId, messages, isMessagesLoading, setScrollToMessageId]);

    if (isMessagesLoading) {
        return (
            <div className="flex-1 flex flex-col overflow-auto">
                <ChatHeader />
                <MessageSkeleton />
                <MessageInput />
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-auto">
            <ChatHeader />

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((message) => (
                    <div
                        key={message._id}
                        id={`msg-${message._id}`}
                        className={`chat ${message.isBot || message.senderId !== authUser._id ? "chat-start" : "chat-end"}`}
                        ref={messageEndRef}
                    >
                        <div className="chat-image avatar">
                            <div className="size-10 rounded-full border">
                                {message.isBot ? (
                                    <div className="size-10 rounded-full bg-purple-600 flex items-center justify-center text-white text-lg">
                                        🤖
                                    </div>
                                ) : (
                                    <img
                                        src={
                                            message.senderId === authUser._id
                                                ? authUser.profilePic || "/avatar.png"
                                                : selectedUser.profilePic || "/avatar.png"
                                        }
                                        alt="profile pic"
                                    />
                                )}
                            </div>
                        </div>
                        <div className="chat-header mb-1">
                            {message.isBot && (
                                <span className="text-xs font-semibold text-purple-400 mr-1">AI Bot</span>
                            )}
                            <time className="text-xs opacity-50 ml-1">
                                {formatMessageTime(message.createdAt)}
                            </time>
                        </div>
                        <div className={`chat-bubble flex flex-col ${message.isBot ? "bg-purple-700 text-white" : ""}`}>
                            {message.image && (
                                <img
                                    src={message.image}
                                    alt="Attachment"
                                    className="sm:max-w-[200px] rounded-md mb-2"
                                />
                            )}
                            {message.text && <p>{message.text}</p>}
                        </div>
                    </div>
                ))}
            </div>

            <MessageInput />
        </div>
    );
};
export default ChatContainer;