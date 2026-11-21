// ==========================================
// 1. KHỞI TẠO NHANH (KHÔNG ĐĂNG NHẬP, KHÔNG KEY)
// ==========================================
let scanHistory = JSON.parse(localStorage.getItem("honpho_history") || "[]");
let customReviews = JSON.parse(localStorage.getItem("honpho_custom_reviews") || "{}");
let autoScanEnabled = true;
let isProcessing = false;
let isLockedOnResult = false;
let currentCoords = null;
let nearbyPlaces = [];

// Quét siêu nhanh: kiểm tra mỗi 150ms, giữ yên 0.6 giây (4 nhịp) là chụp ngầm ngay
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

renderHistoryTab();
startCamera(false);
setInterval(autoScanLoop, 150);

// ==========================================
// 2. CAMERA CHUẨN SAFARI IPHONE
// ==========================================
async function startCamera(isUserTap) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    cameraFallback.style.display = "block";
    camErrorMsg.innerText = "Trình duyệt trong app khác chặn Camera. Hãy mở bằng Safari hoặc dùng Ảnh mẫu!";
    hintText.innerText = "Bấm Ảnh mẫu để chụp & quét ngay";
    return;
  }

  const safetyTimer = setTimeout(() => {
    if (video.readyState < 2) {
      cameraFallback.style.display = "block";
      camErrorMsg.innerText = "Chạm nút vàng phía trên để cấp quyền bật Camera.";
    }
  }, 2000);

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
    hintText.innerText = "Hướng camera vào địa điểm, di tích hoặc quán ăn...";
  } catch (err) {
    clearTimeout(safetyTimer);
    cameraFallback.style.display = "block";
    camErrorMsg.innerText = isUserTap
      ? "iPhone đang khóa Camera web này. Vào biểu tượng bên trái link → Cài đặt trang web → Camera → Cho phép."
      : "Chạm nút vàng phía trên để cấp quyền bật Camera.";
    hintText.innerText = "Chạm nút bật Camera hoặc chọn Ảnh mẫu";
  }
}

// ==========================================
// 3. ĐỊNH VỊ GPS & RADAR OPENSTREETMAP
// ==========================================
function requestGPS() {
  if (!navigator.geolocation) {
    gpsText.innerText = "Không hỗ trợ GPS";
    return;
  }
  gpsText.innerText = "Đang lấy vị trí...";
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
      gpsText.innerText = err.code === 1 ? "Bật Vị trí trong Cài đặt" : "Chạm thử lại GPS";
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
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
  } catch (e) {}
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
// 4. VÒNG LẶP QUÉT TỰ ĐỘNG (0.6 GIÂY)
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
    if (moveDiff > 20) {
      isLockedOnResult = false;
      closeSheet();
      hintText.innerText = "Góc nhìn mới — giữ yên để quét...";
    }
    prevFrameData = currentSig;
    return;
  }

  const diff = calcFrameDiff(currentSig, prevFrameData);
  prevFrameData = currentSig;

  if (diff < 7.5) {
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
    hintText.innerText = "Hướng camera vào địa điểm, di tích hoặc quán ăn...";
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

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.getElementById("work-canvas");
      const scale = Math.min(1, 512 / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const compressedUrl = canvas.toDataURL("image/jpeg", 0.65);

      previewImg.src = compressedUrl;
      previewImg.style.display = "block";
      analyzeViaServer(compressedUrl.split(",")[1]);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function captureAndAnalyze() {
  const canvas = document.getElementById("work-canvas");
  const scale = Math.min(1, 512 / (video.videoWidth || 512));
  canvas.width = (video.videoWidth || 512) * scale;
  canvas.height = (video.videoHeight || 384) * scale;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.65);
  analyzeViaServer(dataUrl.split(",")[1]);
}

// ==========================================
// 5. GỌI SERVER VERCEL (/api/scan) SIÊU TỐC
// ==========================================
async function analyzeViaServer(base64Image) {
  isProcessing = true;
  reticle.classList.add("scanning");
  hintText.innerText = "Đang nhận diện thông tin...";

  const namesList = nearbyPlaces.map((p) => p.name);
  const locationContext = currentCoords
    ? `Tọa độ GPS: (${currentCoords.lat}, ${currentCoords.lng}). Địa điểm lân cận: ${namesList.length ? namesList.join(", ") : "Chưa rõ"}.`
    : "Khu vực Đà Nẵng - Hội An.";

  try {
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: base64Image, locationContext })
    });

    const parsed = await res.json();
    if (!res.ok || parsed.error) {
      throw new Error(parsed.error || "Không thể kết nối máy chủ phân tích.");
    }

    saveToHistory(parsed);
    renderResult(parsed);
    isLockedOnResult = true;

    fetchWikipediaBackground(parsed.ten_dia_diem);
  } catch (err) {
    alert("Lỗi quét: " + err.message);
    previewImg.style.display = "none";
  } finally {
    isProcessing = false;
    reticle.classList.remove("scanning");
    hintText.innerText = "Xoay camera sang góc khác để quét tiếp";
  }
}

async function fetchWikipediaBackground(placeName) {
  if (!placeName) return;
  try {
    const searchUrl = `https://vi.wikipedia.org/w/api.php?origin=*&action=query&list=search&srsearch=${encodeURIComponent(placeName)}&format=json&utf8=1`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    if (!searchData.query?.search?.length) return;

    const pageTitle = searchData.query.search[0].title;
    const wikiUrl = `https://vi.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`;
    const linksBox = document.getElementById("live-source-links");
    if (linksBox) {
      linksBox.insertAdjacentHTML(
        "afterbegin",
        `<a class="source-link" href="${wikiUrl}" target="_blank">📚 Tư liệu Wikipedia: ${pageTitle} ↗</a>`
      );
    }
  } catch (e) {}
}

// ==========================================
// 6. HIỂN THỊ KẾT QUẢ (CHỈ HIỆN HÁN-VIỆT KHI CÓ)
// ==========================================
function renderResult(data) {
  document.getElementById("res-type").innerText = data.loai_doi_tuong || "KHÁM PHÁ";
  document.getElementById("res-title").innerText = data.ten_dia_diem || "Địa điểm Đà Nẵng – Hội An";
  document.getElementById("res-addr").innerText = `📍 ${data.dia_chi || "Đà Nẵng – Hội An"}${data.nien_dai_hoac_gia ? " • " + data.nien_dai_hoac_gia : ""}`;

  const bodyEl = document.getElementById("sheet-body");
  bodyEl.innerHTML = "";

  // Nút nghe thuyết minh
  const audioBtn = document.createElement("button");
  audioBtn.className = "audio-btn";
  audioBtn.innerHTML = "<span>🔊</span> <span>Nghe thuyết minh</span>";
  audioBtn.onclick = () =>
    speakStory(`${data.ten_dia_diem}. ${data.cau_chuyen_lich_su} ${data.giai_thoai_dac_biet || ""}`);
  bodyEl.appendChild(audioBtn);

  // CHỈ hiển thị khung dịch Hán-Việt khi ảnh thực sự có chữ Hán/Nôm
  if (data.han_viet && data.han_viet.co_han_viet === true && (data.han_viet.chu_goc || data.han_viet.phien_am)) {
    const chipsHtml = (data.han_viet.phan_tich_tung_tu || [])
      .map((item) => `<span class="hanviet-chip">${item}</span>`)
      .join("");

    bodyEl.insertAdjacentHTML(
      "beforeend",
      `<div class="hannom-box">
        <h4>🀄 Dịch & Phân tích Hán-Việt</h4>
        ${data.han_viet.chu_goc ? `<div class="hannom-chars">${data.han_viet.chu_goc}</div>` : ""}
        ${data.han_viet.phien_am ? `<div class="hannom-phonetic">Âm Hán-Việt: ${data.han_viet.phien_am}</div>` : ""}
        ${chipsHtml ? `<div class="hanviet-breakdown">${chipsHtml}</div>` : ""}
        <p>${data.han_viet.y_nghia_tong_the || ""}</p>
      </div>`
    );
  }

  // Thông tin & Câu chuyện
  bodyEl.insertAdjacentHTML(
    "beforeend",
    `<div class="info-box">
      <h4>📜 Thông tin & Câu chuyện</h4>
      <p>${data.cau_chuyen_lich_su || ""}</p>
    </div>`
  );

  if (data.giai_thoai_dac_biet) {
    bodyEl.insertAdjacentHTML(
      "beforeend",
      `<div class="info-box">
        <h4>✨ Điểm độc đáo</h4>
        <p>${data.giai_thoai_dac_biet}</p>
      </div>`
    );
  }

  // Đánh giá từ người địa phương
  const placeKey = data.ten_dia_diem || "default";
  const aiReviews = data.danh_gia_ban_dia?.review_mau || [];
  const savedUserReviews = customReviews[placeKey] || [];
  const reviewsHtml = [
    ...aiReviews.map((r) => `<div class="review-item"><span class="local-tag">THỔ ĐỊA</span>${r}</div>`),
    ...savedUserReviews.map((r) => `<div class="review-item"><span class="local-tag">BẠN • GPS</span>${r}</div>`)
  ].join("");

  bodyEl.insertAdjacentHTML(
    "beforeend",
    `<div class="info-box">
      <h4>💬 Đánh giá từ người địa phương</h4>
      <p>${data.danh_gia_ban_dia?.tom_tat || ""}</p>
      <div id="local-reviews-container">${reviewsHtml}</div>
      <div class="add-review-form">
        <input type="text" id="new-review-input" placeholder="Thêm đánh giá thật của bạn..." />
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

  // Link chỉ đường & tra cứu trực tiếp
  const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(data.ten_dia_diem + " " + (data.dia_chi || "Đà Nẵng Hội An"))}`;
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.ten_dia_diem + " " + (data.dia_chi || "Đà Nẵng Hội An"))}`;

  bodyEl.insertAdjacentHTML(
    "beforeend",
    `<div class="info-box">
      <h4>🔗 Điều hướng & Tra cứu</h4>
      <div class="source-links" id="live-source-links">
        <a class="source-link" href="${googleMapsUrl}" target="_blank">🗺️ Chỉ đường & Review trên Google Maps ↗</a>
        <a class="source-link" href="${googleSearchUrl}" target="_blank">🌐 Xem thêm trên Google Search ↗</a>
      </div>
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
  utter.rate = 1.05;
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
