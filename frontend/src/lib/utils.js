export function formatMessageTime(date) {
    return new Date(date).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}

// "last seen 5 min ago" from a millisecond timestamp (string or number).
export function formatLastSeen(ts) {
    if (!ts) return "Offline";
    const mins = Math.floor((Date.now() - Number(ts)) / 60000);
    if (mins < 1) return "last seen just now";
    if (mins < 60) return `last seen ${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `last seen ${hrs} hr ago`;
    const days = Math.floor(hrs / 24);
    return `last seen ${days} day${days === 1 ? "" : "s"} ago`;
}