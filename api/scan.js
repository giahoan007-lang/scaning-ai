function extractJson(rawText) {
  const cleaned = String(rawText || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json|```/gi, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Không tìm thấy JSON trong phản hồi.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function getTokens(envVal) {
  if (!envVal) return [];
  return envVal
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function askGitHubVision({ endpoint, token, model, prompt, imageBase64, useJsonMode, timeoutMs = 12000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = {
      model,
      temperature: 0.2,
      max_tokens: 500,
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

    if (useJsonMode) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const text = await res.text();
    const trimmed = text.trim();

    if (!res.ok) {
      throw new Error(`${model} HTTP ${res.status}: ${trimmed.slice(0, 100)}`);
    }

    if (!trimmed.startsWith("{")) {
      throw new Error(`${model} trả về text thuần: ${trimmed.slice(0, 60)}`);
    }

    const json = JSON.parse(trimmed);
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`${model} không có nội dung trả lời.`);
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

    const tokens = getTokens(process.env.GITHUB_TOKEN);
    if (tokens.length === 0) {
      return res.status(400).json({ error: "Chưa cấu hình GITHUB_TOKEN trên Vercel." });
    }

    const prompt = `Bạn là chuyên gia văn hóa, lịch sử và thổ địa Đà Nẵng - Hội An.
Ngữ cảnh vị trí: ${locationContext || "Đà Nẵng - Hội An"}.
Hãy nhìn vào ảnh và nhận diện đối tượng (di tích, quán ăn, shop, workshop, đặc sản, hoặc vật thể).
Nếu trong ảnh CÓ CHỮ HÁN hoặc CHỮ NÔM thật sự thì đặt "co_han_viet": true và dịch; nếu KHÔNG có chữ Hán/Nôm thì đặt "co_han_viet": false và để trống các trường Hán-Việt.

Chỉ trả về 1 JSON tiếng Việt hợp lệ theo mẫu:
{
  "loai_doi_tuong": "Di tích | Quán ăn | Shop & Workshop | Đặc sản | Hán Nôm | Vật thể",
  "ten_dia_diem": "Tên chính xác",
  "dia_chi": "Địa chỉ ngắn gọn",
  "nien_dai_hoac_gia": "Niên đại hoặc mức giá",
  "cau_chuyen_lich_su": "Thông tin hoặc câu chuyện ngắn (2-3 câu).",
  "giai_thoai_dac_biet": "1 điểm độc đáo hoặc giai thoại ngắn.",
  "han_viet": {
    "co_han_viet": false,
    "chu_goc": "",
    "phien_am": "",
    "phan_tich_tung_tu": [],
    "y_nghia_tong_the": ""
  },
  "danh_gia_ban_dia": {
    "tom_tat": "Nhận xét nhanh từ người địa phương.",
    "review_mau": ["Nhận xét 1", "Nhận xét 2"]
  }
}`;

    // Thử lần lượt các endpoint & model nhận ảnh của GitHub Models (có và không ép json_object)
    const targets = [
      { endpoint: "https://models.github.ai/inference/chat/completions", model: "openai/gpt-4o-mini", useJsonMode: true },
      { endpoint: "https://models.inference.ai.azure.com/chat/completions", model: "gpt-4o-mini", useJsonMode: false },
      { endpoint: "https://models.inference.ai.azure.com/chat/completions", model: "gpt-4o", useJsonMode: false },
      { endpoint: "https://models.github.ai/inference/chat/completions", model: "openai/gpt-4o", useJsonMode: false }
    ];

    const errors = [];

    for (const token of tokens) {
      for (const t of targets) {
        try {
          const result = await askGitHubVision({
            ...t,
            token,
            prompt,
            imageBase64,
            timeoutMs: 12000
          });
          return res.status(200).json(result);
        } catch (err) {
          errors.push(err.message);
        }
      }
    }

    return res.status(502).json({
      error: "Không gọi được GitHub Models để đọc ảnh: " + errors.slice(-3).join(" | ")
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Lỗi máy chủ." });
  }
};
