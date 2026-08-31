# Kasa Chat v2 — Learnings

---

## Phase 0 — Setup

- **API keys are like house keys — whoever holds it IS you.** I leaked my first Gemini key in a screenshot. Anyone with that key could have hit Google's API on my project and burned through my quota. The fix wasn't to "be careful next time" — leaked is leaked. I deleted the key in Google AI Studio and made a new one. Now my rule: secrets go from where they're generated → directly into `.env`, with zero stops in between. No screenshots, no chat messages, no Slack.
- **The AI bot is just a regular `User` with `isBot: true` — not a new model.** I almost made a separate `Bot` collection. Then I realised every message would need an "if bot, do this / if user, do that" branch in sender lookup, DM-pair queries, and chat rendering. Adding one boolean field to `User` meant the whole existing chat pipeline (`senderId`, message refs, UI) just works for the bot too. One field saved me from a tangle of special-case code. The lesson: before making a new model, check if it's just a *property* of an existing one.
- **The bot is created automatically every time the server starts, not by a manual script.** My `ai-bot.seed.js` runs from `index.js` right after `connectDB()`. It uses an upsert, so running it 100 times = running it once. Why this matters: if I reset the DB or deploy to a new environment, I never have to remember to "run the bot seed." The server makes sure its own dependencies exist. And the bot's `_id` gets cached in a module-level variable at boot, so every `@ai` message uses memory instead of hitting Mongo. One DB lookup at startup vs thousands at runtime.

---

## Phase 1 — `@ai` Bot MVP

- **Why Gemini over OpenAI/Claude/Llama?** Gemini Flash has a free tier that doesn't need a credit card — perfect for a side project. OpenAI and Claude require billing setup. Self-hosted Llama-3 needs a GPU which costs money or kills your laptop. Gemini Flash specifically over Gemini Pro because Flash is faster and cheaper — for a simple chat bot that answers short questions, Pro's extra quality isn't worth the cost or latency.

- **What is a token and why does it matter?** A token is roughly 4 characters or 0.75 words. "Hello world" = 2 tokens. Models charge per token (input + output). `max_tokens` limits how long the reply can be — it's both a cost control AND a quality control. If you don't set it, the model might ramble. If you set it too low, answers get cut off mid-sentence.

- **What does stateless model mean?** Gemini has no memory between API calls. Every call is a fresh conversation. It doesn't know what you asked 5 seconds ago unless YOU include that history in the new request. ChatGPT "remembers" only because the app secretly sends your entire chat history with every message — the model itself still sees a fresh prompt each time.

- **The race condition bug we fixed.** The backend was calling Gemini BEFORE sending the HTTP response back. So the socket (bot reply) and the HTTP response (user's own message) arrived at the browser at the same millisecond. React + Zustand got two state updates simultaneously, batched them, and the second one overwrote the first — bot message got lost. Fix: respond via HTTP immediately, run Gemini in the background, push bot reply via socket 4 seconds later. Two events now separated in time — no collision possible.

- **Respond fast, process slow.** Never block your HTTP response waiting for a slow external API. Respond to the user immediately with what you have, do the heavy work in the background, push the result when it's ready. This is how every production AI feature works — the "typing..." indicator exists because of exactly this pattern.

---

## Phase 2 — Conversation Context

- **Why N=20 messages of context and not 5 or 100?** More context = more tokens = more cost and slower response. Less context = bot forgets important things said earlier. 20 is the sweet spot — enough history to make replies feel connected, not so much that every request gets expensive. At 100 messages you're paying for a lot of irrelevant old chat that doesn't help the answer.

- **Why is the model stateless?** Gemini stores nothing between API calls. Every call is completely independent — a blank slate. ChatGPT only "remembers" because the app secretly sends your entire chat history with every single message. The model itself has no memory. This is why Phase 2 exists — we have to manually send history ourselves.

- **1k-token vs 10k-token prompt cost?** 10x more tokens = 10x more cost + noticeably slower response. At 10k tokens you also risk hitting the model's context window limit and getting an error. Smaller prompts are faster, cheaper, and more focused — the model doesn't have to wade through irrelevant content to find the answer.

- **Where should system instructions live in the prompt?** At the start. Models pay more attention to instructions that come before the content. Putting "you are a helpful assistant, only use the provided messages" at the end means the model has already formed its approach before reading the rule.

- **What if context exceeds the model's window?** The API throws an error. Clean fix: always slice to the last N messages before building the prompt, so you never accidentally send more than the limit allows.

- **Why I send history as a labeled transcript instead of Gemini's native chat roles.** Gemini's built-in `user`/`model` role format assumes a 2-party conversation (one human, one AI). But my chat is 3-party: two humans plus the bot. If I forced it into the native format, both humans collapse into the "user" role and the bot loses track of *who said what* — it couldn't answer "who agreed to the deadline?". So I build a labeled transcript ("Sarvesh: …", "Priya: …", "AI: …") in a single prompt. The default format literally can't represent my case; the labeled transcript can. Strongest decision in this phase.

---

## Phase 3 — Embeddings Concept

- **An embedding turns text into a list of numbers that represents its meaning.** My mental model: it's like a GPS coordinate, but instead of 2 numbers placing you on a map, it's 384 numbers placing the *meaning* of a sentence in a giant invisible "meaning space." The whole point: sentences that mean similar things land close together in that space. The computer doesn't understand English — it learned from reading billions of sentences that "refund" and "money back" show up in similar contexts, so it places them near each other.

- **Why cosine similarity and not Euclidean distance?** Cosine measures the *angle* between two vectors (their direction), not how far apart they are. For meaning, direction is what matters — a short message and a long message about the same topic point the same way even if their raw magnitudes differ. Also, because I normalize the vectors to unit length, cosine similarity becomes a plain dot product — same answer, less math. Euclidean distance would get thrown off by length/magnitude differences that don't actually mean anything.

- **Why 384 dimensions and not 768 or 1536?** More dimensions can capture more nuance but cost more storage and slower similarity math. 384 (MiniLM) is the sweet spot for short chat messages — plenty of room to separate meanings, cheap to store and compare. 768 (BERT-base) or 1536 (OpenAI ada) are overkill here and just make every search slower.

- **The big limitation I saw with my own eyes: embeddings capture topic, not agreement.** I tested "I am available Friday" vs "I am NOT available Friday" → they scored **0.852** — basically identical — even though they mean the exact opposite. The single "not" barely moved the vector because the model sees the same topic (my Friday availability). Meanwhile genuinely unrelated text ("chocolate cake recipe") dropped to 0.15. So embeddings are great at "are these about the same thing?" and bad at "do these agree?" — negation and sentiment barely register.

- **Why this doesn't break the project:** the fix isn't better embeddings, it's letting the LLM do the reasoning later (RAG, Phase 7). Embeddings handle *recall* (find everything on-topic, including contradictions); the LLM handles *judgment* (read them and resolve the conflict). Two different jobs for two different tools.

---

## Phase 4 — Embed Every Message

- **Why run the model locally (transformers.js) instead of OpenAI's embedding API?** Three reasons: cost — local is free vs paying per token; privacy — chat content never leaves my server; latency — no network round-trip, ~2ms once warm. The tradeoff is I host the model myself, paying a memory and cold-start cost. For embedding short chat messages, local wins easily. At huge scale the API's managed infra might be worth paying for.

- **Why MiniLM-L6-v2 specifically?** Small, fast, 384-dim. Bigger models (BGE, E5, MPNet) score higher on benchmarks but are slower and heavier — overkill for short messages. I sized the model to the task instead of grabbing the biggest one. It runs via ONNX (a portable model format) and is quantized — weights stored in lower precision so it's smaller and faster, at a tiny, unnoticeable quality cost for my use case.

- **Cold start vs warm — the thing I actually measured.** The first embedding took **~7.3 seconds** because the ~90MB model has to load into memory; every call after was **~2ms**. So I warm up the model on server boot with one throwaway embedding ("hello") — the slow load happens before any user connects, so no real request ever eats that 7s. Loading the model once and reusing it (caching the pipeline promise) is the key — loading per-call would be unusable.

- **Inline embed-on-save, and knowing where it breaks.** I generate the embedding inline in the message-save path — a deliberate "build simple first" choice. It adds ~2ms per message, negligible at my scale. Under heavy write load it becomes a bottleneck because every save now blocks on inference. The fix at that point is a background queue (BullMQ): save the message instantly, embed asynchronously, fill in the vector after. I built the simple version but I know exactly when and why I'd move to a queue.

- **One normalize trick worth remembering:** I normalize vectors to unit length at embed time, so later the cosine similarity in search reduces to a plain dot product. Small thing, but it means the search math is cheaper and the Atlas index just uses cosine consistently.

- **The save path also needed a safety net:** embedding is wrapped in try/catch so a model hiccup logs an error but never blocks the message from sending. A failed embedding just means that message isn't searchable until the backfill — the user's message still goes through. And the backfill script is idempotent (only touches messages with text and no embedding), so it's safe to re-run.

---

## Phase 5 — Vector Search Backend

- **ANN vs exact search — why not just compare against every message?** My Phase 4 demo did exact search: loop over all messages, compute similarity, sort. That's O(n) — fine for 102 messages, hopeless for a million. Vector databases use Approximate Nearest Neighbor (ANN): a pre-built index (usually an HNSW graph) that only checks vectors *likely* to be close, so search is sub-linear. You trade a tiny chance of missing the true best match for a massive speed gain. Library analogy: instead of scanning every aisle, you walk straight to the right topic-neighborhood and only inspect the books there.

- **Why "approximate" is acceptable.** The embeddings themselves are already approximate — a model's *estimate* of meaning, not exact truth. So demanding a mathematically exact nearest neighbour over fuzzy vectors is false precision. ANN's extra error is tiny next to the fuzziness already baked into the vectors, so I lose effectively nothing and gain huge speed.

- **`numCandidates` — the recall vs latency dial.** `limit` is how many results I return (5); `numCandidates` (100) is how many vectors the ANN search *examines* before picking the best 5. Higher numCandidates = explores more of the index = better recall (more likely to find the true nearest) but slower. Too low = fast but might skip good matches. Rule of thumb: 10–20× the limit. It's set per-query in the aggregation, not in the index — so I can tune it without rebuilding.

- **Why MongoDB Atlas over Pinecone/Weaviate/Qdrant?** I'm already on Mongo. Atlas Vector Search keeps the vectors *in the same database as the data* — no second system to run, no syncing messages into a separate vector store and keeping them consistent. A dedicated vector DB wins at huge scale or billions of vectors, but for my size, co-locating is simpler, cheaper, and one less thing to break. I'd only move off Atlas if vectors became the bottleneck.

- **The filter is the security boundary.** The `$vectorSearch` filter (`senderId == me OR receiverId == me`) scopes results to my own conversations — I literally cannot search other people's chats. Those filter fields have to be declared in the index, or you can't filter on them at query time. Proved it in Postman: same query returned different results per logged-in user, and never leaked another user's messages.

- **Query and data must share the same model.** The query gets embedded with the exact same `getEmbedding` as the stored messages, so both live in the same 384-dim space. Embed the query with a different model and the comparison is meaningless. And `similarity: cosine` in the index ties straight back to Phase 3 — vectors are normalized, so cosine and dot product are equivalent.

---

## Phase 6 — Search UI

- **Modal over inline sidebar bar — driven by the mobile constraint.** The plan said "search bar in the sidebar," but my sidebar collapses to an icon-only ~80px rail on mobile — no room for a text input. So I made search a modal overlay that sizes to the screen and works identically on mobile and desktop. The lesson: the right UI pattern depends on the layout constraints, not just the feature spec. (Slack/Discord/Linear all do search-as-overlay for the same reason.)

- **Show the similarity score, or hide it?** I show it as "N% match." For a portfolio project that's a feature — it visibly signals the search is semantic/AI-powered, which is the whole thing I'm demonstrating. In a consumer product I'd likely hide it as an implementation detail, since users care about *relevance order*, not the raw cosine number. The answer depends on audience.

- **Client-side scroll, not a server-rendered deep link.** Clicking a result sets state → switches conversation → `scrollIntoView`. It's a single-page app with everything already in memory, so a server `#anchor` deep-link would be heavier for no benefit. Deep links matter when results need to be shareable/bookmarkable across page loads — not my case.

- **Precision in AI UX copy.** Empty state says "No semantically similar messages found," not just "No results." The wording teaches the user *how* the feature works (by meaning, not keyword), which sets the right expectation — otherwise people type exact keywords and are confused when a synonym match appears or a literal match doesn't rank first.

- **The cross-conversation jump was the fiddly part.** A search result can belong to a different conversation than the one open. So clicking has to (a) figure out the "other" participant from the message (`isBot ? conversationWith : the-non-me id`), (b) switch to that conversation, (c) wait for messages to load, then (d) scroll to the specific message. I had to suppress the normal scroll-to-bottom during that navigation so the two scrolls didn't fight.

---

## Phase 7 — RAG Q&A

- **Why RAG over fine-tuning?** Fine-tuning retrains the model on my chat — expensive, slow, and stale the instant a new message arrives (I'd have to retrain). RAG leaves the model alone and just *fetches the relevant messages at question-time* and hands them over. For data that changes constantly (a chat), RAG always wins: current, no training, no cost. Rule: fine-tune to change *behavior/style*; RAG to inject *fresh facts*. Open-book exam vs memorizing the textbook.

- **The recall-vs-reasoning split — proven with my own data.** This is the core insight. For "is there anything important on Monday?", vector search ranked "Today is saturday" *above* the meeting message — it can't tell that a meeting IS the "important" thing (that's reasoning, not similarity). But the meeting was still in the top-5 (recall succeeded). The LLM then read all 5, reasoned, and answered "Yes, you have a meeting on Monday [3]." So embeddings do **recall**, the LLM does **reasoning**. RAG doesn't fix embeddings — it puts a reasoning layer on top of them.

- **Grounding + citations stop hallucination.** "Grounded" = the answer comes only from retrieved messages, not the model's general knowledge. I enforce it with the system prompt: "use ONLY these numbered messages; cite [n]; if it's not here say 'I couldn't find that in your chat.'" The citation does double duty — lets the user verify AND discourages making things up, since the model has to point at a source. Verified it refuses cleanly: "what is my pet's name?" → "I couldn't find that in your chat" instead of inventing one.

- **Why K=5 retrieved messages?** Recall-vs-prompt-bloat tradeoff. K=1 risks missing the answer if the top match is slightly off (which it was — the meeting was rank 3, not 1). K=20 floods the prompt with irrelevant text, costs more, and distracts the model. K=5 is enough to almost certainly contain the answer while staying focused.

- **How I'd detect if the model ignored "use only these docs":** the cheap programmatic check is to verify the answer's cited indices actually exist in the retrieved set, and/or check that claimed facts appear in the source text. The manual version is the eval below — hand-checking that answers are grounded and refusals happen when they should.

### RAG Evaluation (manual eval — Decisions Locked #7, kept here instead of a separate evals/ file)

Run against the seeded DM conversation. ✅ = grounded & correct · ⚠️ = partial · ❌ = wrong/hallucinated.

| # | Question | Answer | Verdict |
|---|---|---|---|
| 1 | Is there anything important on Monday? | "Yes, there is a meeting on Monday [3]." | ✅ |
| 2 | Do I have any meetings coming up? | "Yes, you have a meeting on Monday [1]." | ✅ |
| 3 | What day did we say it is? | "We said today is Saturday [3]." | ✅ |
| 4 | When is my meeting scheduled? | "Your meeting is scheduled for Monday [1]." | ✅ |
| 5 | What is my pet's name? *(not in chat)* | "I couldn't find that in your chat." | ✅ (correct refusal) |
| 6 | What's the weather forecast? *(not in chat)* | "I couldn't find that in your chat." | ✅ (correct refusal) |

**Result: 6/6 grounded and correct** — 4 cited answers, 2 correct refusals. The standout is #1: retrieval ranked an irrelevant "Today is saturday" first, but the LLM still found and cited the meeting — recall + reasoning working together. *(Seed data is small; add more rows as the chat grows to stress-test contradictions and multi-message synthesis.)*

### Phase 7 — extras & hard-won lessons (off-plan additions)

- **Retrieval scope is a correctness decision, and I got it wrong first.** My initial RAG filter only matched human↔human messages (`senderId/receiverId ∈ {me, other}`), which silently **excluded the `@ai` bot's own replies** (their `senderId` is the bot). So asking "is there something special on June 13th?" returned my *question* but not the bot's *answer* ("International Albinism Awareness Day") — grounded, but useless. Fix: add the bot to the sender set, retrieve more candidates, then keep bot replies only when `conversationWith ∈ {me, other}` so I don't leak bot answers from my *other* chats. Lesson: **if the right document isn't in the retrieval set, no amount of LLM reasoning saves you — recall is the ceiling.**

- **Streaming = how the answer is delivered, not what it says.** Without it, the server waits for the whole reply then sends it; with it, each token is forwarded the moment it's generated. I used `generateContentStream` + **SSE** (Server-Sent Events) — a one-way server→client text stream. Gotcha: **axios can't read a stream**, so the frontend uses raw `fetch` + `response.body.getReader()` and parses the SSE events manually (`event:`/`data:` split on blank lines).

- **Short answers barely show streaming — and that's fine.** My RAG answers are ~1 sentence (2 chunks), and the real latency is *front-loaded* (embed + vector search + time-to-first-token), shown as "Thinking…". So streaming is technically working but visually brief. I kept answers short (better Q&A UX) and used a typing-cursor to signal streaming, rather than padding answers just to make streaming flashier.

- **Free-tier quotas are a real architectural constraint.** `gemini-2.5-flash` free tier = **20 requests/day** — I exhausted it just from a day of testing, and the failure surfaced as a confusing mid-stream error. `2.0-flash` had `limit: 0` and `1.5` is retired, so I switched to `gemini-2.5-flash-lite` (higher daily limit). This is *why* Phase 8 (caching) and Phase 9 (rate limiting) exist — they directly cut and protect API usage. Also learned to surface 429s as a friendly "rate-limited, try again" instead of a raw error.

---

## Phase 8 — Redis Cache

- **Why Redis over an in-process cache (a JS Map / lru-cache)?** An in-process cache lives in one Node process's memory: it dies on restart, and if I run multiple server instances each has its own separate cache (no sharing). Redis is a separate shared store — survives restarts, and all instances hit the same cache. Same "shared state across processes" reason as the Phase 10 presence refactor.

- **Why SHA-256 the question instead of using raw text as the key?** Raw questions make bad keys — they can be long, contain spaces/emoji/newlines, and vary trivially. So I normalize (lowercase, strip `@ai`, collapse spaces, trim) then hash → a fixed-length, clean, namespaced key (`ai:cache:<hash>`). Normalizing first means "What is 2+2?" and "what is  2+2 ?" hit the same entry. Verified: a case/spacing variant got a HIT.

- **Cache-aside, and why.** My code checks Redis; on a miss it calls Gemini and writes the result back. That's cache-aside (vs read/write-through, where the cache layer itself fetches). Cache-aside is the simplest and most common for app-level caching, and it keeps the cache an *optional* optimization, not a hard dependency.

- **1-hour TTL.** Too short (5 min) → low hit rate. Too long (24 hr) → stale answers + wasted memory. 1 hour catches repeat questions within a session without hoarding. The signal that would change it: how fast a "correct" answer goes stale.

- **Graceful degradation matters.** If Redis is down, the app must still work. I use `commandTimeout: 1000` + try/catch so a down/slow Redis makes `get` return null within 1s and the code falls back to Gemini. Caching should never be able to take the app down.

- **Cache stampede + the single-threaded subtlety (the best lesson here).** Node is single-threaded but *concurrent*: it interleaves requests at `await`. So if many identical questions arrive while the first is still calling Gemini, they all miss the cache before anyone writes it → many duplicate Gemini calls (a stampede). Single-threading means I *don't* need a mutex/lock to protect shared data (a synchronous check-and-set can't be interrupted), so the within-one-process fix is just sharing the in-flight promise — not a lock. A real (distributed) lock like Redis `SETNX` is only needed across *multiple* processes, where each has its own memory. For my scale (one process, light traffic) I need neither — but knowing single-thread → promise-dedup vs multi-process → distributed lock is the senior answer.

- **Honest limitation of my cache (deliberate):** the key is the *question only* — it ignores conversation history. That's perfect for general/factual repeats ("what's 2+2?"), which is what the cache is for. But a context-dependent question ("what's my dog's name?") could serve a stale answer across different conversations. The correct fix (key on question + context/participants) would make true cache hits rare since history changes every message, so I chose the simple version and documented the failure mode. Only `getAIReply` (the @ai bot) is cached — not RAG answers, which are too context-specific to cache by question.

---

## Phase 9 — Rate Limiter

- **Sliding window vs fixed window — the edge-burst flaw.** Fixed window uses reset boundaries (12:00:00–12:00:59, reset, …). The flaw: 5 calls at 12:00:59 + 5 at 12:01:01 = 10 calls in ~2s, even though the rule is "5/min" — the reset lets you cheat across the boundary. Sliding window always looks at the *last 60s from now* (no boundary), so it truly enforces "5 in any 60s window." Token bucket (5 tokens, refill over time) allows controlled bursts; I picked sliding window because it's strict and simple — right for "don't let anyone spam @ai."

- **Why a sorted set (not a counter).** I store each call as `(score = timestamp)`. Then the whole sliding window is 3 commands: `ZREMRANGEBYSCORE` drops calls older than 60s, `ZCARD` counts what's left, `ZADD` records the new call. A plain counter can't do this — it only knows a total, it can't *forget individual old calls* as they age out. The sorted set remembers each call's time, so they expire one by one.

- **Why one atomic Lua script (not MULTI/EXEC).** The limiter does remove→count→**decide**→add. If two requests interleave at an await between count and add, both see "4, under limit" and both add → 6 allowed, limit broken (same concurrency trap as the cache stampede). Wrapping it in a Lua `EVAL` makes Redis run all of it as one uninterrupted unit — no gap. And it has to be Lua, not `MULTI`/`EXEC`, because a transaction just queues commands; it can't make a *decision* mid-way (`if count < limit then add`). Lua runs real logic atomically inside Redis.

- **"Crashes mid-script" / half-executed state?** No — Redis runs a Lua script atomically and to completion (it's single-threaded for command execution); other clients can't see a partial state. A crash mid-script doesn't leave half-applied changes visible.

- **Why not in Node memory?** An in-process counter only limits *per process*. Run 2+ Node instances and each has its own counter → a user gets 5×N calls across N servers. Redis is shared, so the limit holds *globally* across all instances. (Also dies on restart, like the cache reasoning.)

- **Fail-open was a deliberate choice.** If Redis is down, I *allow* the request rather than block it — I'd rather not punish legit users for a limiter outage (availability over strictness). The opposite (fail-closed) would protect the Gemini quota harder. For this app, availability wins; I noted the tradeoff.

- **Failure modes I can now answer:** "user opens 5 tabs" → still limited, because the key is per-user not per-connection. "3 Node processes" → limit holds globally because the sorted set lives in shared Redis, not process memory.

---

## Phase 10 — Online Presence

- **The bug with in-memory `userSocketMap` across 2 processes (the whole point).** With presence in one process's memory: User A connects to server 1, User B to server 2. Server 1's map only has A; server 2's only has B. So A never sees B as online and vice versa — each process has half the picture. Moving presence to Redis gives all processes one shared source of truth. This is the same "shared state across processes" lesson as the cache and rate limiter — the third time it showed up.

- **`userSocketMap` actually has two jobs, and only one can move.** It's both (a) the presence list and (b) the message-routing table (`getReceiverSocketId` → which socket to emit to). I moved *presence* to Redis, but kept the map for *routing* — because socket IDs are process-local (a socket only exists on the server holding it), so cross-process *delivery* needs the Socket.IO Redis adapter, which I left out of scope. So Phase 10 makes presence multi-process-correct, not message delivery. Being precise about that is the honest answer.

- **TTL-based liveness + why a heartbeat.** The hard case isn't a clean tab-close (fires `disconnect` → mark offline). It's a crash/WiFi-drop where *no event fires* — a plain set would show that user online forever (a zombie). Fix: presence has a short liveness window (35s) that the client must keep refreshing with a heartbeat every 30s. Stop heartbeating → window lapses → auto-offline, no event needed.

- **Why my own heartbeat when Socket.IO already pings every ~25s?** Different layers. Socket.IO's ping keeps the *transport connection* alive between the client and one specific server. My heartbeat refreshes the *presence record in shared Redis* that any server can read. The socket ping can't update Redis on its own — with multiple servers, refreshing shared state is my heartbeat's job.

- **Why a sorted set, not `SADD online_users` + `EXPIRE`.** You can't TTL individual *members* of a Redis set — `EXPIRE` kills the whole set. A sorted set with `score = last-heartbeat timestamp` solves it elegantly: "online" = `ZRANGEBYSCORE (now-35s) +inf`, zombies age out by score automatically, and the score *is* the last-seen time (so I get "last seen 5 min ago" for free). Reused the Phase 9 sorted-set idea. A separate hash holds last-seen for a quick lookup.

- **If Redis dies, I chose "appear offline" (degrade to empty), not crash.** `getPresence` returns `{ online: [], lastSeen: {} }` on a Redis error. Showing everyone offline is the safer default than crashing or showing stale "online" — presence is non-critical, so it should fail quiet.

- **Picking the TTL (35s).** It has to be a bit *longer* than the heartbeat interval (30s), or an active user would flicker offline between heartbeats. Too long and zombies linger as "online." 35s = one missed heartbeat of grace. Signals that'd change it: heartbeat frequency and how quickly you need offline detection.

---

## Phase 11 — Polish, Deploy, Showcase

- What's the one thing that surprised me most across the whole build?
- If I had to do it again, what would I do differently?
- What's the next skill I want to learn after this?
