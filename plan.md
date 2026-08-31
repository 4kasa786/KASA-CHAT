# Kasa Chat v2 — AI-Augmented Real-Time Messenger

**Goal:** Upgrade Kasa Chat from a standard MERN messenger to a portfolio-grade, AI-augmented chat application that demonstrates production-level backend engineering and modern GenAI integration.

**Why this matters:**
- Learn LLM integration, RAG, embeddings, vector search, Redis patterns — all by building, not tutorials.
- Move resume bullet from "another MERN chat app" to "GenAI-fluent backend engineer" — top 1% positioning for 2026 hiring.
- Every skill is portable: applies to internal tools at Shipsy, future jobs, and side projects.

---

## Final Resume Bullet (Target)

> **Kasa Chat v2 — AI-Augmented Real-Time Messenger** | React | Node.js | MongoDB Atlas | Redis | Socket.IO | Gemini API | transformers.js
>
> - Built real-time chat with `@ai` assistant via Gemini 2.5 Flash, rolling 20-message context window, and **RAG-based semantic search** over chat history using locally-run transformers.js embeddings and MongoDB Atlas `$vectorSearch`.
> - Optimized AI integration with **Redis-backed response cache** (1-hr TTL, normalized question keys) and **per-user sliding-window rate limiter** implemented as an atomic Lua script over sorted sets — cuts redundant Gemini calls under repeat-query load.
> - Implemented **Redis-backed online presence** via TTL'd sets with Socket.IO heartbeat refresh — survives server restarts and supports horizontal scaling across multiple Node processes.

---

## Tech Stack (100% Free)

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Tailwind (existing) | Already in place |
| Backend | Node.js + Express + Socket.IO (existing) | Already in place |
| Database | MongoDB Atlas (free M0) | Already used; vector search included |
| LLM | Google Gemini 2.5 Flash **Lite** | Free tier. `1.5` is retired; `2.0-flash` returns `limit: 0`; `2.5-flash` is only **20 req/day** (hit it during dev). Switched to `gemini-2.5-flash-lite` — much higher daily limit, fine for chat + short RAG answers. |
| Embeddings | `@xenova/transformers` (`all-MiniLM-L6-v2`, 384-dim) | Local, zero API cost |
| Vector Search | MongoDB Atlas `$vectorSearch` | Already using Mongo, no new infra |
| Cache / Rate Limit / Presence | Redis (Docker locally, Upstash free tier in prod) | Industry standard |
| Hosting | Render / Railway free tier | Free, GitHub integration |

**Total monthly cost: ₹0.** No credit card required.

---

## Total Timeline

| Mode | Hours/day | Total time |
|---|---|---|
| Full-time | 6–8 hrs | **8–12 days** |
| Part-time | 2–3 hrs | **2.5–3 weeks** |
| Weekends only | 12 hrs/weekend | **3–4 weekends** |

> **Buffer reality check:** Add ~30% to every phase estimate. Realistic full-time total is **11–16 days**, not 8–12. Atlas index setup, prompt iteration, and first-time Lua scripting always overrun. Plan for the buffer; if you don't need it, ship early.

---

## Decisions Locked (Before Phase 1)

These were ambiguous in v1 of the plan. Locked now to avoid mid-phase wall-hits:

1. **No rooms.** Stay 1-to-1 DM. All "room" wording in this doc means "this DM pair" (sender ↔ receiver). Searches scope to `{$or:[{senderId:me},{receiverId:me}]}`. "Ask AI about this chat" scopes to the currently open DM.
2. **`@ai` lives in the REST controller.** Add the branch inside `backend/src/controllers/message.controller.js` `sendMessage`. Flow: save user message → call `getAIReply()` → save bot message with `isBot:true` → `io.to(receiverSocketId).emit("newMessage", ...)` for both messages.
3. **Bot identity = seeded "AI Bot" user document.** During backend boot, upsert one User doc (`username: "ai-bot"`, `email: "bot@kasa.local"`, random unguessable password it never logs in with). Use its `_id` as `senderId` whenever the bot replies. No schema change. Bot renders like any user; UI overlays a `🤖` badge when `message.isBot === true`.
4. **No streaming.** Cut from Phase 2. Moved to v2 backlog. Ship the request/response version only.
5. **Cache key normalization.** Always hash `normalizeQuestion(text)` — lowercase, trim, collapse whitespace, strip leading `@ai`. One helper in `services/cache.js`.
6. **Rate limiter atomicity.** Sliding-window logic runs as a single Lua script (`EVAL`). One round-trip, fully atomic.
7. **Phase 7 includes a manual eval.** ~~Commit `evals/rag-questions.md`~~ **Amended:** the hand-graded eval lives as a section in `learnings.md` (no separate folder). Done with 6/6 grounded & correct against the seeded chat.
8. **Phase 10 framing.** Replacing in-memory `userSocketMap` with Redis. Honest "why": **survives restarts + works across multiple Node processes** — not "faster."

---

## The "Why" Pattern (Critical — Read Once)

Each phase below has an **Ask AI before coding** block listing the why-questions an interviewer would ask. The loop:

1. **Before coding** — ask AI the listed why-questions. 2-min read budget per question. Don't binge.
2. **Write the code yourself** — no AI for `services/ai.js`, `services/embedding.js`, prompt/retrieval/rate-limit logic (Self-Imposed Rule #4).
3. **After it works** — also ask AI: *"What's the failure mode of this approach?"* and *"What would I switch to at 10× scale?"* These are the senior-level questions.
4. **Write the answer in your own words** in `learnings.md` (root of repo, **committed**). 3–5 bullets per phase. **If you can't write 3 sentences without re-reading AI's answer, you didn't learn it — go back.**

`learnings.md` is the real deliverable. Code = output. Learnings = the skill. Commit it — recruiters and interviewers will read this file before reading your code.

---

## Phased Plan

### Phase 0 — Setup *(1 hour)*

**Goal:** All accounts and tools ready before coding starts.

**Tasks:**
- [ ] Create branch: `feature/ai-integration`
- [ ] Sign up at `aistudio.google.com/apikey` — get free Gemini API key
- [ ] Ensure MongoDB Atlas free cluster exists (or create one)
- [ ] Add `GEMINI_API_KEY` to `.env`
- [ ] Install: `npm install @google/generative-ai`
- [ ] Verify Gemini works with a hello-world test script
- [ ] Add an **AI Bot user seed**: `backend/src/seeds/ai-bot.seed.js` upserts `{ username: "ai-bot", email: "bot@kasa.local", isBot: true }` on boot. Add `isBot` field to the User model. Cache the `_id` in a module-level var for fast reuse.

**Done when:** A test script prints a response from Gemini AND the AI Bot user exists in MongoDB with a known `_id`.

**Resource (15 min read):** [Gemini API Quickstart](https://ai.google.dev/gemini-api/docs/quickstart)

---

### Phase 1 — `@ai` Bot MVP *(5 hours)*

**Goal:** Working AI assistant that replies to `@ai` mentions in any room.

**Learning focus:** LLM API mechanics, request/response loop, stateless model behavior.

**Ask AI before coding (why-questions):**
- Why Gemini 2.5 Flash over OpenAI / Claude / self-hosted Llama-3?
- Why Flash over Gemini Pro for this use case?
- What is a token, exactly? Why does `max_tokens` matter — cost or quality?
- What does "stateless model" mean — why doesn't Gemini remember my last message?

**Ask AI after it works:** What's the failure mode if Gemini is down? What would I switch to at 10× scale?

**Tasks:**
- [ ] Create `services/ai.js` exporting `getAIReply(prompt)`
- [ ] Modify the REST `sendMessage` controller in `backend/src/controllers/message.controller.js`:
  - After saving the user's message, check if `text` starts with `@ai` (case-insensitive, trimmed) — not includes, to avoid false positives like "email @ai team"
  - If yes → call `getAIReply(text)` → save a second message with `senderId = AI_BOT_ID`, `receiverId = <original sender>`, `isBot: true`
  - Emit the bot reply to **both** the sender's and receiver's socket IDs (look up both via `userSocketMap`) so both sides of the DM see it. The original user message already follows the existing emit path — don't duplicate that.
- [ ] Add `isBot: Boolean` field to Message schema (default false)
- [ ] React: render bot bubbles with distinct styling (color + 🤖 avatar overlay when `message.isBot`)

**Learning checkpoint:** *Can I explain what a token is and why max_tokens matters?*

**Done when:** Typing `@ai what's 2+2?` triggers a bot reply within 3 seconds.

**Commit:** `feat(ai): add @ai bot with Gemini integration`

---

### Phase 2 — Conversation Context *(5 hours)* — ✅ COMPLETE

**Goal:** Bot uses recent chat history for context-aware replies.

**Learning focus:** Context windows, system prompts, prompt engineering.

**Ask AI before coding (why-questions):**
- Why N=20 messages of context (not 5, not 100)? What's the cost / quality tradeoff?
- Where in the prompt should system instructions live — start, end, or both? Why?
- What's the cost difference (tokens / latency / ₹) between a 1k-token and a 10k-token prompt?
- Why are LLMs "stateless" if ChatGPT seems to remember our conversation?

**Ask AI after it works:** What's the failure mode if context exceeds the model's window? How would I cap it cleanly?

**Tasks:**
- [x] Modify `getAIReply()` to accept last N messages (N=20)
- [x] Build structured prompt with system role + context + question
- [x] Add error handling: rate limits, timeouts, malformed responses
- [x] Return the full response once Gemini completes — **no streaming** (cut, see Decisions Locked #4)

**Learning checkpoint:** *Why does instruction placement (start vs end of prompt) matter?*

**Done when:** Multi-turn conversation where bot correctly references earlier messages. ✅ **DONE** — verified "my dog is Bruno" → "what's my dog's name?" returns "Bruno", and admits when the fact isn't in history.

**Commit:** `feat(ai): add conversation context to bot replies`

---

### Phase 3 — Embeddings Concept *(2 hours)* — ✅ COMPLETE (concept understood; learning-only, no code)

**Goal:** Build genuine intuition for what embeddings represent before writing pipeline code.

**Learning focus:** Vector representations of meaning.

**Ask AI before coding (why-questions):**
- Why cosine similarity over Euclidean distance over dot product?
- Why 384-dim (MiniLM) and not 768 (BERT-base) or 1536 (OpenAI ada)?
- What is "the curse of dimensionality" — and why doesn't it kill semantic search?
- How is an embedding model trained — what makes "refund" and "money back" map close?

**Ask AI after it works:** Where do embeddings fail? Give me a real example where cosine similarity is high but meaning is opposite.

**Tasks:**
- [ ] Watch one 10-min "What are embeddings?" explainer
- [ ] Run a scratch script comparing cosine similarity of:
  - "refund my money" vs "I want my money back" → expect ~0.85+
  - "refund my money" vs "chocolate cake recipe" → expect ~0.1
- [ ] **See the geometry work with your own eyes.**

**Learning checkpoint:** *Why cosine similarity instead of Euclidean distance?*

**Done when:** You can explain to a friend why "refund" and "money back" produce similar vectors.

---

### Phase 4 — Embed Every Message *(3 hours)* — ✅ COMPLETE (backfill script ready; run it against the DB to finish)

**Goal:** Every chat message stores its embedding alongside text.

**Learning focus:** Local model inference, async pipeline design.

**Ask AI before coding (why-questions):**
- Why MiniLM-L6-v2 specifically — what's the alternative on Hugging Face (BGE, E5, MPNet)?
- Why local inference via transformers.js over the OpenAI Embeddings API?
- What is ONNX and is the model we're using quantized? What does quantization cost in quality?
- Why is the first call ~5s slow and subsequent calls ~50ms? (cold start vs warm)

**Ask AI after it works:** What breaks if I embed messages inline in the save path under heavy write load? When would I move to a queue (BullMQ)?

**Tasks:**
- [x] `npm install @xenova/transformers` (v2.17.2)
- [x] Create `services/embedding.js` with `getEmbedding(text)` helper
- [x] **Warm up the embedding model on server boot** — verified: cold load ~7.3s, warm calls ~2ms.
- [x] Add `embedding: [Number]` field to Message schema
- [x] Modify message-save flow to generate + store embedding inline (user + bot messages)
- [x] Write a one-time backfill script for existing messages (`scripts/backfill-embeddings.js`)

**Learning checkpoint:** *Why local embeddings via transformers.js instead of an API?*

**Done when:** Every message in MongoDB has a 384-dim embedding field. ⚠️ New messages auto-embed now; **run `node scripts/backfill-embeddings.js` once** to cover pre-existing messages.

**Verified:** 384-dim output; cosine sim "refund"↔"money back" = 0.742 vs "refund"↔"cake" = 0.021 (clear semantic separation).

**Commit:** `feat(ai): generate and store embeddings for all messages`

---

### Phase 5 — Vector Search Backend *(5 hours)* — ✅ COMPLETE

**Goal:** Working `/search` endpoint returning semantically similar messages.

**Learning focus:** Vector databases, ANN search, MongoDB Atlas Vector Search.

**Ask AI before coding (why-questions):**
- Why MongoDB Atlas Vector Search over Pinecone / Weaviate / Qdrant / pgvector?
- What does `numCandidates` actually do internally? (HNSW graph traversal)
- What's the recall vs latency tradeoff with `numCandidates`?
- What's ANN ("approximate nearest neighbor") and why don't we just do exact search?
- Why cosine similarity in the index — and what happens if I switch it to dotProduct?

**Ask AI after it works:** What breaks at 1M messages? At 100M? When would I move off Atlas to a dedicated vector DB?

**Tasks:**
- [x] In MongoDB Atlas UI: create vector index `vector_index` on `embedding` field (numDimensions: 384, similarity: cosine) + `senderId`/`receiverId` filter fields
- [x] Build `POST /api/search` endpoint:
  - Embed query text
  - Run `$vectorSearch` aggregation (numCandidates: 100, limit: 5)
  - Return top 5 messages with similarity scores
- [x] Add user-scoped filtering: only match messages where `senderId === me OR receiverId === me` (the DM-pair equivalent — no rooms exist)
- [x] Test with Postman: keyword-free queries return semantically relevant messages

**Learning checkpoint:** *What does `numCandidates` do? Recall vs latency tradeoff?*

**Done when:** Searching "deadline" surfaces "due date" / "submit by" messages with no keyword overlap. ✅ Verified via Postman — "is there anything important" surfaced "On monday i have my meeting" (no keyword overlap), top-5 scored & scoped to the user's own messages.

**Commit:** `feat(search): add semantic search via MongoDB vector search`

---

### Phase 6 — Search UI *(5 hours)* — ✅ COMPLETE

**Goal:** User-facing search bar with clean, navigable results.

**Learning focus:** Connecting AI backend to React, UX for AI features.

**Ask AI before coding (why-questions):**
- Why show similarity scores in the UI vs hide them as an implementation detail?
- Why client-side scroll-to-message vs server-rendered deep link with a hash anchor?
- Should empty-state copy say "no results" or "no semantically similar messages"? Why does precision in AI UX copy matter?

**Tasks:**
- [x] Add search trigger in chat sidebar (modal overlay, not inline bar — chosen for mobile: sidebar is icon-only `w-20` on small screens)
- [x] On submit → call `/api/search` → render results
- [x] Each result shows: message text, sender, timestamp, similarity score (% match). (No "room" — DM-only app.)
- [x] Click result → switch to that conversation + scroll to & highlight the message
- [x] Loading / empty / error states

**Done when:** Demo-able search experience — typing a query surfaces relevant past messages. ✅ Verified in browser (desktop + mobile), incl. cross-conversation click-to-navigate.

**Commit:** `feat(search): add semantic search UI with click-to-navigate`

---

### Phase 7 — RAG Q&A (Killer Feature) *(5 hours)* — ✅ COMPLETE

**Goal:** Ask the AI a question about chat history — get a synthesized answer with citations.

**Learning focus:** RAG pipeline design, prompt construction with retrieved context, grounding.

**Ask AI before coding (why-questions):**
- Why RAG over fine-tuning a model on my chat history?
- What is "groundedness" and how do you measure it without RAGAS?
- What's the difference between retrieval-then-prompt, HyDE, multi-query, and re-ranking RAG patterns?
- Why retrieve K=5 chunks and not K=1 or K=20? Recall vs prompt-bloat tradeoff?
- How do I phrase the prompt so the model cites instead of hallucinating?

**Ask AI after it works:** If the model ignores "only use these messages" and invents an answer, how would I detect it programmatically?

**Tasks:**
- [x] "Ask AI about this chat" button in the chat header (scoped to the currently open DM pair)
- [x] On submit:
  1. Retrieve top-K relevant messages from the current DM pair (reuse Phase 5, filter by `senderId/receiverId ∈ {me, otherUser}`) — `POST /api/search/ask`
  2. Build grounded prompt with retrieved messages (numbered + speaker-labeled, cite-only-these)
  3. Call Gemini → get answer
- [x] Render answer with citation links back to original messages (clickable source cards → `goToMessage`)
- [x] **Manual eval:** kept in `learnings.md` (not a separate `evals/` file). 6/6 grounded & correct against the seeded chat (4 cited answers, 2 correct refusals). See Decisions Locked #7 (amended).

**Learning checkpoint:** *What if the LLM ignores the "use only these docs" rule? How would you detect/prevent it?*

**Done when:** *"What did we decide about the deadline?"* → AI answers correctly with clickable citations. ✅ Verified — "is there anything important on Monday?" → "Yes, you have a meeting on Monday [3]" with clickable source cards; correctly refuses questions not in the chat.

**Commit:** `feat(ai): add RAG-based Q&A over chat history`

**Post-Phase-7 additions (off-plan, deliberately chosen):**
- **Streaming** — RAG answer streams in over SSE (`streamGroundedAnswer` + `fetch`/`ReadableStream` reader); cursor in `AskModal`.
- **Weak-retrieval handling** — drop matches < 0.3 similarity; graceful "nothing relevant" with no Gemini call.
- **Include the bot's replies** in RAG retrieval (scoped via `conversationWith`) — without this, "ask about this chat" missed everything the `@ai` bot had answered. Real correctness fix.
- **Model switch** to `gemini-2.5-flash-lite` after exhausting `2.5-flash`'s 20/day cap; friendly rate-limit messaging.
- **Commit:** `feat(ai): stream RAG answers, include bot replies, handle weak retrievals + rate limits`

---

### Phase 8 — Redis Setup + AI Response Cache *(4 hours)* — ✅ COMPLETE

**Goal:** Cache AI responses to reduce Gemini API calls and learn Redis basics.

**Learning focus:** Redis fundamentals, caching patterns, TTL design.

**Ask AI before coding (why-questions):**
- Why Redis over an in-process LRU cache (e.g., `lru-cache` npm)?
- Why hash with SHA-256 instead of using the raw question as the key?
- Why 1-hour TTL — not 5 min, not 24 hr? What signals would push you each way?
- Compare cache-aside vs read-through vs write-through. Which one am I building?
- What is "cache stampede" and would my code suffer from it?

**Ask AI after it works:** What breaks if Redis goes down — does my app fall back gracefully? Should it?

**Tasks:**
- [x] Run local Redis via Docker — **on port 6380** (`-p 6380:6379`), since 6379 was taken by another project's Redis
- [x] `npm install ioredis`
- [x] Create `services/cache.js` with `getCachedAnswer`, `setCachedAnswer(text, answer, ttlSec)`, and `normalizeQuestion(text)` helpers
- [x] `normalizeQuestion`: lowercase → strip leading `@ai` → collapse `\s+` → trim
- [x] In `getAIReply()`: `sha256(normalizeQuestion(text))` → check cache → call Gemini only on miss
- [x] Cache with 1-hour TTL (`SET ... EX 3600`)
- [x] Log cache hits/misses + graceful fallback if Redis is down (`commandTimeout` + try/catch)

**Redis primitives learned:** `GET`, `SET EX`, key namespacing.

**Done when:** Asking `@ai what's 2+2?` twice in a row results in only one Gemini API call (visible in logs). ✅ Verified: repeat question → cache HIT in ~3ms (vs ~1300ms cold), zero Gemini call; key has ~3600s TTL. (Known tradeoff: key is question-only, ignores history — see learnings.)

**Commit:** `feat(redis): add response cache for AI replies`

---

### Phase 9 — Rate Limiter on `@ai` *(3 hours)* — ✅ COMPLETE

**Goal:** Per-user sliding-window rate limit (5 `@ai` calls per minute) using Redis.

**Learning focus:** Atomic ops, rate-limiting algorithms, distributed counters.

**Ask AI before coding (why-questions):**
- Compare sliding window vs token bucket vs leaky bucket vs fixed window. Why pick sliding window here?
- Why Lua `EVAL` over a `MULTI`/`EXEC` transaction? What's actually different about atomicity?
- What happens if Redis crashes mid-Lua-script? Is half-executed state possible?
- Why sorted sets (`ZADD` + `ZCARD`) instead of a counter + reset cron?
- Could I do this without Redis (purely in Node memory)? Why is that wrong?

**Ask AI after it works:** What's the failure mode if a user opens 5 tabs? What if I run 3 Node processes — does the limit hold per process or globally?

**Tasks:**
- [x] Implement sliding-window rate limiter as a **single Lua script** (`ZREMRANGEBYSCORE` → `ZCARD` → conditional `ZADD` + `PEXPIRE`) in `services/rateLimit.js`:
  - One round-trip via `EVAL` — fully atomic, no race between concurrent `@ai` calls
  - Returns `{ allowed, retryAfterSec }`
  - If count ≥ 5 → reject
- [x] User-facing error in chat: *"You're messaging @ai too fast — slow down and try again in N seconds."* (posted as a bot message; skips history + Gemini)
- [x] Burst-tested: 7 calls → first 5 allowed, 6th+ rejected ✅
- [x] Fail-open if Redis is down (don't block users on a limiter outage)

**Redis primitives learned:** `ZADD`, `ZREMRANGEBYSCORE`, `ZCARD`, `PEXPIRE`, atomic Lua `EVAL`.

**Done when:** 6th `@ai` call within 60 seconds is rejected with a clear message. ✅ Verified via burst test.

**Commit:** `feat(redis): add sliding-window rate limiter for @ai`

---

### Phase 10 — Online Presence *(5 hours)* — ✅ COMPLETE

**Goal:** Replace the in-memory `userSocketMap` in `backend/src/lib/socket.js` with Redis-backed presence. **This is a refactor of working code.** Honest "why": survives server restart and works across multiple Node processes — NOT "faster" (the in-memory version is already instant).

**Learning focus:** TTL-based liveness, sets, heartbeat patterns, why shared state matters at scale.

**Ask AI before coding (why-questions):**
- Why TTL'd Redis sets over a plain `SET` per user?
- Socket.IO already pings every 25s — why add a separate client heartbeat? When does each matter?
- What breaks if I run 2 Node processes with the current in-memory `userSocketMap`? Walk through the bug.
- Why `SADD`/`SREM` (set) vs a `HASH` of userId → lastSeen? When would you pick each?
- What's the right TTL — 30s, 60s, 5 min? What signals make you pick?

**Ask AI after it works:** If Redis dies, do users appear offline or online? Which is the safer default and why?

**Tasks:**
- [x] On connect/heartbeat: record presence in Redis — **sorted set** `presence:heartbeats` (score = last-seen ms) + hash `presence:lastseen`. *(Used a sorted set, not `SADD online_users` + `EXPIRE`: Redis can't TTL individual set members; the sorted-set score gives per-user liveness AND last-seen in one structure.)*
- [x] On disconnect: `ZREM` from heartbeats (immediate offline) + update lastseen
- [x] Heartbeat from client every 30s (socket `emit("heartbeat")`) → refreshes the 35s liveness window
- [x] `GET /api/presence` returns `{ online, lastSeen }`
- [x] UI: green dot for online, "last seen 5 min ago" for offline (ChatHeader + `formatLastSeen`)
- [x] **Kept `userSocketMap` for message routing** (socket IDs are process-local; only presence moved to Redis)

**Done when:** Two browser windows show both users online; closing one shows offline within ~30s. *(Backend verified: cross-process presence confirmed — a user on one server process showed online via `/api/presence` on a second process.)*

**Redis primitives learned:** `SADD`, `SREM`, `SMEMBERS`, `EXPIRE`, heartbeat patterns.

**Done when:** Opening two browser windows shows both users as online; closing one shows offline within ~30s.

**Commit:** `feat(redis): add online presence tracking`

---

### Phase 11 — Polish, Deploy, Showcase *(4 hours)*

**Goal:** Production-ready demo for recruiters.

**Tasks:**
- [ ] Update README with:
  - Architecture diagram (Mermaid or Excalidraw)
  - Feature list with GIFs
  - Tech stack and rationale
  - "How RAG works" walkthrough
- [ ] Record 60-second demo video (Loom, free)
- [ ] Deploy backend to Render/Railway free tier
- [ ] Deploy frontend to Vercel/Netlify free tier
- [ ] Migrate Redis to Upstash free tier for production
- [ ] Pin repo on GitHub profile
- [ ] Update resume with new bullet
- [ ] LinkedIn post about the build

**Done when:** A stranger can clone the repo, follow the README, and have it running in under 5 minutes; OR open the deployed link and try it live.

**Commit:** `docs: add README, architecture diagram, demo video`

---

## Skills Acquired by End

### Tier 1 — High long-term value
- LLM API integration patterns (auth, tokens, context windows, error handling)
- Embeddings & vector search (cosine similarity, ANN, dimension tradeoffs)
- RAG pipeline design (retrieval → augment → generate, grounding)
- Redis fundamentals (key-value, TTL, sorted sets, atomic ops)
- Caching patterns (cache-aside, TTL design, cache invalidation)
- Rate limiting algorithms (sliding window via sorted sets)

### Tier 2 — Solid backend skills
- Prompt engineering (instruction order, role setting, output constraints)
- Hallucination grounding (RAG, strict prompts, citations)
- Multi-service orchestration (Mongo + Gemini + transformers.js + Redis)
- Production AI concerns (rate limits, cost monitoring, fallbacks)

### Tier 3 — Project-specific
- MongoDB Atlas Vector Search (`$vectorSearch`, index config)
- Local model inference with transformers.js / ONNX
- Sliding-window vs token-bucket rate limiting tradeoffs
- TTL-based presence tracking with heartbeat

---

## Self-Imposed Rules (Critical)

1. **Build dumb first, optimize later.** Inline embed-on-save before async queues. Wait-for-full-response before streaming.
2. **30-min concept budget per phase.** Read just enough to start coding. No 3-hour pre-reading binges.
3. **15-min reflection per phase.** Write what broke, what surprised you, what you now understand. The notes are the actual learning.
4. **The AI usage contract:**
   - ✅ Use Cursor / Claude Code for: Mongoose schemas, Express boilerplate, Tailwind styling, Socket.IO event wiring, README sections
   - ❌ Write yourself: `services/ai.js`, `services/embedding.js`, prompt construction, retrieval logic, rate-limiter logic, anything in the AI/RAG/Redis pipelines
5. **Demo every phase to yourself.** Record a 20s screen capture each time. Ends with free demo footage.
6. **Time-box ruthlessly.** If 50% over budget on a phase — simplify scope and ship. Working dumb > half-built smart.
7. **Commit at the end of every phase.** No "I'll commit when it's all done."
8. **Explain it to a wall.** Before moving to the next phase, explain what you built out loud, no notes. If you stumble — re-read your code — try again.
9. **Update `learnings.md` at the end of every phase.** 3–5 bullets in your own words answering that phase's why-questions. If you can't write them without re-reading AI's answer, you didn't learn it. Recruiters will read this file before reading your code.

---

## Resource Index (Use Just-in-Time, Not Up-Front)

| Phase | Resource | Time |
|---|---|---|
| 0 | [Gemini API Quickstart](https://ai.google.dev/gemini-api/docs/quickstart) | 15 min |
| 1 | Karpathy's "Intro to LLMs" (YouTube, first 30 min only) | 30 min |
| 2 | Google's prompt engineering guide | 30 min |
| 3 | Any "What are embeddings?" 10-min video | 10 min |
| 4 | [transformers.js docs](https://huggingface.co/docs/transformers.js) | 15 min |
| 5 | [MongoDB Atlas Vector Search docs](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-overview/) | 20 min |
| 7 | Any "What is RAG?" 5-min explainer | 5 min |
| 8 | [Redis data types overview](https://redis.io/docs/data-types/) | 20 min |
| 9 | Article: "Rate limiting with Redis sorted sets" | 15 min |
| 10 | Redis SET + TTL patterns docs | 10 min |
| 11 | [Mermaid syntax for diagrams](https://mermaid.js.org/) | 15 min |

**Total reading/watching: ~3 hours across the entire project.** Everything else is hands-on.

---

## Definition of "Project Complete"

A stranger (recruiter, interviewer, friend) should be able to:

1. Open the deployed link → use the chat → see all features working
2. Open the GitHub repo → understand the architecture from the README in 5 min
3. Read the resume bullet → recognize this as a top-tier project
4. Ask any question about the implementation → you can answer without notes

If all four hold → done.

---

## Risk Register (Honest)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Perfectionism stretches timeline 2x | High | Hard time-caps per phase |
| Letting AI tools write the AI logic | Medium | Strict usage contract above |
| Skipping reflection because "I get it" | High | Force the 15-min note per phase |
| Atlas Vector Search index setup confusion | Medium | Allocate 2 hrs explicitly in Phase 5 |
| Free tier rate limits during development | Low | Cache (Phase 8) reduces calls; Gemini free tier is generous |
| Scope creep into agents / multi-turn tool use | Medium | Stop at Phase 11. v2 features are NOT in scope. |

---

## Out of Scope (v2 Backlog — Do NOT Build Now)

These are tempting but would balloon the timeline. Park them.

- ❌ Multi-agent orchestration / tool use
- ❌ Fine-tuning a model
- ❌ BullMQ async embedding queue
- ❌ Socket.IO Redis adapter for horizontal scaling
- ❌ End-to-end encryption
- ❌ Voice messages / Whisper integration
- ❌ Image generation in chat
- ❌ Hybrid keyword + vector search reranking
- ❌ Evaluation / RAGAS framework (manual eval in Phase 7 only)
- ⚠️ ~~Token streaming via SSE for bot replies (cut from Phase 2)~~ **Re-added (off-plan):** RAG answers stream via SSE in the Ask AI panel. The `@ai` chat-bubble replies are still non-streaming.
- ❌ Group rooms / multi-user channels (DM-only)

If any of these become genuinely necessary — revisit after the v1 ships.

---

## Next Action

**Tonight (1 hour):** Complete Phase 0.
**Tomorrow:** Begin Phase 1.

Stop deliberating. Start building.
