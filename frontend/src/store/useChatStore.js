import { create } from 'zustand';
import toast from 'react-hot-toast';
import { axiosInstance } from '../lib/axios.js';
import { useAuthStore } from './useAuthStore.js';

export const useChatStore = create((set, get) => ({
    messages: [],
    users: [],
    selectedUser: null,
    isUsersLoading: false,
    isMessagesLoading: false,

    // --- Semantic search (Phase 6) ---
    searchResults: [],
    isSearching: false,
    searchError: null,
    hasSearched: false,
    isSearchOpen: false,
    scrollToMessageId: null,


    getUsers: async () => {
        set({ isUsersLoading: true });
        try {
            const response = await axiosInstance.get('/messages/users');
            set({ users: response.data });

        } catch (err) {
            console.log("Error in getUsers:", err);
            toast.error(err.response?.data?.message || "Error fetching users");
        } finally {
            set({ isUsersLoading: false });
        }
    },
    getMessages: async (userId) => {
        set({ isMessagesLoading: true });
        try {
            const response = await axiosInstance.get(`/messages/${userId}`);
            set({ messages: response.data });
        } catch (err) {
            toast.error(err.response?.data?.message || "Error fetching messages");
        } finally {
            set({ isMessagesLoading: false });
        }
    },
    sendMessage: async (messageData) => {
        const { selectedUser } = get();
        try {
            const response = await axiosInstance.post(`/messages/send/${selectedUser._id}`, messageData);
            set((state) => ({ messages: [...state.messages, response.data] }));

        } catch (err) {
            toast.error(err.response?.data?.message || "Error sending message");

        }

    },

    subscribeToMessages: () => {
        if (!get().selectedUser) return;

        const socket = useAuthStore.getState().socket;

        socket.on("newMessage", (newMessage) => {
            const { selectedUser } = get();
            if (!selectedUser) return;
            const isFromSelectedUser = newMessage.senderId === selectedUser._id;
            const isBotInCurrentChat = newMessage.isBot === true && newMessage.conversationWith === selectedUser._id;
            if (!isFromSelectedUser && !isBotInCurrentChat) return;
            set((state) => ({ messages: [...state.messages, newMessage] }));
        });
    },

    unsubscribeFromMessages: () => {
        const socket = useAuthStore.getState().socket;
        socket.off("newMessage");

    },

    setSelectedUser: (selectedUser) => {
        set({ selectedUser });
    },

    // --- Semantic search actions (Phase 6) ---
    openSearch: () => set({ isSearchOpen: true }),
    closeSearch: () =>
        set({ isSearchOpen: false, searchResults: [], searchError: null, hasSearched: false }),

    searchMessages: async (query) => {
        if (!query.trim()) {
            set({ searchResults: [], searchError: null, hasSearched: false });
            return;
        }
        set({ isSearching: true, searchError: null });
        try {
            const response = await axiosInstance.post('/search', { query });
            set({ searchResults: response.data, hasSearched: true });
        } catch (err) {
            set({ searchError: err.response?.data?.error || "Search failed. Please try again." });
        } finally {
            set({ isSearching: false });
        }
    },

    // Click a search result → open that conversation and flag the message to scroll to.
    goToMessage: (result) => {
        const { users } = get();
        const myId = useAuthStore.getState().authUser?._id;

        // Figure out the "other" person in that message's conversation.
        let otherId;
        if (result.isBot) otherId = result.conversationWith;
        else otherId = result.senderId === myId ? result.receiverId : result.senderId;

        const otherUser = users.find((u) => u._id === otherId);
        if (!otherUser) {
            toast.error("Couldn't open that conversation");
            return;
        }

        set({
            selectedUser: otherUser,
            scrollToMessageId: result._id,
            isSearchOpen: false,
            searchResults: [],
            hasSearched: false,
        });
    },

    setScrollToMessageId: (id) => set({ scrollToMessageId: id }),
}))