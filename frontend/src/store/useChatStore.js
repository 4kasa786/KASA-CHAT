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
    }
}))