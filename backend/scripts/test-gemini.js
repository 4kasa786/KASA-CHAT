import { config } from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("GEMINI_API_KEY missing from backend/.env");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const prompt = "Reply with exactly one short sentence confirming you're alive.";

console.log("Sending hello-world prompt to Gemini...");
const t0 = Date.now();
const result = await model.generateContent(prompt);
const ms = Date.now() - t0;
console.log(`Response (${ms}ms):`);
console.log(result.response.text());
