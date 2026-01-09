import { FilesetResolver, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs";

/* --- 1. 基本設定 (システム定義) --- */
const PETS_BASE_CONFIG = {
    usako:  { defaultName: "うさこ", type: "rabbit", defaultExt: "png" },
    kuro:   { defaultName: "くろ",   type: "rabbit", defaultExt: "mp4" },
    taro:   { defaultName: "タロウ", type: "dog",    defaultExt: "png" },
    marple: { defaultName: "マープル", type: "dog",    defaultExt: "png" },
    pochi:  { defaultName: "ポチ",   type: "dog",    defaultExt: "png" },
    tama:   { defaultName: "タマ",   type: "cat",    defaultExt: "png" }
};

// 特殊ファイル定義 (変更なし)
const SPECIAL_FILES = {
    usako: { n3: 'mp4', p1: 'mp4', p2: 'mp4', p5: 'mp4' },
    kuro:  { p3: 'png', p4: 'png', p6: 'png', p7: 'png' }
};

const SOUND_PATHS = {
    eating: "assets/sounds/eating.mp3",
    drinking: "assets/sounds/drinking.mp3",
    pee: "assets/sounds/pee.mp3"
};

/* --- 2. ユーザーデータ管理 --- */
// ローカルストレージから設定を読み込む、なければ初期値
let userSettings = JSON.parse(localStorage.getItem('aiPetUserSettings')) || {};

// 現在のペットID
let currentPetId = localStorage.getItem('currentPetId') || 'taro';

// 現在選択中のペットの設定を取得するヘルパー
function getCurrentPetSettings() {
    // まだ設定が保存されていない場合は初期値を生成
    if (!userSettings[currentPetId]) {
        userSettings[currentPetId] = {
            displayName: PETS_BASE_CONFIG[currentPetId].defaultName,
            // デフォルトの反応ワード
            keywords: ["かわいい", "いい子", "大好き", "おいで"] 
        };
    }
    return userSettings[currentPetId];
}

/* --- 3. グローバル変数 --- */
let currentState = 'n1';
let lastInteractionTime = Date.now();
let strokeCount = 0;
let timers = { p2: 0, p5: 0, p6: 0, p7: 0 };

let faceLandmarker;
let video;
let visionRunning = false;

// DOM要素
const imgElem = document.getElementById('pet-image');
const vidElem = document.getElementById('pet-video');
const msgElem = document.getElementById('message');

/* --- 4. 起動プロセス --- */
window.startApp = async function() {
    document.getElementById('start-overlay').style.display = 'none';
    new Audio().play().catch(()=>{}); // iOS Audio unlock

    msgElem.innerText = "準備中...";
    
    await setupVision();
    setupCamera();
    setupTouchEvents();
    setupSpeechRecognition(); // ★音声認識セットアップ
    
    renderPetList();     
    applyState('n1');    
    updateStateLoop();   
};

/* --- 5. メインループ & 状態適用 (変更なし部分は省略) --- */
function updateStateLoop() {
    const now = Date.now();
    let nextState = 'n1';

    if (now < timers.p5) nextState = 'p5';
    else if (now < timers.p6) nextState = 'p6';
    else if (now < timers.p7) nextState = 'p7';
    else if (now < timers.p2) nextState = 'p2'; // 喜びモード
    
    if (nextState !== currentState) applyState(nextState);
    if (visionRunning) predictWebcam();
    requestAnimationFrame(updateStateLoop);
}

function applyState(state) {
    currentState = state;
    const baseConfig = PETS_BASE_CONFIG[currentPetId];
    const userConfig = getCurrentPetSettings(); // ユーザー設定の名前を使用

    // --- ファイルパス決定ロジック (変更なし) ---
    let ext = baseConfig.defaultExt;
    if (SPECIAL_FILES[currentPetId] && SPECIAL_FILES[currentPetId][state]) {
        ext = SPECIAL_FILES[currentPetId][state];
    }
    const filePath = `assets/${currentPetId}/${state}.${ext}`;
    const isVideo = (ext === 'mp4');

    // --- UI更新 ---
    imgElem.className = 'pet-media'; 
    vidElem.className = 'pet-media';
    
    let animClass = '';
    if (state === 'p2') animClass = 'happy-p2-animation';
    else if (state === 'p5' || state === 'p6') animClass = 'eating-rock';
    else if (state === 'p7') animClass = 'toilet-squat';
    
    // メッセージ更新（ユーザーが決めた名前を表示）
    updateMessage(state, userConfig.displayName);

    // --- メディア表示 (変更なし) ---
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
    // (変更なし)
    let src = null;
    if (state === 'p2') src = `assets/sounds/bark_${animalType}.mp3`;
    else if (state === 'p5') src = SOUND_PATHS.eating;
    else if (state === 'p6') src = SOUND_PATHS.drinking;
    else if (state === 'p7') src = SOUND_PATHS.pee;

    if (src) {
        const audio = new Audio(src);
        audio.volume = 0.6;
        audio.play().catch(()=>{});
    }
}

/* --- 6. 音声認識 (★新ロジック) --- */
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
        console.log("認識された音声:", text);
        processSpeech(text);
    };
    recognition.onend = () => recognition.start(); // 自動再開
    recognition.start();
}

function processSpeech(text) {
    const userConfig = getCurrentPetSettings();
    const cleanText = text.replace(/ /g, ""); // スペース除去

    // 1. ユーザー定義キーワード (名前、合言葉など) のチェック -> p2 (喜び)
    // 登録された名前(displayName) もキーワードとして扱う
    const triggerWords = [...userConfig.keywords, userConfig.displayName];
    
    // 一つでもマッチすれば反応
    const isMatch = triggerWords.some(word => cleanText.includes(word));

    if (isMatch) {
        triggerJoy(`${userConfig.displayName}が反応した！`);
        return;
    }

    // 2. 共通コマンド (ごはん、トイレなど)
    if (cleanText.includes("ごはん") || cleanText.includes("ご飯")) setTimer('p5', 5);
    else if (cleanText.includes("水") || cleanText.includes("お水")) setTimer('p6', 5);
    else if (cleanText.includes("トイレ")) setTimer('p7', 4);
}

function setTimer(state, sec) {
    timers[state] = Date.now() + sec * 1000;
    lastInteractionTime = Date.now();
    // 次のループで反映される
}

/* --- 7. UI操作・設定保存 (★追加機能) --- */
window.toggleSettings = function() {
    const modal = document.getElementById('settings-modal');
    modal.classList.toggle('hidden');
    if (!modal.classList.contains('hidden')) {
        renderPetList();
        renderEditForm(); // フォームも更新
    }
};

window.changePet = function(id) {
    currentPetId = id;
    localStorage.setItem('currentPetId', id);
    renderPetList();
    renderEditForm(); // ペットを変えたらフォームもその子の内容に
    applyState('n1');
};

// ペット一覧描画
function renderPetList() {
    const list = document.getElementById('pet-list-scroll');
    list.innerHTML = Object.entries(PETS_BASE_CONFIG).map(([id, p]) => {
        // 保存された名前があればそれを表示、なければデフォルト
        const savedName = userSettings[id] ? userSettings[id].displayName : p.defaultName;
        const isSelected = id === currentPetId ? 'selected-pet' : '';
        return `
        <div class="pet-option ${isSelected}" onclick="window.changePet('${id}')">
            ${savedName} <span style="font-size:0.8em; color:#888;">(${p.type})</span>
        </div>`;
    }).join('');
}

// 編集フォーム描画
function renderEditForm() {
    const config = getCurrentPetSettings();
    document.getElementById('edit-name-input').value = config.displayName;
    
    // キーワードリスト表示
    const keywordList = document.getElementById('keyword-list');
    keywordList.innerHTML = config.keywords.map((word, index) => `
        <span class="keyword-tag">
            ${word} <b onclick="window.removeKeyword(${index})">×</b>
        </span>
    `).join('');
}

// 名前保存
window.saveName = function() {
    const newName = document.getElementById('edit-name-input').value;
    if (newName) {
        if (!userSettings[currentPetId]) getCurrentPetSettings(); // 初期化保証
        userSettings[currentPetId].displayName = newName;
        saveToStorage();
        alert(`名前を「${newName}」に変更しました`);
        renderPetList(); // リストの名前も更新
        applyState(currentState); // 画面上の名前も更新
    }
};

// キーワード追加
window.addKeyword = function() {
    const input = document.getElementById('new-keyword-input');
    const word = input.value.trim();
    if (word) {
        if (!userSettings[currentPetId]) getCurrentPetSettings();
        userSettings[currentPetId].keywords.push(word);
        saveToStorage();
        input.value = '';
        renderEditForm();
    }
};

// キーワード削除
window.removeKeyword = function(index) {
    userSettings[currentPetId].keywords.splice(index, 1);
    saveToStorage();
    renderEditForm();
};

function saveToStorage() {
    localStorage.setItem('aiPetUserSettings', JSON.stringify(userSettings));
}

// 既存の関数（MediaPipe, TouchEventなど）はそのまま維持...
// (setupVision, setupCamera, setupTouchEvents, triggerJoy, detectEmotion など)
// ※triggerJoy内のメッセージも userConfig.displayName を使うように微修正すると尚良し