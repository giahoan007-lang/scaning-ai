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
      throw new Error(`${name} HTTP ${res.status}: ${trimmed.slice(0, 90)}`);
    }

    if (trimmed === "OK" || !trimmed.startsWith("{")) {
      throw new Error(`${name} trả về phản hồi không phải JSON (${trimmed.slice(0, 40)})`);
    }

    const parsed = JSON.parse(trimmed);
    const content = parsed.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`${name} không có nội dung phản hồi.`);
    }

    return extractJson(content);
  } finally {
    clearTimeout(timer);
  }
}

function buildLocationFallback(locationContext) {
  return {
    loai_doi_tuong: "Khám phá bản địa",
    ten_dia_diem: "Địa điểm quanh khu vực Đà Nẵng – Hội An",
    dia_chi: locationContext || "Đà Nẵng – Hội An",
    nien_dai_hoac_gia: "Đang cập nhật",
    cau_chuyen_lich_su:
      "Các cổng AI đọc ảnh miễn phí hiện đang tạm bận hoặc chưa được cấu hình đủ key. Bạn có thể xem các địa điểm lân cận qua GPS tại tab Quanh đây hoặc thử quét lại sau ít giây.",
    giai_thoai_dac_biet:
      "Đà Nẵng và Hội An nổi bật với hệ thống di tích lịch sử, biển hiệu mang nét chữ Hán-Nôm và ẩm thực địa phương phong phú.",
    han_viet: {
      co_han_viet: false,
      chu_goc: "",
      phien_am: "",
      phan_tich_tung_tu: [],
      y_nghia_tong_the: ""
    },
    danh_gia_ban_dia: {
      tom_tat: "Nên kiểm tra tab Quanh đây để xem danh sách địa điểm thực tế quanh vị trí GPS.",
      review_mau: [
        "Giữ camera thẳng và đủ sáng khi quét biển hiệu hoặc di tích.",
        "Gắn GROQ_API_KEY hoặc OPENROUTER_API_KEY vào Environment Variables trên Vercel để quét ảnh trực tiếp."
      ]
    }
  };
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
Nhận diện nhanh đối tượng trong ảnh (di tích, quán ăn, shop, workshop, đặc sản, hoặc vật thể). Trả lời ngắn gọn, súc tích bằng tiếng Việt.

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

    const providers = [];

    // 1. Ưu tiên Groq (nhanh, miễn phí không cần thẻ)
    for (const key of getKeyList(process.env.GROQ_API_KEY)) {
      providers.push({
        name: "Groq",
        url: "https://api.groq.com/openai/v1/chat/completions",
        apiKey: key,
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        useJsonFormat: true,
        timeoutMs: 9500
      });
    }

    // 2. Dự phòng OpenRouter (miễn phí không cần thẻ)
    for (const key of getKeyList(process.env.OPENROUTER_API_KEY)) {
      providers.push({
        name: "OpenRouter",
        url: "https://openrouter.ai/api/v1/chat/completions",
        apiKey: key,
        model: "openrouter/free",
        useJsonFormat: false,
        extraHeaders: {
          "HTTP-Referer": "https://scaning-ai-zmr5.vercel.app",
          "X-Title": "Hon Pho AI"
        },
        timeoutMs: 11000
      });
    }

    // 3. Dự phòng GitHub Models nếu có cấu hình token
    for (const token of getKeyList(process.env.GITHUB_TOKEN)) {
      providers.push({
        name: "GitHub",
        url: "https://models.github.ai/inference/chat/completions",
        apiKey: token,
        model: "openai/gpt-4o-mini",
        useJsonFormat: false,
        timeoutMs: 9500
      });
    }

    for (const provider of providers) {
      try {
        const result = await callVisionProvider({
          ...provider,
          prompt,
          imageBase64
        });
        return res.status(200).json(result);
      } catch (err) {
        // Thử nhà cung cấp tiếp theo nếu nguồn hiện tại lỗi hoặc hết lượt
      }
    }

    // Trả về phản hồi dự phòng theo ngữ cảnh thay vì báo lỗi làm đứng luồng trải nghiệm
    return res.status(200).json(buildLocationFallback(locationContext));
  } catch (err) {
    return res.status(500).json({ error: err.message || "Lỗi máy chủ." });
  }
};
