// --- 1. インポート設定 (CDN URL修正済み) ---
import { FilesetResolver, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs";

// --- 2. 設定データ ---
const PETS_BASE_CONFIG = {
    usako:  { defaultName: "うさこ", type: "rabbit", defaultExt: "png" },
    kuro:   { defaultName: "くろ",   type: "rabbit", defaultExt: "mp4" },
    taro:   { defaultName: "タロウ", type: "dog",    defaultExt: "png" },
    marple: { defaultName: "マープル", type: "dog",    defaultExt: "png" },
    pochi:  { defaultName: "ポチ",   type: "dog",    defaultExt: "png" },
    tama:   { defaultName: "タマ",   type: "cat",    defaultExt: "png" }
};

const SPECIAL_FILES = {
    usako: { n3: 'mp4', p1: 'mp4', p2: 'mp4', p5: 'mp4' },
    kuro:  { p3: 'png', p4: 'png', p6: 'png', p7: 'png' }
};

const SOUND_PATHS = {
    eating: "assets/sounds/eating.mp3",
    drinking: "assets/sounds/drinking.mp3",
    pee: "assets/sounds/pee.mp3"
};

// --- 3. グローバル変数 ---
let userSettings = JSON.parse(localStorage.getItem('aiPetUserSettings')) || {};
let currentPetId = localStorage.getItem('currentPetId') || 'taro';
let currentState = 'n1';
let lastInteractionTime = Date.now();
let strokeCount = 0;
let timers = { p2: 0, p5: 0, p6: 0, p7: 0 };

let faceLandmarker;
let video;
let visionRunning = false;

const imgElem = document.getElementById('pet-image');
const vidElem = document.getElementById('pet-video');
const msgElem = document.getElementById('message');

// ユーザー設定取得ヘルパー
function getCurrentPetSettings() {
    if (!userSettings[currentPetId]) {
        userSettings[currentPetId] = {
            displayName: PETS_BASE_CONFIG[currentPetId].defaultName,
            keywords: ["かわいい", "いい子", "大好き", "おいで"] 
        };
    }
    return userSettings[currentPetId];
}

// --- 4. 起動プロセス (Startボタンで発火) ---
window.startApp = async function() {
    console.log("App Starting...");
    const overlay = document.getElementById('start-overlay');
    overlay.style.display = 'none';

    // iOS等の音声再生制限解除
    const silentAudio = new Audio();
    silentAudio.play().catch(()=>{});

    msgElem.innerText = "AI読込中...";
    
    try {
        await setupVision(); // AIモデル読み込み
        setupCamera();       // カメラ起動
        setupTouchEvents();  // タッチ検知
        setupSpeechRecognition(); // 音声認識
        
        renderPetList();     
        applyState('n1');    
        updateStateLoop();
        
        console.log("App Started Successfully");
    } catch (error) {
        console.error(error);
        alert("起動エラー: " + error.message);
        msgElem.innerText = "エラー発生";
    }
};

// --- 5. MediaPipe AIセットアップ ---
async function setupVision() {
    // Wasmファイルのパスを指定
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
        },
        outputFaceBlendshapes: true,
        runningMode: "VIDEO",
        numFaces: 1
    });
}

function setupCamera() {
    video = document.getElementById("webcam");
    const constraints = { video: { facingMode: "user", width: 480, height: 360 } };

    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
        video.srcObject = stream;
        visionRunning = true;
    }).catch((err) => {
        console.warn("Camera init failed:", err);
        msgElem.innerText = "カメラ許可が必要です";
    });
}

// --- 6. メインループ ---
function updateStateLoop() {
    const now = Date.now();
    let nextState = 'n1';

    if (now < timers.p5) nextState = 'p5';
    else if (now < timers.p6) nextState = 'p6';
    else if (now < timers.p7) nextState = 'p7';
    else if (now < timers.p2) nextState = 'p2';
    
    if (nextState !== currentState) applyState(nextState);
    if (visionRunning) predictWebcam();
    requestAnimationFrame(updateStateLoop);
}

// AI予測処理
let lastVideoTime = -1;
function predictWebcam() {
    if (!faceLandmarker || !video || !video.videoWidth) return;
    
    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const result = faceLandmarker.detectForVideo(video, Date.now());
        
        if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
            const shapes = result.faceBlendshapes[0].categories;
            detectEmotion(shapes);
        }
    }
}

function detectEmotion(shapes) {
    const smile = (shapes.find(s => s.categoryName === "mouthSmileLeft")?.score + 
                   shapes.find(s => s.categoryName === "mouthSmileRight")?.score) / 2;
    const eyeWide = (shapes.find(s => s.categoryName === "eyeLookOutLeft")?.score + 
                     shapes.find(s => s.categoryName === "eyeLookOutRight")?.score) / 2;

    if (smile > 0.5 && eyeWide < 0.4) {
        if (currentState !== 'p2') triggerJoy("笑顔に反応！");
    }
}

// --- 7. 状態適用・表示 ---
function applyState(state) {
    currentState = state;
    const baseConfig = PETS_BASE_CONFIG[currentPetId];
    const userConfig = getCurrentPetSettings();

    let ext = baseConfig.defaultExt;
    if (SPECIAL_FILES[currentPetId] && SPECIAL_FILES[currentPetId][state]) {
        ext = SPECIAL_FILES[currentPetId][state];
    }
    const filePath = `assets/${currentPetId}/${state}.${ext}`;
    const isVideo = (ext === 'mp4');

    imgElem.className = 'pet-media'; 
    vidElem.className = 'pet-media';
    
    let animClass = '';
    if (state === 'p2') animClass = 'happy-p2-animation';
    else if (state === 'p5' || state === 'p6') animClass = 'eating-rock';
    else if (state === 'p7') animClass = 'toilet-squat';
    
    updateMessage(state, userConfig.displayName);

    if (isVideo) {
        imgElem.classList.add('hidden');
        vidElem.classList.remove('hidden');
        if (animClass) vidElem.classList.add(animClass);
        if (!vidElem.src.includes(filePath)) {
            vidElem.src = filePath;
            vidElem.play().catch(()=>{});
        }
    } else {
        vidElem.classList.add('hidden');
        imgElem.classList.remove('hidden');
        if (animClass) imgElem.classList.add(animClass);
        imgElem.src = filePath;
        vidElem.pause();
    }
    
    playSoundForState(state, baseConfig.type);
}

function updateMessage(state, name) {
    const msgs = {
        n1: `${name}はこっちを見ている`,
        p2: `${name}は喜んで甘えている！`,
        p5: `${name}はごはん中`,
        p7: `${name}はトイレ中...`,
        p1: `${name}は遊んでいる`
    };
    msgElem.innerText = msgs[state] || name;
}

function playSoundForState(state, animalType) {
    let src = null;
    if (state === 'p2') src = `assets/sounds/bark_${animalType}.mp3`;
    else if (state === 'p5') src = SOUND_PATHS.eating;
    else if (state === 'p6') src = SOUND_PATHS.drinking;
    else if (state === 'p7') src = SOUND_PATHS.pee;

    if (src) {
        // 同じ音が連続してうるさくならないよう簡易制御
        const audio = new Audio(src);
        audio.volume = 0.5;
        audio.play().catch(()=>{});
    }
}

// --- 8. 入力系 (タッチ・音声) ---
function setupTouchEvents() {
    const container = document.getElementById('pet-container');
    const handleStroke = () => {
        strokeCount++;
        if (strokeCount > 20) {
            triggerJoy("なでなで中...");
            strokeCount = 0;
        }
    };
    container.addEventListener('touchmove', handleStroke, { passive: true });
    container.addEventListener('mousemove', (e) => { if (e.buttons === 1) handleStroke(); });
}

function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
        const last = event.results.length - 1;
        const text = event.results[last][0].transcript.trim();
        processSpeech(text);
    };
    recognition.onend = () => { try { recognition.start(); } catch(e){} };
    try { recognition.start(); } catch(e){}
}

function processSpeech(text) {
    const userConfig = getCurrentPetSettings();
    const cleanText = text.replace(/ /g, "");
    const triggerWords = [...userConfig.keywords, userConfig.displayName];
    
    if (triggerWords.some(word => cleanText.includes(word))) {
        triggerJoy(`${userConfig.displayName}が反応！`);
    } else if (cleanText.includes("ごはん")) setTimer('p5', 5);
    else if (cleanText.includes("水")) setTimer('p6', 5);
    else if (cleanText.includes("トイレ")) setTimer('p7', 4);
}

function triggerJoy(msg) {
    setTimer('p2', 4);
    if (msg) msgElem.innerText = msg;
}

function setTimer(state, sec) {
    timers[state] = Date.now() + sec * 1000;
    lastInteractionTime = Date.now();
}

// --- 9. 設定メニュー関連 (Window関数として公開) ---
window.toggleSettings = function() {
    const modal = document.getElementById('settings-modal');
    modal.classList.toggle('hidden');
    if (!modal.classList.contains('hidden')) {
        renderPetList();
        renderEditForm();
    }
};

window.changePet = function(id) {
    currentPetId = id;
    localStorage.setItem('currentPetId', id);
    renderPetList();
    renderEditForm();
    applyState('n1');
};

function renderPetList() {
    const list = document.getElementById('pet-list-scroll');
    list.innerHTML = Object.entries(PETS_BASE_CONFIG).map(([id, p]) => {
        const savedName = userSettings[id] ? userSettings[id].displayName : p.defaultName;
        const isSelected = id === currentPetId ? 'selected-pet' : '';
        return `<div class="pet-option ${isSelected}" onclick="window.changePet('${id}')">${savedName}</div>`;
    }).join('');
}

function renderEditForm() {
    const config = getCurrentPetSettings();
    document.getElementById('edit-name-input').value = config.displayName;
    const keywordList = document.getElementById('keyword-list');
    keywordList.innerHTML = config.keywords.map((word, index) => 
        `<span class="keyword-tag">${word} <b onclick="window.removeKeyword(${index})">×</b></span>`
    ).join('');
}

window.saveName = function() {
    const newName = document.getElementById('edit-name-input').value;
    if (newName) {
        if (!userSettings[currentPetId]) getCurrentPetSettings();
        userSettings[currentPetId].displayName = newName;
        localStorage.setItem('aiPetUserSettings', JSON.stringify(userSettings));
        renderPetList();
        applyState(currentState);
        alert("名前を変更しました");
    }
};

window.addKeyword = function() {
    const input = document.getElementById('new-keyword-input');
    const word = input.value.trim();
    if (word) {
        if (!userSettings[currentPetId]) getCurrentPetSettings();
        userSettings[currentPetId].keywords.push(word);
        localStorage.setItem('aiPetUserSettings', JSON.stringify(userSettings));
        input.value = '';
        renderEditForm();
    }
};

window.removeKeyword = function(index) {
    userSettings[currentPetId].keywords.splice(index, 1);
    localStorage.setItem('aiPetUserSettings', JSON.stringify(userSettings));
    renderEditForm();
};