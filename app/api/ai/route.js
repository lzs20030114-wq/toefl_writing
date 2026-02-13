export async function POST(request) {
  try {
    const { system, message, maxTokens } = await request.json();

    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + process.env.DEEPSEEK_API_KEY,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        max_tokens: maxTokens || 1200,
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: message },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return Response.json({ error: "DeepSeek API error: " + res.status, detail: errText }, { status: res.status });
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    return Response.json({ content });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
