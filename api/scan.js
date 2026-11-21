function extractJson(rawText) {
  const cleaned = String(rawText || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json|```/gi, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Không tìm thấy JSON hợp lệ trong phản hồi AI.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function getKeyList(envVal) {
  if (!envVal) return [];
  const keys = envVal
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys;
}

async function callVisionProvider({
  name,
  url,
  apiKey,
  model,
  prompt,
  imageBase64,
  useJsonFormat = true,
  extraHeaders = {},
  timeoutMs = 11000
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      "Content-Type": "application/json",
      ...extraHeaders
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const payload = {
      model,
      temperature: 0.15,
      max_tokens: 450,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`
              }
            }
          ]
        }
      ]
    };

    if (useJsonFormat) {
      payload.response_format = { type: "json_object" };
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const rawBody = await res.text();
    const trimmed = rawBody.trim();

    if (!res.ok) {
      throw new Error(`${name}[${model}] HTTP ${res.status}: ${trimmed.slice(0, 80)}`);
    }

    if (trimmed === "OK" || !trimmed.startsWith("{")) {
      throw new Error(`${name}[${model}] phản hồi không phải JSON (${trimmed.slice(0, 40)})`);
    }

    const parsed = JSON.parse(trimmed);
    const content = parsed.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`${name}[${model}] nội dung rỗng.`);
    }

    return extractJson(content);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Chỉ hỗ trợ phương thức POST." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { imageBase64, locationContext } = body || {};

    if (!imageBase64) {
      return res.status(400).json({ error: "Thiếu dữ liệu ảnh." });
    }

    const prompt = `Bạn là chuyên gia văn hóa, lịch sử và thổ địa Đà Nẵng - Hội An.
Ngữ cảnh vị trí: ${locationContext || "Đà Nẵng - Hội An"}.
Hãy nhìn vào ảnh và nhận diện chính xác đối tượng (di tích, quán ăn, shop, workshop, đặc sản, hoặc vật thể/thiết bị thực tế). Trả lời ngắn gọn, súc tích bằng tiếng Việt.

Quy tắc Hán-Việt:
- CHỈ đặt "co_han_viet": true nếu trong ảnh THẬT SỰ CÓ CHỮ HÁN hoặc CHỮ NÔM.
- Nếu KHÔNG có chữ Hán/Nôm -> bắt buộc đặt "co_han_viet": false và để trống các trường bên trong.

Trả về DUY NHẤT JSON thuần theo mẫu:
{
  "loai_doi_tuong": "Di tích | Quán ăn | Shop & Workshop | Đặc sản | Hán Nôm | Vật thể",
  "ten_dia_diem": "Tên chính xác",
  "dia_chi": "Địa chỉ ngắn gọn hoặc bối cảnh",
  "nien_dai_hoac_gia": "Niên đại hoặc mức giá tham khảo",
  "cau_chuyen_lich_su": "Thông tin hoặc câu chuyện ngắn (2-3 câu ngắn).",
  "giai_thoai_dac_biet": "1 nét độc đáo hoặc giai thoại ngắn.",
  "han_viet": {
    "co_han_viet": false,
    "chu_goc": "",
    "phien_am": "",
    "phan_tich_tung_tu": [],
    "y_nghia_tong_the": ""
  },
  "danh_gia_ban_dia": {
    "tom_tat": "Nhận xét nhanh.",
    "review_mau": ["Nhận xét ngắn 1", "Nhận xét ngắn 2"]
  }
}`;

    const providers = [];

    const groqKeys = getKeyList(process.env.GROQ_API_KEY);
    const groqModels = [
      "meta-llama/llama-4-scout-17b-16e-instruct",
      "meta-llama/llama-4-maverick-17b-128e-instruct"
    ];
    for (const key of groqKeys) {
      for (const model of groqModels) {
        providers.push({
          name: "Groq",
          url: "https://api.groq.com/openai/v1/chat/completions",
          apiKey: key,
          model,
          useJsonFormat: true,
          timeoutMs: 9500
        });
      }
    }

    const openRouterKeys = getKeyList(process.env.OPENROUTER_API_KEY);
    const openRouterModels = [
      "openrouter/free",
      "google/gemma-3-27b-it:free",
      "meta-llama/llama-3.2-11b-vision-instruct:free"
    ];
    for (const key of openRouterKeys) {
      for (const model of openRouterModels) {
        providers.push({
          name: "OpenRouter",
          url: "https://openrouter.ai/api/v1/chat/completions",
          apiKey: key,
          model,
          useJsonFormat: false,
          extraHeaders: {
            "HTTP-Referer": "https://ai-882b.vercel.app",
            "X-Title": "Hon Pho AI"
          },
          timeoutMs: 11000
        });
      }
    }

    const githubTokens = getKeyList(process.env.GITHUB_TOKEN);
    for (const token of githubTokens) {
      providers.push({
        name: "GitHub",
        url: "https://models.github.ai/inference/chat/completions",
        apiKey: token,
        model: "openai/gpt-4o-mini",
        useJsonFormat: false,
        timeoutMs: 9500
      });
    }

    if (providers.length === 0) {
      return res.status(400).json({
        error: "Dự án này chưa có GROQ_API_KEY hoặc OPENROUTER_API_KEY trong Vercel Environment Variables."
      });
    }

    const errors = [];
    for (const provider of providers) {
      try {
        const result = await callVisionProvider({
          ...provider,
          prompt,
          imageBase64
        });
        return res.status(200).json(result);
      } catch (err) {
        errors.push(err.message);
      }
    }

    return res.status(502).json({
      error: errors.slice(-3).join(" | ")
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Lỗi máy chủ." });
  }
};
