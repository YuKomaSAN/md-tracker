// Global State Variables

let GAS_URL = localStorage.getItem('md_tracker_url') || "";

let worker = null;
let stream = null;
let isProcessing = false;
let isGameActive = false;
let currentCoin = "不明";
let gameStartTime = 0;
let timerInterval = null;
let lastResultTime = 0;
let logData = [];
let filteredData = [];
let deckList = [];
let sessionStartTime = 0;
let pipWindowRef = null;

// Turn Detection State
let isDeterminingTurn = false;
let turnDetectStartTime = 0;
let currentOCRMode = "ALL";
let webglManager = new WebGLManager();

// レイアウト設定
let pipLayoutMode = localStorage.getItem('md_pip_layout') || 'portrait';

// Editing State
let editingRowId = null;
