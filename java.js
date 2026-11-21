// ==========================================
// 1. KHỞI TẠO TRẠNG THÁI (KHÔNG CẦN API KEY)
// ==========================================
let scanHistory = JSON.parse(localStorage.getItem("honpho_history") || "[]");
let customReviews = JSON.parse(localStorage.getItem("honpho_custom_reviews") || "{}");
let autoScanEnabled = true;
let isProcessing = false;
let isLockedOnResult = false;
let currentCoords = null;
let nearbyPlaces = [];

// Thuật toán giữ yên camera 1.2 giây giống Google Lens
let prevFrameData = null;
let lockedFrameData = null;
let stableFramesCount = 0;
const STABLE_THRESHOLD = 4; // 4 x 300ms = 1.2s

const video = document.getElementById("video");
const previewImg = document.getElementById("preview-img");
const reticle = document.getElementById("reticle");
const hintText = document.getElementById("hint-text");

// Gắn sự kiện điều khiển
document.getElementById("auto-toggle").addEventListener("click", toggleAutoScan);
document.getElementById("shutter-btn").addEventListener("click", manualCapture);
document.getElementById("file-upload").addEventListener("change", handleFileUpload);
document.getElementById("close-sheet-btn").addEventListener("click", closeSheet);
document.getElementById("sheet-backdrop").addEventListener("click", closeSheet);

// Chuyển đổi 3 Tab dưới đáy
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.target).classList.add("active");
    if (btn.dataset.target === "tab-history") renderHistoryTab();
  });
});

// Tự động chạy ngay khi mở web
window.addEventListener("DOMContentLoaded", () => {
  startCamera();
  startGPSAndOverpass();
  renderHistoryTab();
  setInterval(autoScanLoop, 300);
});

// ==========================================
// 2. CAMERA & ĐỊNH VỊ GPS + OPENSTREETMAP
// ==========================================
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 } },
      audio: false
    });
    video.srcObject = stream;
  } catch (err) {
    hintText.innerText = "Không mở được camera. Bấm 'Ảnh mẫu' ở góc phải để quét ngay!";
  }
}

function startGPSAndOverpass() {
  if (!navigator.geolocation) {
    document.getElementById("gps-text").innerText = "Không hỗ trợ GPS";
    return;
  }
  navigator.geolocation.watchPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      const movedFar =
        !currentCoords ||
        Math.hypot(latitude - currentCoords.lat, longitude - currentCoords.lng) > 0.0004;
      currentCoords = { lat: latitude, lng: longitude };
      document.getElementById("gps-text").innerText = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;

      if (movedFar) {
        fetchNearbyOSM(latitude, longitude);
      }
    },
    () => {
      document.getElementById("gps-text").innerText = "Đà Nẵng • Hội An (Demo)";
    },
    { enableHighAccuracy: true }
  );
}

async function fetchNearbyOSM(lat, lng) {
  try {
    const query = `[out:json][timeout:10];(node(around:120,${lat},${lng})[name];way(around:120,${lat},${lng})[name];);out center 18;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: "data=" + encodeURIComponent(query)
    });
    const data = await res.json();
    nearbyPlaces = data.elements
      .filter((e) => e.tags && e.tags.name)
      .map((e) => ({
        name: e.tags.name,
        type: e.tags.historic || e.tags.tourism || e.tags.amenity || e.tags.shop || "Địa điểm bản địa"
      }));

    if (nearbyPlaces.length > 0) {
      document.getElementById("gps-text").innerText = `Gần: ${nearbyPlaces[0].name}`;
      renderNearbyTab();
    }
  } catch (e) {
    console.warn("Bỏ qua Overpass:", e);
  }
}

function renderNearbyTab() {
  const listEl = document.getElementById("nearby-list");
  if (!nearbyPlaces.length) return;
  listEl.innerHTML = nearbyPlaces
    .map(
      (p) => `
      <div class="place-card-mini" onclick="window.open('https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ' Đà Nẵng Hội An')}', '_blank')">
        <div>
          <h4>${p.name}</h4>
          <span>📍 Trong bán kính 120m • ${p.type}</span>
        </div>
        <span style="font-size:16px;">🗺️</span>
      </div>`
    )
    .join("");
}

// ==========================================
// 3. VÒNG LẶP QUÉT TỰ ĐỘNG (GOOGLE LENS)
// ==========================================
function getFrameSignature() {
  const diffCanvas = document.getElementById("diff-canvas");
  const ctx = diffCanvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, 32, 32);
  const data = ctx.getImageData(0, 0, 32, 32).data;
  const gray = new Uint8Array(32 * 32);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
  }
  return gray;
}

function calcFrameDiff(f1, f2) {
  if (!f1 || !f2) return 100;
  let diff = 0;
  for (let i = 0; i < f1.length; i++) diff += Math.abs(f1[i] - f2[i]);
  return diff / f1.length;
}

function autoScanLoop() {
  const isCameraTab = document.getElementById("tab-camera").classList.contains("active");
  if (!isCameraTab || !autoScanEnabled || isProcessing || video.readyState < 2 || previewImg.style.display === "block") return;

  const currentSig = getFrameSignature();

  // Nếu đang hiện kết quả cũ -> chờ người dùng xoay camera sang vật thể mới
  if (isLockedOnResult) {
    const moveDiff = calcFrameDiff(currentSig, lockedFrameData);
    if (moveDiff > 22) {
      isLockedOnResult = false;
      closeSheet();
      hintText.innerText = "Phát hiện góc nhìn mới, giữ yên để quét...";
    }
    prevFrameData = currentSig;
    return;
  }

  const diff = calcFrameDiff(currentSig, prevFrameData);
  prevFrameData = currentSig;

  if (diff < 6.5) {
    stableFramesCount++;
    reticle.classList.add("scanning");
    hintText.innerText = `Đang khóa mục tiêu... (${Math.min(100, stableFramesCount * 25)}%)`;

    if (stableFramesCount >= STABLE_THRESHOLD) {
      stableFramesCount = 0;
      lockedFrameData = currentSig;
      captureAndAnalyze();
    }
  } else {
    stableFramesCount = 0;
    reticle.classList.remove("scanning");
    hintText.innerText = "Chĩa camera & giữ yên 1.2s vào di tích, biển hiệu, chữ Hán...";
  }
}

function toggleAutoScan() {
  autoScanEnabled = !autoScanEnabled;
  const btn = document.getElementById("auto-toggle");
  btn.classList.toggle("active", autoScanEnabled);
  document.getElementById("auto-label").innerText = autoScanEnabled ? "Tự động" : "Tạm dừng";
}

function manualCapture() {
  if (isProcessing) return;
  previewImg.style.display = "none";
  lockedFrameData = getFrameSignature();
  captureAndAnalyze();
}

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    previewImg.style.display = "block";
    analyzeImageFree(e.target.result);
  };
  reader.readAsDataURL(file);
}

function captureAndAnalyze() {
  const canvas = document.getElementById("work-canvas");
  const scale = Math.min(1, 800 / (video.videoWidth || 800));
  canvas.width = (video.videoWidth || 800) * scale;
  canvas.height = (video.videoHeight || 600) * scale;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const imageDataUrl = canvas.toDataURL("image/jpeg", 0.78);
  analyzeImageFree(imageDataUrl);
}

// ==========================================
// 4. PHÂN TÍCH AI MIỄN PHÍ (PUTER.JS) + WIKIPEDIA
// ==========================================
async function fetchWikipediaSummary(placeName) {
  try {
    const searchUrl = `https://vi.wikipedia.org/w/api.php?origin=*&action=query&list=search&srsearch=${encodeURIComponent(placeName)}&format=json&utf8=1`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    if (!searchData.query || !searchData.query.search.length) return null;

    const pageTitle = searchData.query.search[0].title;
    const extractUrl = `https://vi.wikipedia.org/w/api.php?origin=*&action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(pageTitle)}&format=json&utf8=1`;
    const extractRes = await fetch(extractUrl);
    const extractData = await extractRes.json();
    const pages = extractData.query.pages;
    const pageId = Object.keys(pages)[0];

    return {
      title: pageTitle,
      summary: pages[pageId].extract ? pages[pageId].extract.slice(0, 420) + "..." : "",
      url: `https://vi.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`
    };
  } catch (e) {
    return null;
  }
}

function extractTextFromPuter(response) {
  if (typeof response === "string") return response;
  if (response?.message?.content) {
    if (Array.isArray(response.message.content)) {
      return response.message.content.map((c) => c.text || "").join("");
    }
    return response.message.content;
  }
  return String(response);
}

async function analyzeImageFree(imageDataUrl) {
  isProcessing = true;
  reticle.classList.add("scanning");
  hintText.innerText = "AI đang nhận diện, phân tích Hán-Việt & tra cứu lịch sử...";

  const namesList = nearbyPlaces.map((p) => p.name);
  const locationContext = currentCoords
    ? `Tọa độ GPS: (${currentCoords.lat}, ${currentCoords.lng}). Địa điểm OpenStreetMap trong bán kính 120m: ${namesList.length ? namesList.join(", ") : "Chưa rõ"}.`
    : "Khu vực Đà Nẵng - Hội An (Chế độ quét tự do).";

  const prompt = `Bạn là chuyên gia văn hóa, lịch sử, Hán Nôm và thổ địa Đà Nẵng - Hội An.
Hãy quan sát thật kỹ bức ảnh kết hợp ngữ cảnh định vị: ${locationContext}.
Nhận diện chính xác đối tượng trong ảnh (di tích lịch sử, chùa, nhà cổ, bức hoành phi/câu đối/bia đá chữ Hán, shop, nhà hàng, quán ăn địa phương, workshop thủ công hoặc món đặc sản).

QUAN TRỌNG:
- Nếu trong ảnh có chữ Hán/Nôm HOẶC tên di tích mang gốc Hán-Việt (như Lai Viễn Kiều, Phúc Kiến, Ngũ Hành Sơn, Hải Vân Quan...), hãy phân tích chi tiết TỪNG TỪ HÁN-VIỆT (chữ gốc, âm Hán-Việt, nghĩa từng chữ và ý nghĩa tổng thể).
- Nếu là shop/nhà hàng/workshop, nêu rõ địa chỉ, món/dịch vụ nổi bật, mức giá tham khảo và đánh giá thực tế của người dân địa phương.

BẮT BUỘC trả về DUY NHẤT một chuỗi JSON thuần (không kèm markdown, không \`\`\`json) theo đúng cấu trúc:
{
  "loai_doi_tuong": "Di tích lịch sử | Giải mã Hán Nôm | Nhà hàng & Quán ăn | Shop & Workshop | Đặc sản địa phương",
  "ten_dia_diem": "Tên chính xác của địa điểm / di tích / quán ăn / vật thể",
  "dia_chi": "Địa chỉ cụ thể tại Đà Nẵng hoặc Hội An",
  "nien_dai_hoac_gia": "Niên đại lịch sử (nếu là di tích) hoặc Mức giá tham khảo (nếu là shop/quán)",
  "cau_chuyen_lich_su": "Kể chi tiết, cuốn hút câu chuyện lịch sử, nguồn gốc hoặc điểm nổi bật của shop/nhà hàng (3-5 câu).",
  "giai_thoai_dac_biet": "Một giai thoại ít người biết, nét kiến trúc độc đáo hoặc bí quyết làm nghề.",
  "han_viet": {
    "co_han_viet": true,
    "chu_goc": "Chữ Hán/Nôm tương ứng (ví dụ: 來遠橋)",
    "phien_am": "Âm Hán-Việt đầy đủ (ví dụ: Lai Viễn Kiều)",
    "phan_tich_tung_tu": [
      "來 (Lai): Đến, tới",
      "遠 (Viễn): Phương xa",
      "橋 (Kiều): Cây cầu"
    ],
    "y_nghia_tong_the": "Giải thích nghĩa hoàn chỉnh và điển tích văn hóa đằng sau."
  },
  "danh_gia_ban_dia": {
    "tom_tat": "Tóm tắt góc nhìn thực tế của người dân Đà Nẵng - Hội An (nên đi giờ nào, món nào chuẩn vị, lưu ý tránh chặt chém).",
    "review_mau": [
      "Nhận xét thật 1 từ người dân bản địa",
      "Nhận xét thật 2 từ người dân bản địa"
    ]
  }
}`;

  try {
    let response;
    try {
      response = await puter.ai.chat(prompt, imageDataUrl, { model: "gemini-2.5-flash" });
    } catch (modelErr) {
      // Dự phòng tự động chuyển sang model mặc định của Puter nếu model trên bận
      response = await puter.ai.chat(prompt, imageDataUrl);
    }

    let rawText = extractTextFromPuter(response).replace(/```json|```/g, "").trim();
    const jsonStart = rawText.indexOf("{");
    const jsonEnd = rawText.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) throw new Error("AI không trả về đúng định dạng dữ liệu.");
    const parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));

    // Thu thập thêm dữ liệu đối chiếu trực tiếp từ Wikipedia Tiếng Việt
    const wikiData = await fetchWikipediaSummary(parsed.ten_dia_diem);
    if (wikiData) parsed.wiki_source = wikiData;

    saveToHistory(parsed);
    renderResult(parsed);
    isLockedOnResult = true;
  } catch (err) {
    alert("Lỗi khi quét AI: " + (err.message || err));
    previewImg.style.display = "none";
  } finally {
    isProcessing = false;
    reticle.classList.remove("scanning");
    hintText.innerText = "Di chuyển camera sang góc khác để quét tiếp";
  }
}

// ==========================================
// 5. HIỂN THỊ KẾT QUẢ, AUDIO & REVIEW THỔ ĐỊA
// ==========================================
function renderResult(data) {
  document.getElementById("res-type").innerText = data.loai_doi_tuong || "KHÁM PHÁ BẢN ĐỊA";
  document.getElementById("res-title").innerText = data.ten_dia_diem || "Địa điểm Đà Nẵng – Hội An";
  document.getElementById("res-addr").innerText = `📍 ${data.dia_chi || "Đà Nẵng – Hội An"} • ${data.nien_dai_hoac_gia || ""}`;

  const bodyEl = document.getElementById("sheet-body");
  bodyEl.innerHTML = "";

  // 1. Nút nghe thuyết minh giọng nói tiếng Việt
  const audioBtn = document.createElement("button");
  audioBtn.className = "audio-btn";
  audioBtn.innerHTML = "<span>🔊</span> <span>Nghe thuyết minh câu chuyện</span>";
  audioBtn.onclick = () =>
    speakStory(`${data.ten_dia_diem}. ${data.cau_chuyen_lich_su} ${data.giai_thoai_dac_biet || ""}`);
  bodyEl.appendChild(audioBtn);

  // 2. Thẻ Phân tích Hán-Việt / Hán Nôm chi tiết từng từ
  if (data.han_viet && data.han_viet.co_han_viet && (data.han_viet.chu_goc || data.han_viet.phien_am)) {
    const chipsHtml = (data.han_viet.phan_tich_tung_tu || [])
      .map((item) => `<span class="hanviet-chip">${item}</span>`)
      .join("");

    bodyEl.insertAdjacentHTML(
      "beforeend",
      `<div class="hannom-box">
        <h4>🀄 Phân tích Hán Nôm & Từ Hán-Việt</h4>
        ${data.han_viet.chu_goc ? `<div class="hannom-chars">${data.han_viet.chu_goc}</div>` : ""}
        <div class="hannom-phonetic">Âm Hán-Việt: ${data.han_viet.phien_am || ""}</div>
        ${chipsHtml ? `<div class="hanviet-breakdown">${chipsHtml}</div>` : ""}
        <p>${data.han_viet.y_nghia_tong_the || ""}</p>
      </div>`
    );
  }

  // 3. Thẻ Câu chuyện lịch sử / Thông tin Shop & Nhà hàng
  bodyEl.insertAdjacentHTML(
    "beforeend",
    `<div class="info-box">
      <h4>📜 Câu chuyện lịch sử & Thông tin chi tiết</h4>
      <p>${data.cau_chuyen_lich_su || ""}</p>
    </div>`
  );

  // 4. Thẻ Giai thoại & Điểm độc đáo
  if (data.giai_thoai_dac_biet) {
    bodyEl.insertAdjacentHTML(
      "beforeend",
      `<div class="info-box">
        <h4>✨ Giai thoại & Nét đặc trưng</h4>
        <p>${data.giai_thoai_dac_biet}</p>
      </div>`
    );
  }

  // 5. Thẻ Đánh giá thật của người dân địa phương + Form viết thêm review
  const placeKey = data.ten_dia_diem || "default";
  const aiReviews = (data.danh_gia_ban_dia && data.danh_gia_ban_dia.review_mau) || [];
  const savedUserReviews = customReviews[placeKey] || [];
  const reviewsHtml = [
    ...aiReviews.map((r) => `<div class="review-item"><span class="local-tag">THỔ ĐỊA</span>${r}</div>`),
    ...savedUserReviews.map((r) => `<div class="review-item"><span class="local-tag">NGƯỜI DÙNG • GPS</span>${r}</div>`)
  ].join("");

  bodyEl.insertAdjacentHTML(
    "beforeend",
    `<div class="info-box">
      <h4>💬 Đánh giá thật từ người địa phương</h4>
      <p>${(data.danh_gia_ban_dia && data.danh_gia_ban_dia.tom_tat) || ""}</p>
      <div id="local-reviews-container">${reviewsHtml}</div>
      <div class="add-review-form">
        <input type="text" id="new-review-input" placeholder="Thêm đánh giá thật của bạn tại đây..." />
        <button id="submit-review-btn">Gửi</button>
      </div>
    </div>`
  );

  document.getElementById("submit-review-btn").addEventListener("click", () => {
    const inp = document.getElementById("new-review-input");
    const text = inp.value.trim();
    if (!text) return;
    if (!customReviews[placeKey]) customReviews[placeKey] = [];
    customReviews[placeKey].push(text);
    localStorage.setItem("honpho_custom_reviews", JSON.stringify(customReviews));

    document
      .getElementById("local-reviews-container")
      .insertAdjacentHTML(
        "beforeend",
        `<div class="review-item"><span class="local-tag">BẠN • VỪA XONG</span>${text}</div>`
      );
    inp.value = "";
  });

  // 6. Nguồn dữ liệu trực tiếp từ Google Maps & Wikipedia
  const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(data.ten_dia_diem + " " + (data.dia_chi || "Đà Nẵng Hội An"))}`;
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.ten_dia_diem + " " + (data.dia_chi || "Đà Nẵng Hội An"))}`;

  let linksHtml = `
    <a class="source-link" href="${googleMapsUrl}" target="_blank">🗺️ Mở chỉ đường & Review trên Google Maps ↗</a>
    <a class="source-link" href="${googleSearchUrl}" target="_blank">🌐 Tra cứu thêm trên Google Search ↗</a>
  `;
  if (data.wiki_source) {
    linksHtml =
      `<a class="source-link" href="${data.wiki_source.url}" target="_blank">📚 Tư liệu Wikipedia: ${data.wiki_source.title} ↗</a>` +
      linksHtml;
  }

  bodyEl.insertAdjacentHTML(
    "beforeend",
    `<div class="info-box">
      <h4>🔗 Nguồn tra cứu & Điều hướng trực tiếp</h4>
      ${data.wiki_source && data.wiki_source.summary ? `<p style="font-size:12.5px; color:#57534e; margin-bottom:8px;">${data.wiki_source.summary}</p>` : ""}
      <div class="source-links">${linksHtml}</div>
    </div>`
  );

  document.getElementById("sheet-backdrop").classList.add("show");
  document.getElementById("result-sheet").classList.add("open");
}

function closeSheet() {
  window.speechSynthesis.cancel();
  document.getElementById("sheet-backdrop").classList.remove("show");
  document.getElementById("result-sheet").classList.remove("open");
  previewImg.style.display = "none";
}

function speakStory(text) {
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "vi-VN";
  utter.rate = 1.02;
  window.speechSynthesis.speak(utter);
}

// ==========================================
// 6. SỔ TAY LỊCH SỬ ĐÃ QUÉT
// ==========================================
function saveToHistory(item) {
  scanHistory = [item, ...scanHistory.filter((h) => h.ten_dia_diem !== item.ten_dia_diem)].slice(0, 25);
  localStorage.setItem("honpho_history", JSON.stringify(scanHistory));
}

function renderHistoryTab() {
  const listEl = document.getElementById("history-list");
  if (!scanHistory.length) return;
  listEl.innerHTML = scanHistory
    .map(
      (item, idx) => `
      <div class="place-card-mini" onclick="openHistoryItem(${idx})">
        <div>
          <h4>${item.ten_dia_diem}</h4>
          <span>${item.loai_doi_tuong} • ${item.dia_chi}</span>
        </div>
        <span style="font-size:18px;">📖</span>
      </div>`
    )
    .join("");
}

window.openHistoryItem = function (idx) {
  if (scanHistory[idx]) renderResult(scanHistory[idx]);
};