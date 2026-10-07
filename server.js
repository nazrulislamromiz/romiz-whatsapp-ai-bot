import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const conversations = new Map();
const processedMessages = new Set();

/* -----------------------------
   Health check
------------------------------ */

app.get("/", (req, res) => {
  res.status(200).send("ROMIZ WhatsApp AI Bot is running.");
});

/* -----------------------------
   WhatsApp webhook verification
------------------------------ */

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    token &&
    token === VERIFY_TOKEN
  ) {
    console.log("WhatsApp webhook verified.");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/* -----------------------------
   Receive WhatsApp messages
------------------------------ */

app.post("/webhook", async (req, res) => {
  // Respond quickly to Meta
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const message = value?.messages?.[0];

    if (!message) {
      return;
    }

    // Ignore duplicate messages
    if (processedMessages.has(message.id)) {
      return;
    }

    processedMessages.add(message.id);

    // Keep memory from growing forever
    if (processedMessages.size > 5000) {
      const first = processedMessages.values().next().value;
      processedMessages.delete(first);
    }

    // Only handle text messages
    if (message.type !== "text") {
      await sendWhatsAppMessage(
        message.from,
        "দুঃখিত, আপাতত আমি শুধু text message বুঝতে পারি।"
      );
      return;
    }

    const from = message.from;
    const text = message.text?.body?.trim();

    if (!text) {
      return;
    }

    console.log(`Message from ${from}: ${text}`);

    /* -----------------------------
       Human / Bot mode
    ------------------------------ */

    if (text.toLowerCase() === "human") {
      conversations.set(from, {
        ...(conversations.get(from) || {}),
        humanMode: true,
        history: []
      });

      await sendWhatsAppMessage(
        from,
        "ঠিক আছে। আপনার কথোপকথন এখন Human Support mode-এ রাখা হলো। একজন প্রতিনিধি আপনার সাথে যোগাযোগ করবেন।"
      );

      return;
    }

    if (text.toLowerCase() === "bot") {
      conversations.set(from, {
        ...(conversations.get(from) || {}),
        humanMode: false
      });

      await sendWhatsAppMessage(
        from,
        "🤖 ROMIZ AI আবার চালু হয়েছে। কীভাবে সাহায্য করতে পারি?"
      );

      return;
    }

    const session = conversations.get(from) || {
      humanMode: false,
      history: []
    };

    if (session.humanMode) {
      console.log(`Human mode active for ${from}`);
      return;
    }

    /* -----------------------------
       Conversation history
    ------------------------------ */

    session.history.push({
      role: "user",
      content: text
    });

    // Keep last 12 messages
    session.history = session.history.slice(-12);

    /* -----------------------------
       Ask OpenAI
    ------------------------------ */

    const response = await openai.responses.create({
      model: OPENAI_MODEL,
      instructions: `
You are ROMIZ AI, a helpful WhatsApp customer-support assistant.

Language:
- Reply in Bangla when the user writes Bangla.
- Reply in Banglish when the user uses Banglish.
- Reply in English when the user writes English.
- Keep replies natural, short and easy to understand.

Identity:
- Your name is ROMIZ AI.
- You are a WhatsApp support assistant.

Support topics:
- Facebook account recovery
- Instagram account recovery
- Meta account security
- General social-media support
- WhatsApp support
- Website and technical questions

Safety:
- Never claim that you can bypass Meta security, verification,
  rate limits, CAPTCHA, authentication or platform restrictions.
- Never ask users for passwords, one-time passwords, access tokens,
  recovery codes or other secret credentials.
- Give official and legitimate recovery/security guidance.
- If a case requires human assistance, tell the user to contact
  the human support team.

Do not invent successful account recovery.
Do not promise that an account will definitely be recovered.

Brand:
ROMIZ AI
      `,
      input: session.history
    });

    const reply =
      response.output_text?.trim() ||
      "দুঃখিত, এই মুহূর্তে উত্তর তৈরি করা সম্ভব হচ্ছে না। একটু পরে আবার চেষ্টা করুন।";

    session.history.push({
      role: "assistant",
      content: reply
    });

    session.history = session.history.slice(-12);

    conversations.set(from, session);

    /* -----------------------------
       Send reply to WhatsApp
    ------------------------------ */

    await sendWhatsAppMessage(from, reply);

  } catch (error) {
    console.error("Webhook error:", error);
  }
});

/* -----------------------------
   Send WhatsApp message
------------------------------ */

async function sendWhatsAppMessage(to, message) {
  const url =
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: false,
        body: message
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("WhatsApp API error:", data);
    throw new Error(
      data?.error?.message || "WhatsApp API request failed"
    );
  }

  return data;
}

/* -----------------------------
   Start server
------------------------------ */

app.listen(PORT, () => {
  console.log(`ROMIZ AI Bot running on port ${PORT}`);
});
