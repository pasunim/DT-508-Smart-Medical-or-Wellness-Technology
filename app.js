// ===== Constants =====
const WRIST = 0;
const MIDDLE_MCP = 9;
const FINGERTIPS = [8, 12, 16, 20]; // index, middle, ring, pinky
const THUMB_TIP = 4;
const INDEX_TIP = 8;

const DEFAULT_CLOSED_THRESHOLD = 0.9;
const DEFAULT_OPEN_THRESHOLD = 1.3;
const VARIANCE_WINDOW = 30; // frames (~1s at 30fps)
const OPEN_HOLD_MS = 1000; // ต้องแบมือค้างกี่ ms ก่อนเริ่มเก็บ variance

const DEFAULT_TAP_CLOSED_THRESHOLD = 0.3;
const DEFAULT_TAP_OPEN_THRESHOLD = 0.8;
const TAP_DECREMENT_SAMPLE = 3; // เทียบ amplitude เฉลี่ยของ N ครั้งแรก vs N ครั้งสุดท้าย

// threshold ที่ปรับได้จาก debug overlay (ค่าเริ่มต้น = DEFAULT_* ด้านบน)
const thresholds = {
  closed: DEFAULT_CLOSED_THRESHOLD,
  open: DEFAULT_OPEN_THRESHOLD,
  tapClosed: DEFAULT_TAP_CLOSED_THRESHOLD,
  tapOpen: DEFAULT_TAP_OPEN_THRESHOLD,
};

const GAME_DURATION_S = 60;
const GAME_OBJECT_SPEED = 2.5; // px/frame
const GAME_SPAWN_INTERVAL_MS = 1200;
const GAME_CATCH_ZONE_Y = 420;
const GAME_CATCH_RADIUS = 40;

// ===== DOM refs =====
const videoElement = document.querySelector(".input-video");
const canvasElement = document.querySelector(".output-canvas");
const canvasCtx = canvasElement.getContext("2d");

const modeAssessmentBtn = document.getElementById("modeAssessmentBtn");
const modeGameBtn = document.getElementById("modeGameBtn");
const modeTappingBtn = document.getElementById("modeTappingBtn");
const assessmentPanel = document.getElementById("assessmentPanel");
const gamePanel = document.getElementById("gamePanel");
const tappingPanel = document.getElementById("tappingPanel");

const handStateEl = document.getElementById("handState");
const repCountEl = document.getElementById("repCount");
const avgSpeedEl = document.getElementById("avgSpeed");
const varianceEl = document.getElementById("variance");
const resetSessionBtn = document.getElementById("resetSessionBtn");

const gameScoreEl = document.getElementById("gameScore");
const gameTimeEl = document.getElementById("gameTime");
const startGameBtn = document.getElementById("startGameBtn");
const gameResultEl = document.getElementById("gameResult");

const tapStateEl = document.getElementById("tapState");
const tapCountEl = document.getElementById("tapCount");
const tapAmplitudeEl = document.getElementById("tapAmplitude");
const tapDecrementEl = document.getElementById("tapDecrement");
const tapRhythmEl = document.getElementById("tapRhythm");
const resetTappingBtn = document.getElementById("resetTappingBtn");

const debugToggle = document.getElementById("debugToggle");
const debugContent = document.getElementById("debugContent");
const debugCurrentValueEl = document.getElementById("debugCurrentValue");
const debugThresholdsEl = document.getElementById("debugThresholds");
const debugZoneEl = document.getElementById("debugZone");
const debugChart = document.getElementById("debugChart");
const debugChartCtx = debugChart.getContext("2d");

const thresholdControlsMain = document.getElementById("thresholdControlsMain");
const thresholdControlsTapping = document.getElementById("thresholdControlsTapping");
const closedThresholdInput = document.getElementById("closedThresholdInput");
const openThresholdInput = document.getElementById("openThresholdInput");
const closedThresholdValueEl = document.getElementById("closedThresholdValue");
const openThresholdValueEl = document.getElementById("openThresholdValue");
const resetThresholdMainBtn = document.getElementById("resetThresholdMainBtn");
const tapClosedThresholdInput = document.getElementById("tapClosedThresholdInput");
const tapOpenThresholdInput = document.getElementById("tapOpenThresholdInput");
const tapClosedThresholdValueEl = document.getElementById("tapClosedThresholdValue");
const tapOpenThresholdValueEl = document.getElementById("tapOpenThresholdValue");
const resetThresholdTappingBtn = document.getElementById("resetThresholdTappingBtn");

// ===== App state =====
let currentMode = "assessment"; // "assessment" | "game" | "tapping"

const session = {
  state: "UNKNOWN", // "OPEN" | "CLOSED" | "UNKNOWN"
  reps: 0,
  lastOpenTimestamp: null,
  repDurations: [],
  openSinceTimestamp: null,
  distanceWindow: [],
};

const tapping = {
  state: "UNKNOWN", // "OPEN" | "CLOSED" | "UNKNOWN"
  taps: 0,
  currentAmplitude: 0,
  amplitudes: [], // amplitude สูงสุดของแต่ละ tap
  lastOpenTimestamp: null,
  interTapIntervals: [], // วินาทีระหว่าง OPEN ที่ติดกัน
};

const game = {
  running: false,
  score: 0,
  timeLeft: GAME_DURATION_S,
  objects: [],
  lastSpawn: 0,
  timerId: null,
  handX: null,
};

const DEBUG_HISTORY_LENGTH = 150; // ~5s at 30fps
const debug = {
  enabled: true,
  history: [], // ค่า distance ล่าสุด (สำหรับวาดกราฟ)
};

// ===== Geometry helpers =====
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizedFingerDistance(landmarks) {
  const wrist = landmarks[WRIST];
  const middleMcp = landmarks[MIDDLE_MCP];
  const refDist = dist(middleMcp, wrist) || 1e-6;

  const avgFingertipDist =
    FINGERTIPS.reduce((sum, idx) => sum + dist(landmarks[idx], wrist), 0) /
    FINGERTIPS.length;

  return avgFingertipDist / refDist;
}

function normalizedTapDistance(landmarks) {
  const wrist = landmarks[WRIST];
  const middleMcp = landmarks[MIDDLE_MCP];
  const refDist = dist(middleMcp, wrist) || 1e-6;

  return dist(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) / refDist;
}

// ===== State machine (Assessment mode) =====
function updateHandState(normalizedDist, timestamp) {
  let nextState = session.state;

  if (normalizedDist < thresholds.closed) {
    nextState = "CLOSED";
  } else if (normalizedDist > thresholds.open) {
    nextState = "OPEN";
  }
  // ช่วงกลาง (transition zone) -> คง state เดิม (hysteresis)

  if (nextState !== session.state) {
    if (nextState === "OPEN" && session.state === "CLOSED") {
      // ครบ 1 รอบ CLOSED -> OPEN นับเป็น 1 rep
      session.reps += 1;
      repCountEl.textContent = session.reps;

      if (session.lastOpenTimestamp != null) {
        const durationS = (timestamp - session.lastOpenTimestamp) / 1000;
        session.repDurations.push(durationS);
        updateAvgSpeed();
      }
      session.lastOpenTimestamp = timestamp;
    }

    if (nextState === "OPEN") {
      session.openSinceTimestamp = timestamp;
      session.distanceWindow = [];
    } else {
      session.openSinceTimestamp = null;
      varianceEl.textContent = "-";
    }

    session.state = nextState;
    handStateEl.textContent = nextState === "CLOSED" ? "กำมือ (CLOSED)" : "แบมือ (OPEN)";
  }

  if (
    session.state === "OPEN" &&
    session.openSinceTimestamp != null &&
    timestamp - session.openSinceTimestamp >= OPEN_HOLD_MS
  ) {
    session.distanceWindow.push(normalizedDist);
    if (session.distanceWindow.length > VARIANCE_WINDOW) {
      session.distanceWindow.shift();
    }
    if (session.distanceWindow.length >= 5) {
      updateVariance();
    }
  }
}

function updateAvgSpeed() {
  const avg =
    session.repDurations.reduce((a, b) => a + b, 0) / session.repDurations.length;
  avgSpeedEl.textContent = avg.toFixed(2);
}

function updateVariance() {
  const w = session.distanceWindow;
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  const variance = w.reduce((a, b) => a + (b - mean) ** 2, 0) / w.length;
  varianceEl.textContent = variance.toFixed(4);
}

function resetSession() {
  session.state = "UNKNOWN";
  session.reps = 0;
  session.lastOpenTimestamp = null;
  session.repDurations = [];
  session.openSinceTimestamp = null;
  session.distanceWindow = [];

  handStateEl.textContent = "-";
  repCountEl.textContent = "0";
  avgSpeedEl.textContent = "-";
  varianceEl.textContent = "-";
}

// ===== Finger Tapping mode =====
function updateTappingState(tapDist, timestamp) {
  let nextState = tapping.state;

  if (tapDist < thresholds.tapClosed) {
    nextState = "CLOSED";
  } else if (tapDist > thresholds.tapOpen) {
    nextState = "OPEN";
  }
  // ช่วงกลาง (transition zone) -> คง state เดิม (hysteresis)

  if (nextState === "OPEN") {
    tapping.currentAmplitude = Math.max(tapping.currentAmplitude, tapDist);
  }

  if (nextState !== tapping.state) {
    if (nextState === "OPEN" && tapping.state === "CLOSED") {
      // ครบ 1 รอบ CLOSED -> OPEN นับเป็น 1 tap
      tapping.taps += 1;
      tapCountEl.textContent = tapping.taps;

      tapping.amplitudes.push(tapping.currentAmplitude);
      tapAmplitudeEl.textContent = tapping.currentAmplitude.toFixed(2);

      if (tapping.lastOpenTimestamp != null) {
        const intervalS = (timestamp - tapping.lastOpenTimestamp) / 1000;
        tapping.interTapIntervals.push(intervalS);
        updateRhythmIrregularity();
      }
      tapping.lastOpenTimestamp = timestamp;
      updateDecrement();
    }

    if (nextState === "OPEN") {
      tapping.currentAmplitude = tapDist;
    }

    tapping.state = nextState;
    tapStateEl.textContent = nextState === "CLOSED" ? "ชนกัน (CLOSED)" : "กางนิ้ว (OPEN)";
  }
}

function updateDecrement() {
  const n = TAP_DECREMENT_SAMPLE;
  if (tapping.amplitudes.length < n * 2) {
    tapDecrementEl.textContent = "-";
    return;
  }

  const first = tapping.amplitudes.slice(0, n);
  const last = tapping.amplitudes.slice(-n);
  const firstAvg = first.reduce((a, b) => a + b, 0) / n;
  const lastAvg = last.reduce((a, b) => a + b, 0) / n;

  const decrementPct = ((firstAvg - lastAvg) / firstAvg) * 100;
  tapDecrementEl.textContent = decrementPct.toFixed(1);
}

function updateRhythmIrregularity() {
  const intervals = tapping.interTapIntervals;
  if (intervals.length < 3) {
    tapRhythmEl.textContent = "-";
    return;
  }

  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance =
    intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
  const sd = Math.sqrt(variance);
  const cv = sd / mean;

  tapRhythmEl.textContent = cv.toFixed(3);
}

function resetTapping() {
  tapping.state = "UNKNOWN";
  tapping.taps = 0;
  tapping.currentAmplitude = 0;
  tapping.amplitudes = [];
  tapping.lastOpenTimestamp = null;
  tapping.interTapIntervals = [];

  tapStateEl.textContent = "-";
  tapCountEl.textContent = "0";
  tapAmplitudeEl.textContent = "-";
  tapDecrementEl.textContent = "-";
  tapRhythmEl.textContent = "-";
}

// ===== Debug overlay (threshold tuning) =====
function updateDebugOverlay(currentValue, closedThreshold, openThreshold, state) {
  if (!debug.enabled) return;

  debugCurrentValueEl.textContent = currentValue.toFixed(3);
  debugThresholdsEl.textContent = `${closedThreshold.toFixed(2)} / ${openThreshold.toFixed(2)}`;

  let zoneLabel = "Transition";
  if (currentValue < closedThreshold) zoneLabel = "CLOSED zone";
  else if (currentValue > openThreshold) zoneLabel = "OPEN zone";
  debugZoneEl.textContent = `${zoneLabel} (state: ${state})`;

  debug.history.push(currentValue);
  if (debug.history.length > DEBUG_HISTORY_LENGTH) {
    debug.history.shift();
  }

  drawDebugChart(closedThreshold, openThreshold);
}

function drawDebugChart(closedThreshold, openThreshold) {
  const w = debugChart.width;
  const h = debugChart.height;
  debugChartCtx.clearRect(0, 0, w, h);

  const maxVal = Math.max(openThreshold * 1.4, ...debug.history, 0.1);
  const toY = (v) => h - (v / maxVal) * h;

  // เส้น threshold
  debugChartCtx.strokeStyle = "#f5c451";
  debugChartCtx.setLineDash([4, 4]);
  debugChartCtx.beginPath();
  debugChartCtx.moveTo(0, toY(closedThreshold));
  debugChartCtx.lineTo(w, toY(closedThreshold));
  debugChartCtx.stroke();

  debugChartCtx.strokeStyle = "#3b82f6";
  debugChartCtx.beginPath();
  debugChartCtx.moveTo(0, toY(openThreshold));
  debugChartCtx.lineTo(w, toY(openThreshold));
  debugChartCtx.stroke();
  debugChartCtx.setLineDash([]);

  // เส้นค่าจริง
  if (debug.history.length > 1) {
    debugChartCtx.strokeStyle = "#4ade80";
    debugChartCtx.lineWidth = 2;
    debugChartCtx.beginPath();
    debug.history.forEach((v, i) => {
      const x = (i / (DEBUG_HISTORY_LENGTH - 1)) * w;
      const y = toY(v);
      if (i === 0) debugChartCtx.moveTo(x, y);
      else debugChartCtx.lineTo(x, y);
    });
    debugChartCtx.stroke();
  }
}

function resetDebugHistory() {
  debug.history = [];
}

// ===== Game mode =====
function spawnObject() {
  const x = 40 + Math.random() * (canvasElement.width - 80);
  game.objects.push({ x, y: -20, r: 16, caught: false });
}

function updateGame(landmarks, timestamp) {
  if (!game.running) return;

  if (landmarks) {
    const wrist = landmarks[WRIST];
    game.handX = wrist.x * canvasElement.width;
  }

  if (timestamp - game.lastSpawn > GAME_SPAWN_INTERVAL_MS) {
    spawnObject();
    game.lastSpawn = timestamp;
  }

  const isClosed = session.state === "CLOSED";

  game.objects.forEach((obj) => {
    if (obj.caught) return;
    obj.y += GAME_OBJECT_SPEED;

    if (
      game.handX != null &&
      Math.abs(obj.y - GAME_CATCH_ZONE_Y) < 30 &&
      Math.abs(obj.x - game.handX) < GAME_CATCH_RADIUS &&
      isClosed
    ) {
      obj.caught = true;
      game.score += 1;
      gameScoreEl.textContent = game.score;
    }
  });

  game.objects = game.objects.filter(
    (obj) => !obj.caught && obj.y < canvasElement.height + 30
  );
}

function drawGame() {
  if (game.handX != null) {
    canvasCtx.fillStyle = "rgba(59, 130, 246, 0.6)";
    canvasCtx.fillRect(game.handX - 45, GAME_CATCH_ZONE_Y - 10, 90, 20);
  }

  canvasCtx.fillStyle = "#4ade80";
  game.objects.forEach((obj) => {
    canvasCtx.beginPath();
    canvasCtx.arc(obj.x, obj.y, obj.r, 0, Math.PI * 2);
    canvasCtx.fill();
  });
}

function startGame() {
  game.running = true;
  game.score = 0;
  game.timeLeft = GAME_DURATION_S;
  game.objects = [];
  game.lastSpawn = 0;

  gameScoreEl.textContent = "0";
  gameTimeEl.textContent = game.timeLeft;
  gameResultEl.textContent = "";
  startGameBtn.disabled = true;

  if (game.timerId) clearInterval(game.timerId);
  game.timerId = setInterval(() => {
    game.timeLeft -= 1;
    gameTimeEl.textContent = game.timeLeft;
    if (game.timeLeft <= 0) {
      endGame();
    }
  }, 1000);
}

function endGame() {
  game.running = false;
  clearInterval(game.timerId);
  startGameBtn.disabled = false;
  gameResultEl.textContent = `จบเกม! คะแนนรวม: ${game.score} ครั้ง`;
}

// ===== MediaPipe setup =====
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7,
});

hands.onResults(onResults);

function onResults(results) {
  const timestamp = performance.now();

  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

  const landmarks = results.multiHandLandmarks && results.multiHandLandmarks[0];

  if (landmarks) {
    drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {
      color: "#3b82f6",
      lineWidth: 2,
    });
    drawLandmarks(canvasCtx, landmarks, { color: "#4ade80", lineWidth: 1, radius: 3 });

    if (currentMode === "tapping") {
      const tapDist = normalizedTapDistance(landmarks);
      updateTappingState(tapDist, timestamp);
      updateDebugOverlay(tapDist, thresholds.tapClosed, thresholds.tapOpen, tapping.state);
    } else {
      const normalizedDist = normalizedFingerDistance(landmarks);
      updateHandState(normalizedDist, timestamp);
      updateDebugOverlay(normalizedDist, thresholds.closed, thresholds.open, session.state);
      if (currentMode === "game") {
        updateGame(landmarks, timestamp);
      }
    }
  }

  if (currentMode === "game") {
    drawGame();
  }

  canvasCtx.restore();
}

const camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({ image: videoElement });
  },
  width: 640,
  height: 480,
});
camera.start();

// ===== Mode switching =====
function setMode(mode) {
  currentMode = mode;

  modeAssessmentBtn.classList.toggle("active", mode === "assessment");
  modeGameBtn.classList.toggle("active", mode === "game");
  modeTappingBtn.classList.toggle("active", mode === "tapping");

  assessmentPanel.classList.toggle("hidden", mode !== "assessment");
  gamePanel.classList.toggle("hidden", mode !== "game");
  tappingPanel.classList.toggle("hidden", mode !== "tapping");

  thresholdControlsMain.classList.toggle("hidden", mode === "tapping");
  thresholdControlsTapping.classList.toggle("hidden", mode !== "tapping");

  resetDebugHistory();
}

modeAssessmentBtn.addEventListener("click", () => setMode("assessment"));
modeGameBtn.addEventListener("click", () => setMode("game"));
modeTappingBtn.addEventListener("click", () => setMode("tapping"));

// ===== UI events =====
resetSessionBtn.addEventListener("click", resetSession);
startGameBtn.addEventListener("click", startGame);
resetTappingBtn.addEventListener("click", resetTapping);

debugToggle.addEventListener("change", () => {
  debug.enabled = debugToggle.checked;
  debugContent.classList.toggle("hidden", !debug.enabled);
  if (debug.enabled) resetDebugHistory();
});

// ===== Threshold controls (ปรับค่าได้ด้วย slider, default ตาม DEFAULT_* ด้านบน) =====
function syncThresholdInputs() {
  closedThresholdInput.value = thresholds.closed;
  openThresholdInput.value = thresholds.open;
  tapClosedThresholdInput.value = thresholds.tapClosed;
  tapOpenThresholdInput.value = thresholds.tapOpen;

  closedThresholdValueEl.textContent = thresholds.closed.toFixed(2);
  openThresholdValueEl.textContent = thresholds.open.toFixed(2);
  tapClosedThresholdValueEl.textContent = thresholds.tapClosed.toFixed(2);
  tapOpenThresholdValueEl.textContent = thresholds.tapOpen.toFixed(2);
}

closedThresholdInput.addEventListener("input", () => {
  thresholds.closed = parseFloat(closedThresholdInput.value);
  closedThresholdValueEl.textContent = thresholds.closed.toFixed(2);
});

openThresholdInput.addEventListener("input", () => {
  thresholds.open = parseFloat(openThresholdInput.value);
  openThresholdValueEl.textContent = thresholds.open.toFixed(2);
});

resetThresholdMainBtn.addEventListener("click", () => {
  thresholds.closed = DEFAULT_CLOSED_THRESHOLD;
  thresholds.open = DEFAULT_OPEN_THRESHOLD;
  syncThresholdInputs();
});

tapClosedThresholdInput.addEventListener("input", () => {
  thresholds.tapClosed = parseFloat(tapClosedThresholdInput.value);
  tapClosedThresholdValueEl.textContent = thresholds.tapClosed.toFixed(2);
});

tapOpenThresholdInput.addEventListener("input", () => {
  thresholds.tapOpen = parseFloat(tapOpenThresholdInput.value);
  tapOpenThresholdValueEl.textContent = thresholds.tapOpen.toFixed(2);
});

resetThresholdTappingBtn.addEventListener("click", () => {
  thresholds.tapClosed = DEFAULT_TAP_CLOSED_THRESHOLD;
  thresholds.tapOpen = DEFAULT_TAP_OPEN_THRESHOLD;
  syncThresholdInputs();
});

syncThresholdInputs();
