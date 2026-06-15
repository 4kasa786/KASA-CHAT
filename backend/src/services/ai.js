import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// System instructions live at the top of the prompt (highest priority for the model).
const SYSTEM_INSTRUCTION = `You are @ai, a concise and helpful assistant inside a 1-to-1 chat.
Use the conversation history below for context when answering.
Only answer the most recent question — do not reply to older messages.
If the history does not contain the answer, say so honestly instead of guessing.
Keep replies short and conversational.`;

const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    systemInstruction: SYSTEM_INSTRUCTION,
});

// RAG (Phase 7): answer strictly from retrieved messages, with citations.
const RAG_SYSTEM_INSTRUCTION = `You answer questions about a chat conversation.
Use ONLY the numbered context messages provided. Do not use any outside knowledge.
If the answer is not present in the context, reply exactly: "I couldn't find that in your chat."
When you use a message, cite it inline like [1] or [2].
Keep the answer short and direct.`;

const ragModel = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    systemInstruction: RAG_SYSTEM_INSTRUCTION,
});

const MAX_TRANSCRIPT_CHARS = 6000; // rough guard so a long history can't blow the context window
const GEMINI_TIMEOUT_MS = 15000;

// Turn [{ name, text }] history into a labeled transcript, dropping the OLDEST
// lines first if it exceeds the char budget (keep the most recent context).
const buildTranscript = (history = []) => {
    const lines = history
        .filter((m) => m && m.text)
        .map((m) => `${m.name}: ${m.text}`);

    while (lines.length > 0 && lines.join("\n").length > MAX_TRANSCRIPT_CHARS) {
        lines.shift();
    }
    return lines.join("\n");
};

// question: the user's message with the leading "@ai" already stripped.
// history: chronological [{ name, text }] of the recent DM (may be empty).
export const getAIReply = async (question, history = []) => {
    const transcript = buildTranscript(history);
    const prompt = transcript
        ? `Conversation so far:\n${transcript}\n\nLatest question: ${question}`
        : `Latest question: ${question}`;

    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error("Gemini request timed out")),
            GEMINI_TIMEOUT_MS
        );
    });

    try {
        const result = await Promise.race([model.generateContent(prompt), timeout]);
        // .text() throws if the response was blocked by safety filters — let it
        // propagate so the controller's catch returns a friendly fallback.
        return result.response.text();
    } finally {
        clearTimeout(timer);
    }
};

// RAG answer (Phase 7). sources: [{ senderName, text }] already retrieved & ranked.
// Returns an answer grounded ONLY in those messages, with [n] citations.
export const getGroundedAnswer = async (question, sources = []) => {
    if (!sources.length) return "I couldn't find that in your chat.";

    // Number each source so the model can cite [1], [2], ... and label the speaker.
    const context = sources
        .map((s, i) => `[${i + 1}] ${s.senderName || "Unknown"}: ${s.text}`)
        .join("\n");

    const prompt = `Context messages:\n${context}\n\nQuestion: ${question}`;

    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error("Gemini request timed out")),
            GEMINI_TIMEOUT_MS
        );
    });

    try {
        const result = await Promise.race([ragModel.generateContent(prompt), timeout]);
        return result.response.text();
    } finally {
        clearTimeout(timer);
    }
};

// Streaming variant (Phase 7+ streaming). Returns Gemini's async-iterable chunk
// stream; the controller forwards each chunk to the client over SSE.
export const streamGroundedAnswer = async (question, sources = []) => {
    const context = sources
        .map((s, i) => `[${i + 1}] ${s.senderName || "Unknown"}: ${s.text}`)
        .join("\n");
    const prompt = `Context messages:\n${context}\n\nQuestion: ${question}`;

    const result = await ragModel.generateContentStream(prompt);
    return result.stream; // async iterable of response chunks; each has .text()
};
