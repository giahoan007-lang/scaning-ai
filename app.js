// ==========================================
// 1. KHỞI TẠO NHANH (KHÔNG TẢI MẠNG LÚC MỞ WEB)
// ==========================================
let scanHistory = JSON.parse(localStorage.getItem("honpho_history") || "[]");
let customReviews = JSON.parse(localStorage.getItem("honpho_custom_reviews") || "{}");
let autoScanEnabled = true;
let isProcessing = false;
let isLockedOnResult = false;
let currentCoords = null;
let nearbyPlaces = [];

let prevFrameData = null;
let lockedFrameData = null;
let stableFramesCount = 0;
const STABLE_THRESHOLD = 4;

const video = document.getElementById("video");
const previewImg = document.getElementById("preview-img");
const reticle = document.getElementById("reticle");
const hintText = document.getElementById("hint-text");
const cameraFallback = document.getElementById("camera-fallback");
const camErrorMsg = document.getElementById("cam-error-msg");
const gpsText = document.getElementById("gps-text");
const gpsDot = document.getElementById("gps-dot");

// Đổi chữ ngay lập tức để xác nhận app.js đã chạy thành công
hintText.innerText = "Sẵn sàng! Đang mở ống kính...";

// Gắn sự kiện nút bấm
document.getElementById("auto-toggle").addEventListener("click", toggleAutoScan);
document.getElementById("shutter-btn").addEventListener("click", manualCapture);
document.getElementById("file-upload").addEventListener("change", handleFileUpload);
document.getElementById("close-sheet-btn").addEventListener("click", closeSheet);
document.getElementById("sheet-backdrop").addEventListener("click", closeSheet);
document.getElementById("enable-cam-btn").addEventListener("click", () => startCamera(true));
document.getElementById("gps-status").addEventListener("click", requestGPS);

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

// Chạy ngay không chờ load thư viện ngoài
renderHistoryTab();
startCamera(false);
setInterval(autoScanLoop, 300);

// ==========================================
// 2. CAMERA CHUẨN SAFARI IPHONE (CHỐNG TREO)
// ==========================================
async function startCamera(isUserTap) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    cameraFallback.style.display = "block";
    camErrorMsg.innerText = "Trình duyệt này chặn Camera. Hãy bấm Ảnh mẫu (chọn Chụp ảnh) hoặc mở bằng Safari!";
    hintText.innerText = "Dùng nút Ảnh mẫu bên phải để chụp & quét";
    return;
  }

  // Nếu Safari treo hộp thoại cấp quyền quá 2.5 giây -> tự hiện nút chạm bật Camera
  const safetyTimer = setTimeout(() => {
    if (video.readyState < 2) {
      cameraFallback.style.display = "block";
      camErrorMsg.innerText = "Chạm nút vàng ở trên để iPhone hiện bảng cấp quyền Camera.";
    }
  }, 2500);

  try {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
    } catch (e) {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    clearTimeout(safetyTimer);
    video.srcObject = stream;
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.muted = true;
    await video.play();

    cameraFallback.style.display = "none";
    hintText.innerText = "Chĩa camera & giữ yên 1.2s vào di tích, biển hiệu, chữ Hán...";
  } catch (err) {
    clearTimeout(safetyTimer);
    cameraFallback.style.display = "block";
    if (err.name === "NotAllowedError") {
      camErrorMsg.innerText = "iPhone đang khóa Camera web này. Vào biểu tượng bên trái link → Cài đặt trang web → Camera → Cho phép.";
    } else {
      camErrorMsg.innerText = isUserTap
        ? `Không mở được Camera (${err.name}). Bạn có thể bấm 'Ảnh mẫu' → 'Chụp ảnh' để quét trực tiếp!`
        : "Chạm nút vàng phía trên để cấp quyền bật Camera.";
    }
    hintText.innerText = "Chạm nút bật Camera hoặc chọn Ảnh mẫu";
  }
}

// ==========================================
// 3. ĐỊNH VỊ GPS (CHẠM LÀ BẬT, KHÔNG XUNG ĐỘT CAMERA)
// ==========================================
function requestGPS() {
  if (!navigator.geolocation) {
    gpsText.innerText = "Không hỗ trợ GPS";
    return;
  }

  gpsText.innerText = "Đang lấy tọa độ...";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      currentCoords = { lat: latitude, lng: longitude };
      gpsDot.classList.add("active");
      gpsText.innerText = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      fetchNearbyOSM(latitude, longitude);
    },
    (err) => {
      gpsDot.classList.remove("active");
      if (err.code === 1) {
        gpsText.innerText = "Bật Vị trí trong Cài đặt";
        alert("Hãy vào Cài đặt iPhone → Quyền riêng tư & Bảo mật → Dịch vụ định vị → Trang web Safari → chọn 'Khi dùng ứng dụng'.");
      } else {
        gpsText.innerText = "Thử bấm lại GPS";
      }
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
  );
}

async function fetchNearbyOSM(lat, lng) {
  try {
    const query = `[out:json][timeout:8];(node(around:120,${lat},${lng})[name];way(around:120,${lat},${lng})[name];);out center 15;`;
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
      gpsText.innerText = `Gần: ${nearbyPlaces[0].name}`;
      renderNearbyTab();
    }
  } catch (e) {
    // Bỏ qua nếu Overpass bận
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
// 4. VÒNG LẶP QUÉT TỰ ĐỘNG (GOOGLE LENS)
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
  if (
    !isCameraTab ||
    !autoScanEnabled ||
    isProcessing ||
    video.readyState < 2 ||
    video.videoWidth === 0 ||
    previewImg.style.display === "block"
  ) {
    return;
  }

  const currentSig = getFrameSignature();

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
  if (video.readyState < 2 || video.videoWidth === 0) {
    startCamera(true);
    return;
  }
  previewImg.style.display = "none";
  lockedFrameData = getFrameSignature();
  captureAndAnalyze();
}

// Nén ảnh tải lên từ iPhone về 720px để gửi AI cực nhanh, không bị treo RAM
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.getElementById("work-canvas");
      const scale = Math.min(1, 720 / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const compressedUrl = canvas.toDataURL("image/jpeg", 0.75);

      previewImg.src = compressedUrl;
      previewImg.style.display = "block";
      analyzeImageFree(compressedUrl);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function captureAndAnalyze() {
  const canvas = document.getElementById("work-canvas");
  const scale = Math.min(1, 720 / (video.videoWidth || 720));
  canvas.width = (video.videoWidth || 720) * scale;
  canvas.height = (video.videoHeight || 540) * scale;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);

  const imageDataUrl = canvas.toDataURL("image/jpeg", 0.75);
  analyzeImageFree(imageDataUrl);
}

// ==========================================
// 5. CHỈ TẢI PUTER.JS KHI BẮT ĐẦU QUÉT ẢNH
// ==========================================
function loadPuterOnDemand() {
  return new Promise((resolve, reject) => {
    if (typeof window.puter !== "undefined") return resolve();

    const script = document.createElement("script");
    script.src = "https://js.puter.com/v2/";
    script.async = true;

    const timer = setTimeout(() => reject(new Error("Kết nối tới máy chủ AI quá chậm, thử lại sau vài giây.")), 15000);
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Không tải được máy chủ AI Puter.js. Kiểm tra lại Wi-Fi/4G."));
    };
    document.head.appendChild(script);
  });
}

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
  hintText.innerText = "Đang gọi AI giải mã di sản & Hán-Việt...";

  try {
    await loadPuterOnDemand();

    const namesList = nearbyPlaces.map((p) => p.name);
    const locationContext = currentCoords
      ? `Tọa độ GPS: (${currentCoords.lat}, ${currentCoords.lng}). Địa điểm lân cận: ${namesList.length ? namesList.join(", ") : "Chưa rõ"}.`
      : "Khu vực Đà Nẵng - Hội An.";

    const prompt = `Bạn là chuyên gia văn hóa, lịch sử, Hán Nôm và thổ địa Đà Nẵng - Hội An.
Quan sát bức ảnh kết hợp ngữ cảnh định vị: ${locationContext}.
Nhận diện đối tượng trong ảnh (di tích lịch sử, chùa, nhà cổ, bức hoành phi/câu đối chữ Hán, shop, nhà hàng, quán ăn, workshop hoặc đặc sản).
Nếu có chữ Hán/Nôm HOẶC tên di tích mang gốc Hán-Việt, hãy phân tích chi tiết từng từ Hán-Việt.

BẮT BUỘC trả về DUY NHẤT một chuỗi JSON thuần (không kèm markdown, không \`\`\`json):
{
  "loai_doi_tuong": "Di tích lịch sử | Giải mã Hán Nôm | Nhà hàng & Quán ăn | Shop & Workshop | Đặc sản địa phương",
  "ten_dia_diem": "Tên chính xác",
  "dia_chi": "Địa chỉ tại Đà Nẵng hoặc Hội An",
  "nien_dai_hoac_gia": "Niên đại hoặc Mức giá tham khảo",
  "cau_chuyen_lich_su": "Câu chuyện lịch sử hoặc thông tin nổi bật của shop/nhà hàng (3-5 câu).",
  "giai_thoai_dac_biet": "Một giai thoại ít người biết hoặc nét độc đáo.",
  "han_viet": {
    "co_han_viet": true,
    "chu_goc": "Chữ Hán/Nôm (nếu có)",
    "phien_am": "Âm Hán-Việt",
    "phan_tich_tung_tu": ["Chữ 1 (Âm): Nghĩa", "Chữ 2 (Âm): Nghĩa"],
    "y_nghia_tong_the": "Giải thích nghĩa hoàn chỉnh và điển tích."
  },
  "danh_gia_ban_dia": {
    "tom_tat": "Tóm tắt góc nhìn người dân Đà Nẵng - Hội An.",
    "review_mau": ["Nhận xét thật 1", "Nhận xét thật 2"]
  }
}`;

    let response;
    try {
      response = await window.puter.ai.chat(prompt, imageDataUrl, { model: "gemini-2.5-flash" });
    } catch (modelErr) {
      response = await window.puter.ai.chat(prompt, imageDataUrl);
    }

    let rawText = extractTextFromPuter(response).replace(/```json|```/g, "").trim();
    const jsonStart = rawText.indexOf("{");
    const jsonEnd = rawText.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) throw new Error("AI trả về dữ liệu không hợp lệ.");
    const parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));

    const wikiData = await fetchWikipediaSummary(parsed.ten_dia_diem);
    if (wikiData) parsed.wiki_source = wikiData;

    saveToHistory(parsed);
    renderResult(parsed);
    isLockedOnResult = true;
  } catch (err) {
    alert("Lỗi AI: " + (err.message || err));
    previewImg.style.display = "none";
  } finally {
    isProcessing = false;
    reticle.classList.remove("scanning");
    hintText.innerText = "Di chuyển camera sang góc khác để quét tiếp";
  }
}

// ==========================================
// 6. HIỂN THỊ KẾT QUẢ & AUDIO THUYẾT MINH
// ==========================================
function renderResult(data) {
  document.getElementById("res-type").innerText = data.loai_doi_tuong || "KHÁM PHÁ BẢN ĐỊA";
  document.getElementById("res-title").innerText = data.ten_dia_diem || "Địa điểm Đà Nẵng – Hội An";
  document.getElementById("res-addr").innerText = `📍 ${data.dia_chi || "Đà Nẵng – Hội An"} • ${data.nien_dai_hoac_gia || ""}`;

  const bodyEl = document.getElementById("sheet-body");
  bodyEl.innerHTML = "";

  const audioBtn = document.createElement("button");
  audioBtn.className = "audio-btn";
  audioBtn.innerHTML = "<span>🔊</span> <span>Nghe thuyết minh câu chuyện</span>";
  audioBtn.onclick = () =>
    speakStory(`${data.ten_dia_diem}. ${data.cau_chuyen_lich_su} ${data.giai_thoai_dac_biet || ""}`);
  bodyEl.appendChild(audioBtn);

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

  bodyEl.insertAdjacentHTML(
    "beforeend",
    `<div class="info-box">
      <h4>📜 Câu chuyện lịch sử & Thông tin chi tiết</h4>
      <p>${data.cau_chuyen_lich_su || ""}</p>
    </div>`
  );

  if (data.giai_thoai_dac_biet) {
    bodyEl.insertAdjacentHTML(
      "beforeend",
      `<div class="info-box">
        <h4>✨ Giai thoại & Nét đặc trưng</h4>
        <p>${data.giai_thoai_dac_biet}</p>
      </div>`
    );
  }

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
        <button id="submit-review-btn" type="button">Gửi</button>
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
// 7. LỊCH SỬ ĐÃ QUÉT
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
