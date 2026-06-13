import { pipeline } from "@xenova/transformers";

// all-MiniLM-L6-v2: small, fast, 384-dim sentence embeddings. Runs locally via
// ONNX — no API calls, no cost. Quantized weights download once and are cached.
const MODEL = "Xenova/all-MiniLM-L6-v2";

// Load the model ONCE and reuse it. Loading per-call would be unusably slow.
// We cache the promise (not the resolved extractor) so concurrent first-calls
// share a single load instead of kicking off several.
let extractorPromise = null;
const getExtractor = () => {
    if (!extractorPromise) {
        extractorPromise = pipeline("feature-extraction", MODEL);
    }
    return extractorPromise;
};

// Returns a 384-dim embedding as a plain number[] for the given text.
//  - pooling "mean": average the per-token vectors into one sentence vector.
//  - normalize true: unit-length vectors, so cosine similarity == dot product.
export const getEmbedding = async (text) => {
    const extractor = await getExtractor();
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
};

// Call once on server boot so the first real message doesn't pay the ~5s
// cold-start (model load) tax. Returns the warm-up duration in ms.
export const warmUpEmbeddings = async () => {
    const t0 = Date.now();
    await getEmbedding("hello");
    return Date.now() - t0;
};
