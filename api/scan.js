function extractJson(rawText) {
  const cleaned = String(rawText || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json|```/gi, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Không tìm thấy JSON hợp lệ trong phản hồi.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function fetchWorkingGroqModels(apiKey) {
  const res = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!res.ok) {
    throw new Error(`Không lấy được danh sách model Groq (HTTP ${res.status}).`);
  }
  const data = await res.json();
  const allIds = (data.data || []).map((m) => m.id).filter(Boolean);

  // Ưu tiên các model có thể đọc ảnh / multimodal đang active trên Groq, loại bỏ audio/guard/whisper
  const activeModels = allIds.filter(
    (id) => !/whisper|tts|guard|safeguard|embed|prompt-guard/i.test(id)
  );

  if (activeModels.length === 0) {
    throw new Error("Không tìm thấy model khả dụng trên Groq.");
  }

  return activeModels;
}

async function callGroqModel({ apiKey, model, prompt, imageBase64, timeoutMs = 10000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        max_tokens: 450,
        response_format: { type: "json_object" },
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
      }),
      signal: controller.signal
    });

    const rawText = await res.text();
    const trimmed = rawText.trim();

    if (!res.ok) {
      throw new Error(`${model}: HTTP ${res.status} - ${trimmed.slice(0, 80)}`);
    }

    const parsed = JSON.parse(trimmed);
    const content = parsed.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`${model}: Phản hồi rỗng.`);
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

    const groqKey = String(process.env.GROQ_API_KEY || "").trim();
    if (!groqKey) {
      return res.status(400).json({ error: "Thiếu GROQ_API_KEY trên Vercel." });
    }

    const prompt = `Bạn là chuyên gia văn hóa, lịch sử và thổ địa Đà Nẵng - Hội An.
Ngữ cảnh vị trí: ${locationContext || "Đà Nẵng - Hội An"}.
Nhận diện đối tượng trong ảnh (di tích, quán ăn, shop, workshop, đặc sản, hoặc vật thể). Trả lời ngắn gọn, súc tích bằng tiếng Việt.

Quy tắc Hán-Việt:
- CHỈ đặt "co_han_viet": true nếu trong ảnh THẬT SỰ CÓ CHỮ HÁN hoặc CHỮ NÔM.
- Nếu KHÔNG có chữ Hán/Nôm -> bắt buộc đặt "co_han_viet": false và để trống các trường bên trong.

Trả về DUY NHẤT JSON thuần theo mẫu:
{
  "loai_doi_tuong": "Di tích | Quán ăn | Shop & Workshop | Đặc sản | Hán Nôm | Vật thể",
  "ten_dia_diem": "Tên chính xác",
  "dia_chi": "Địa chỉ ngắn gọn",
  "nien_dai_hoac_gia": "Niên đại hoặc mức giá tham khảo",
  "cau_chuyen_lich_su": "Tóm tắt lịch sử hoặc thông tin nổi bật (2-3 câu ngắn).",
  "giai_thoai_dac_biet": "1 nét độc đáo hoặc giai thoại ngắn.",
  "han_viet": {
    "co_han_viet": false,
    "chu_goc": "",
    "phien_am": "",
    "phan_tich_tung_tu": [],
    "y_nghia_tong_the": ""
  },
  "danh_gia_ban_dia": {
    "tom_tat": "Nhận xét nhanh từ người địa phương.",
    "review_mau": ["Nhận xét ngắn 1", "Nhận xét ngắn 2"]
  }
}`;

    const models = await fetchWorkingGroqModels(groqKey);
    const errors = [];

    for (const model of models) {
      try {
        const result = await callGroqModel({
          apiKey: groqKey,
          model,
          prompt,
          imageBase64
        });
        return res.status(200).json(result);
      } catch (err) {
        errors.push(err.message);
      }
    }

    return res.status(502).json({
      error: "Không model Groq nào đọc được ảnh này: " + errors.slice(-3).join(" | ")
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Lỗi máy chủ." });
  }
};
