export async function tgSend(s, text) {
  if (!s.telegramToken || !s.telegramChatId) return null;
  const r = await fetch(`https://api.telegram.org/bot${s.telegramToken}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: s.telegramChatId, text, disable_web_page_preview: true }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || "Telegram: błąd");
  return "telegram";
}

// Odczytuje chat ID z ostatniej wiadomości wysłanej do bota
export async function tgDetectChat(token) {
  const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || "Zły token bota");
  const msgs = (j.result || []).map((u) => u.message).filter(Boolean);
  if (!msgs.length) throw new Error("Napisz najpierw cokolwiek do swojego bota w Telegramie i spróbuj ponownie.");
  const m = msgs.at(-1);
  return { chatId: String(m.chat.id), name: m.chat.first_name || m.chat.title || "" };
}
