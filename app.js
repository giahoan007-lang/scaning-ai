const video = document.getElementById("camera");
const canvas = document.getElementById("canvas");
const statusPill = document.getElementById("statusPill");
const sheet = document.getElementById("sheet");
const sheetContent = document.getElementById("sheetContent");
const gpsDot = document.getElementById("gpsDot");
const gpsText = document.getElementById("gpsText");

let facingMode = "environment";
let currentStream = null;
let currentCoords = { lat: null, lng: null };
let currentSpeechText = "";
let isSpeaking = false;
let lockedVoice = null;

async function startCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
  }
  try {
    currentStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = currentStream;
  } catch (err) {
    alert("Không mở được camera. Bạn có thể bấm nút 🖼️ để chọn ảnh từ máy.");
  }
}

function initGPS() {
  if (!navigator.geolocation) {
    gpsText.textContent = "Đà Nẵng – Hội An";
    return;
  }
  navigator.geolocation.watchPosition(
    (pos) => {
      currentCoords.lat = pos.coords.latitude;
      currentCoords.lng = pos.coords.longitude;
      gpsDot.classList.add("ready");
      gpsText.textContent = `${currentCoords.lat.toFixed(4)}, ${currentCoords.lng.toFixed(4)}`;
    },
    () => {
      gpsText.textContent = "Đà Nẵng – Hội An";
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 }
  );
}

// Khóa cứng 1 giọng nữ tiếng Việt duy nhất (Linh trên iOS/Mac, HoaiMy trên Windows, Google trên Android)
function getSingleVietnameseVoice() {
  if (lockedVoice) return lockedVoice;
  if (!("speechSynthesis" in window)) return null;

  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  const viVoices = voices.filter((v) =>
    (v.lang || "").toLowerCase().includes("vi")
  );
  lockedVoice =
    viVoices.find((v) => /linh|hoaimy|google/i.test(v.name)) ||
    viVoices[0] ||
    null;

  return lockedVoice;
}

if ("speechSynthesis" in window) {
  getSingleVietnameseVoice();
  window.speechSynthesis.onvoiceschanged = () => {
    if (!lockedVoice) getSingleVietnameseVoice();
  };
}

function updateSpeakButton(playing) {
  const btn = document.getElementById("speakBtn");
  if (!btn) return;
  btn.textContent = playing ? "⏹️ Dừng thuyết minh" : "🔊 Nghe thuyết minh";
}

function speakText(text) {
  if (!("speechSynthesis" in window)) {
    alert("Trình duyệt này chưa hỗ trợ đọc giọng nói.");
    return;
  }

  // Nếu đang đọc mà bấm lại -> dừng đọc
  if (isSpeaking) {
    window.speechSynthesis.cancel();
    isSpeaking = false;
    updateSpeakButton(false);
    return;
  }

  window.speechSynthesis.cancel();
  const cleanText = String(text || "")
    .replace(/[*#_•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleanText) return;

  // Tách thành từng câu ngắn để đọc có ngắt nghỉ tự nhiên và tránh bị iOS cắt giữa chừng
  const sentences = cleanText.match(/[^.!?]+[.!?]*/g) || [cleanText];
  const voice = getSingleVietnameseVoice();

  isSpeaking = true;
  updateSpeakButton(true);

  let index = 0;
  function speakNext() {
    if (!isSpeaking || index >= sentences.length) {
      isSpeaking = false;
      updateSpeakButton(false);
      return;
    }

    const utter = new SpeechSynthesisUtterance(sentences[index].trim());
    utter.lang = "vi-VN";
    if (voice) utter.voice = voice;
    utter.rate = 0.96;
    utter.pitch = 1.04;

    utter.onend = () => {
      index++;
      speakNext();
    };
    utter.onerror = () => {
      isSpeaking = false;
      updateSpeakButton(false);
    };

    window.speechSynthesis.speak(utter);
  }

  speakNext();
}

function closeSheet() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  isSpeaking = false;
  updateSpeakButton(false);
  sheet.classList.remove("open");
}

window.speakText = speakText;
window.closeSheet = closeSheet;

async function scanBase64(imageBase64) {
  const startTime = performance.now();
  statusPill.classList.add("show");
  closeSheet();

  try {
    const locationContext = currentCoords.lat
      ? `GPS(${currentCoords.lat.toFixed(4)}, ${currentCoords.lng.toFixed(4)}) - Đà Nẵng & Hội An`
      : "Đà Nẵng – Hội An";

    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64,
        lat: currentCoords.lat,
        lng: currentCoords.lng,
        locationContext
      })
    });

    const data = await res.json();
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

    if (!res.ok || data.error) {
      renderError(data.error || "Không thể nhận diện hình ảnh.");
    } else {
      renderResult(data, elapsed);
    }
  } catch (err) {
    renderError("Lỗi kết nối máy chủ: " + err.message);
  } finally {
    statusPill.classList.remove("show");
  }
}

function renderError(msg) {
  sheetContent.innerHTML = `
    <div class="sheet-header">
      <div class="badges"><span class="badge-type">THỬ LẠI</span></div>
      <button class="btn-close" onclick="closeSheet()">✕</button>
    </div>
    <h2 class="title">Chưa nhận diện được</h2>
    <div class="error-box">${msg}</div>
    <div class="action-row" style="margin-top: 14px;">
      <button class="btn-primary" onclick="closeSheet()">🔄 Quét lại ngay</button>
    </div>
  `;
  sheet.classList.add("open");
}

function renderResult(data, elapsed) {
  currentSpeechText = `${data.ten_dia_diem || ""}. ${data.cau_chuyen_lich_su || ""} ${data.giai_thoai_dac_biet || ""}`;

  // Khối Dinh dưỡng & Chi tiết sản phẩm (chỉ hiện khi là Vật phẩm / Thức ăn)
  const sp = data.thong_tin_san_pham;
  const productBlock = sp && sp.hien_thi ? `
    <div class="ai-product-card">
      <h4>🥗 Dinh dưỡng & Chi tiết sản phẩm</h4>
      <p><strong>🔥 Chỉ số Calo:</strong> ${sp.calo_uoc_tinh || "Đang cập nhật"}</p>
      <p><strong>💚 Sức khỏe:</strong> ${sp.tot_cho_suc_khoe || "Đang cập nhật"}</p>
      <p><strong>📦 Chi tiết:</strong> ${sp.chi_tiet_san_pham || "Đang cập nhật"}</p>
    </div>
  ` : "";

  // Khối Hán - Nôm (chỉ hiện nếu ảnh có chữ Hán / Nôm)
  const hv = data.han_viet;
  const hanVietBlock = hv && hv.co_han_viet ? `
    <div class="card">
      <h3>🏮 Giải nghĩa Hán – Nôm</h3>
      <p><strong>Chữ gốc:</strong> ${hv.chu_goc || ""} (${hv.phien_am || ""})</p>
      <p>${hv.y_nghia_tong_the || ""}</p>
    </div>
  ` : "";

  // Nút Google Maps tự động đổi theo Địa danh hay Vật phẩm
  const mapButtonBlock = data.hien_chi_duong
    ? `<a class="ai-map-btn" href="${data.chi_duong_url}" target="_blank" rel="noopener">📍 Chỉ đường qua Google Maps</a>`
    : `<a class="ai-map-btn" href="${data.google_maps_url}" target="_blank" rel="noopener">🏪 Tìm Tạp hóa / Siêu thị Minimart gần nhất</a>`;

  const reviewsHtml = (data.danh_gia_ban_dia?.review_mau || [])
    .map((r) => `<div class="review-item"><span class="tag-local">THỔ ĐỊA</span>${r}</div>`)
    .join("");

  sheetContent.innerHTML = `
    <div class="sheet-header">
      <div class="badges">
        <span class="badge-type">${data.loai_doi_tuong || "NHẬN DIỆN"}</span>
        <span class="badge-live">✓ Live AI</span>
      </div>
      <button class="btn-close" onclick="closeSheet()">✕</button>
    </div>

    <h2 class="title">${data.ten_dia_diem || "Kết quả nhận diện"}</h2>
    <div class="meta">📍 ${data.dia_chi || "Đà Nẵng – Hội An"} • ${data.nien_dai_hoac_gia || ""} • ⚡ ${elapsed}s</div>

    <div class="action-row">
      <button id="speakBtn" class="btn-primary" onclick="speakText(currentSpeechText)">🔊 Nghe thuyết minh</button>
      ${mapButtonBlock}
    </div>

    <div class="card">
      <h3>📜 Thông tin & Câu chuyện</h3>
      <p>${data.cau_chuyen_lich_su || ""}</p>
    </div>

    <div class="card">
      <h3>✨ Điểm độc đáo</h3>
      <p>${data.giai_thoai_dac_biet || ""}</p>
    </div>

    ${productBlock}
    ${hanVietBlock}

    <div class="card">
      <h3>💬 Đánh giá từ người địa phương</h3>
      <p>${data.danh_gia_ban_dia?.tom_tat || ""}</p>
      ${reviewsHtml}
    </div>
  `;
  sheet.classList.add("open");
}

document.getElementById("captureBtn").addEventListener("click", () => {
  if (!video.videoWidth) return;
  const maxW = 900;
  const scale = Math.min(1, maxW / video.videoWidth);
  canvas.width = video.videoWidth * scale;
  canvas.height = video.videoHeight * scale;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  const base64 = canvas.toDataURL("image/jpeg", 0.78).split(",")[1];
  scanBase64(base64);
});

document.getElementById("switchBtn").addEventListener("click", () => {
  facingMode = facingMode === "environment" ? "user" : "environment";
  startCamera();
});

document.getElementById("uploadBtn").addEventListener("click", () => {
  document.getElementById("fileInput").click();
});

document.getElementById("fileInput").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const maxW = 900;
      const scale = Math.min(1, maxW / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
      scanBase64(base64);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

startCamera();
initGPS();
