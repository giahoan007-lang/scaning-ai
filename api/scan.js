function parseSafeJson(text) {
  const cleaned = String(text || "").replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("AI trả về sai định dạng.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callAIWithTimeout({ url, apiKey, model, messages, useJsonFormat = true, timeoutMs = 12000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const payload = {
      model,
      messages,
      temperature: 0.15,
      max_tokens: 420
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

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 80)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Phản hồi trống.");
    return parseSafeJson(content);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Chỉ hỗ trợ POST." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { imageBase64, locationContext } = body || {};

    if (!imageBase64) {
      return res.status(400).json({ error: "Thiếu dữ liệu ảnh." });
    }

    const prompt = `Thổ địa & chuyên gia lịch sử Đà Nẵng - Hội An. Ngữ cảnh: ${locationContext || "Đà Nẵng - Hội An"}.
Nhận diện nhanh đối tượng trong ảnh (di tích, quán ăn, shop, workshop, đặc sản). Trả lời thật ngắn gọn, súc tích.
Quy tắc Hán-Việt: CHỈ đặt "co_han_viet":true nếu ảnh THẬT SỰ CÓ CHỮ HÁN/NÔM, nếu không bắt buộc để false và rỗng.
Trả về DUY NHẤT JSON thuần tiếng Việt:
{
  "loai_doi_tuong": "Di tích | Quán ăn | Shop & Workshop | Đặc sản | Hán Nôm",
  "ten_dia_diem": "Tên chính xác",
  "dia_chi": "Địa chỉ ngắn gọn",
  "nien_dai_hoac_gia": "Niên đại hoặc mức giá",
  "cau_chuyen_lich_su": "Tóm tắt lịch sử hoặc điểm nổi bật (tối đa 2 câu ngắn).",
  "giai_thoai_dac_biet": "1 nét độc đáo hoặc giai thoại ngắn (1 câu).",
  "han_viet": {
    "co_han_viet": false,
    "chu_goc": "",
    "phien_am": "",
    "phan_tich_tung_tu": [],
    "y_nghia_tong_the": ""
  },
  "danh_gia_ban_dia": {
    "tom_tat": "Lời khuyên nhanh từ người địa phương (1 câu).",
    "review_mau": ["Nhận xét ngắn 1", "Nhận xét ngắn 2"]
  }
}`;

    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`,
              detail: "auto"
            }
          }
        ]
      }
    ];

    const errors = [];

    // Ưu tiên 1: GitHub Models (tốc độ ~1-2 giây bằng chính nick GitHub miễn phí)
    if (process.env.GITHUB_TOKEN) {
      try {
        const result = await callAIWithTimeout({
          url: "https://models.github.ai/inference/chat/completions",
          apiKey: process.env.GITHUB_TOKEN,
          model: "openai/gpt-4o-mini",
          messages,
          useJsonFormat: true,
          timeoutMs: 10000
        });
        return res.status(200).json(result);
      } catch (e) {
        errors.push("GitHub: " + e.message);
      }
    }

    
    try {
      const result = await callAIWithTimeout({
        url: "https://text.pollinations.ai/openai",
        apiKey: "",
        model: "openai",
        messages,
        useJsonFormat: false,
        timeoutMs: 14000
      });
      return res.status(200).json(result);
    } catch (e) {
      errors.push("FreeAI: " + e.message);
    }

    return res.status(502).json({
      error: "Máy chủ AI đang bận, hãy bấm chụp lại! (" + errors.join(" | ") + ")"
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Lỗi máy chủ." });
  }
};
