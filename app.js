// ===== NutriLens App - Main Application Logic =====

const App = {
  // Version
  version: 'v1.0.28',

  // State
  state: {
    currentTab: 'capture',
    apiKey: '',
    selectedModel: 'auto',
    lastWorkingModel: null,
    imageBase64: null,
    imageDataUrl: null,
    imageMimeType: 'image/jpeg',
    currentResult: null,
    currentDetailId: null,
    latestSavedMealId: null,
    currentSummaryDate: null,
    selectedDashboardDate: null,
    mealHistory: [],
    dailySummaries: {},
    chatHistory: [],
    userBody: {
      userName: '',
      birthDate: '',
      gender: 'male',
      currentWeight: 65,
      targetWeight: 60,
      activityLevel: 'moderate',
      bloodPressureSystolic: 120,
      bloodPressureDiastolic: 80,
      routineNotes: '',
    },
    goals: { calories: 1800, protein: 95, fat: 45, carbs: 220 },
    isLoading: false,
  },

  // ===== Initialization =====
  async init() {
    this.renderVersion();
    await this.loadFromStorage();
    this.bindEvents();
    this.renderHistory();
    this.renderDashboard();
    this.renderGoals();
    this.renderChatHistory();
    this.checkApiKey();
  },

  renderVersion() {
    const verEl = document.getElementById('app-version');
    if (verEl) {
      verEl.textContent = this.version;
    }
  },

  // ===== IndexedDB Helpers =====
  initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('NutriLensDB', 1);
      request.onerror = (e) => reject(e);
      request.onsuccess = (e) => resolve(e.target.result);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('nutrilens_data')) {
          db.createObjectStore('nutrilens_data');
        }
      };
    });
  },

  async loadFromStorage() {
    try {
      const db = await this.initDB();
      const transaction = db.transaction(['nutrilens_data'], 'readonly');
      const store = transaction.objectStore('nutrilens_data');
      const request = store.get('app_state');

      let data = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      // マイグレーション: localStorage にデータが残っていれば引き継ぐ
      if (!data) {
        const saved = localStorage.getItem('nutrilens_data');
        if (saved) {
          data = JSON.parse(saved);
          console.log('Migrating data from localStorage to IndexedDB');
          await this._saveDataToDB(db, data);
          localStorage.removeItem('nutrilens_data');
        }
      }

      if (data) {
        this.state.mealHistory = data.mealHistory || [];
        this.state.dailySummaries = data.dailySummaries || {};
        this.state.chatHistory = data.chatHistory || [];
        this.state.goals = data.goals || this.state.goals;
        this.state.userBody = data.userBody || this.state.userBody;
        this.state.apiKey = data.apiKey || '';
        this.state.selectedModel = data.selectedModel || 'auto';
        this.state.lastWorkingModel = data.lastWorkingModel || null;

        // 30日を超過した古い記録の自動クリーンアップ
        const cleaned = this.cleanupExpiredMeals(30);
        const orphanCleaned = this.cleanOrphanDailySummaries();
        if (cleaned || orphanCleaned) {
          await this.saveToStorage();
        }
      }
    } catch (e) {
      console.error('Failed to load from storage:', e);
    }
  },

  // 30日以上前の古い食事データを自動ローテーション（1件ずつ自動削除）
  cleanupExpiredMeals(retentionDays = 30) {
    if (!this.state.mealHistory || this.state.mealHistory.length === 0) return false;

    const now = new Date();
    // 基準日の00:00:00から30日前まで保持
    const cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - retentionDays);
    const cutoffTime = cutoffDate.getTime();

    const initialCount = this.state.mealHistory.length;
    this.state.mealHistory = this.state.mealHistory.filter(m => {
      const mTime = new Date(m.timestamp).getTime();
      return !isNaN(mTime) && mTime >= cutoffTime;
    });

    const removedCount = initialCount - this.state.mealHistory.length;
    this.cleanOrphanDailySummaries();

    if (removedCount > 0) {
      console.log(`Auto-cleaned ${removedCount} meals older than ${retentionDays} days.`);
      return true;
    }
    return false;
  },

  cleanOrphanDailySummaries() {
    if (!this.state.dailySummaries || typeof this.state.dailySummaries !== 'object') return false;
    
    // 存在する全食事の日付一覧（YYYY-MM-DD）を取得
    const activeDates = new Set();
    this.state.mealHistory.forEach(m => {
      const d = new Date(m.timestamp);
      if (!isNaN(d.getTime())) {
        const s = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        activeDates.add(s);
      }
    });

    // 食事データが存在しない日付の dailySummaries を削除
    let changed = false;
    Object.keys(this.state.dailySummaries).forEach(dateKey => {
      if (!activeDates.has(dateKey)) {
        console.log(`Cleaning up orphan daily summary for date with no meals: ${dateKey}`);
        delete this.state.dailySummaries[dateKey];
        changed = true;
      }
    });

    return changed;
  },

  async saveToStorage() {
    const data = {
      mealHistory: this.state.mealHistory,
      dailySummaries: this.state.dailySummaries,
      chatHistory: this.state.chatHistory,
      goals: this.state.goals,
      userBody: this.state.userBody,
      apiKey: this.state.apiKey,
      selectedModel: this.state.selectedModel,
      lastWorkingModel: this.state.lastWorkingModel,
    };
    try {
      const db = await this.initDB();
      await this._saveDataToDB(db, data);
    } catch (e) {
      console.error('Failed to save to storage:', e);
      this.showToast('データの保存に失敗しました', 'error');
    }
  },

  _saveDataToDB(db, data) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['nutrilens_data'], 'readwrite');
      const store = transaction.objectStore('nutrilens_data');
      const request = store.put(data, 'app_state');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  checkApiKey() {
    if (!this.state.apiKey) {
      setTimeout(() => this.openApiModal(), 800);
    } else {
      const keyStatus = document.getElementById('key-status');
      if (keyStatus) {
        keyStatus.textContent = '✓ 設定済み';
        keyStatus.className = 'badge badge-success';
      }
    }
  },

  // ===== Event Binding =====
  bindEvents() {
    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // Upload area
    const uploadArea = document.getElementById('upload-area');
    uploadArea.addEventListener('click', () => document.getElementById('file-input').click());
    uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) this.handleImageFile(file);
    });

    // File input
    document.getElementById('file-input').addEventListener('change', (e) => {
      if (e.target.files[0]) this.handleImageFile(e.target.files[0]);
    });

    // Camera input
    document.getElementById('camera-input').addEventListener('change', (e) => {
      if (e.target.files[0]) this.handleImageFile(e.target.files[0]);
    });



    // Analyze button
    document.getElementById('btn-analyze').addEventListener('click', () => this.analyzeImage());

    // Reset button
    document.getElementById('btn-reset').addEventListener('click', () => this.resetCapture());

    // Re-analyze button
    document.getElementById('btn-reanalyze').addEventListener('click', () => this.resetCapture());

    // API settings
    document.getElementById('btn-api-settings').addEventListener('click', () => this.openApiModal());
    document.getElementById('btn-save-api').addEventListener('click', () => this.saveApiKey());
    document.getElementById('btn-cancel-api').addEventListener('click', () => this.closeApiModal());
    document.getElementById('btn-toggle-key').addEventListener('click', () => this.toggleApiKeyVisibility());

    // API key input - enter to save
    document.getElementById('api-key-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveApiKey();
    });

    // Modal overlay click
    document.getElementById('api-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeApiModal();
    });

    // Goal & Weight inputs
    document.querySelectorAll('.goal-input').forEach(input => {
      input.addEventListener('change', () => this.saveGoals());
    });
    ['user-current-weight', 'user-target-weight', 'user-activity-level'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => this.calculateGoalsFromWeight());
        el.addEventListener('change', () => this.calculateGoalsFromWeight());
      }
    });

    // Clear history
    document.getElementById('btn-clear-history').addEventListener('click', () => this.clearHistory());

    // AI Chat events
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('btn-send-chat');
    const clearChatBtn = document.getElementById('btn-clear-chat');
    const micChatBtn = document.getElementById('btn-mic-chat');

    if (micChatBtn) {
      micChatBtn.addEventListener('click', () => this.toggleSpeechRecognition());
    }

    if (sendChatBtn) {
      sendChatBtn.addEventListener('click', () => {
        this.stopSpeechRecognition();
        this.sendChatMessageFromInput();
      });
    }

    if (clearChatBtn) {
      clearChatBtn.addEventListener('click', () => this.clearChatHistory());
    }

    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.stopSpeechRecognition();
          this.sendChatMessageFromInput();
        }
      });
      // 自動高さ調整
      chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
      });
    }
  },

  // ===== Tab Navigation =====
  switchTab(tab) {
    this.state.currentTab = tab;
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `tab-${tab}`);
    });
    if (tab === 'dashboard') this.renderDashboard();
    if (tab === 'history') this.renderHistory();
    if (tab === 'chat') {
      this.renderChatHistory(true);
      const chatInput = document.getElementById('chat-input');
      if (chatInput) setTimeout(() => chatInput.focus(), 150);
    }
  },

  // ===== Image Handling =====
  async handleImageFile(file) {
    if (!file.type.startsWith('image/')) {
      this.showToast('画像ファイルを選択してください', 'error');
      return;
    }

    try {
      // iPhone等の高解像度写真対策：Canvasで長辺850px・JPEG品質0.72に最適圧縮（通信速度・API応答を最大化）
      const compressed = await this.compressImage(file, 850, 0.72);
      this.state.imageDataUrl = compressed.dataUrl;
      this.state.imageBase64 = compressed.base64;
      this.state.imageMimeType = compressed.mimeType;
      this.showPreview(compressed.dataUrl);
    } catch (err) {
      console.warn('画像圧縮処理フォールバック:', err);
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        const mimeMatch = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
        this.state.imageMimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        this.state.imageDataUrl = dataUrl;
        this.state.imageBase64 = dataUrl.split(',')[1];
        this.showPreview(dataUrl);
      };
      reader.readAsDataURL(file);
    }
  },

  compressImage(file, maxDimension = 850, quality = 0.72) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();

      reader.onload = (e) => {
        img.onload = () => {
          let width = img.width;
          let height = img.height;

          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);
          }

          const resizedDataUrl = canvas.toDataURL('image/jpeg', quality);
          const base64 = resizedDataUrl.split(',')[1];

          resolve({
            dataUrl: resizedDataUrl,
            base64: base64,
            mimeType: 'image/jpeg'
          });
        };
        img.onerror = (err) => reject(new Error('画像の読み込みに失敗しました'));
        img.src = e.target.result;
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  },

  showPreview(dataUrl) {
    document.getElementById('preview-image').src = dataUrl;
    document.getElementById('upload-section').style.display = 'none';
    document.getElementById('preview-section').style.display = 'block';
    document.getElementById('preview-section').classList.add('fade-in');
    document.getElementById('result-section').style.display = 'none';
  },

  resetCapture() {
    this.state.imageBase64 = null;
    this.state.imageDataUrl = null;
    this.state.imageMimeType = 'image/jpeg';
    this.state.currentResult = null;
    document.getElementById('upload-section').style.display = 'block';
    document.getElementById('preview-section').style.display = 'none';
    document.getElementById('result-section').style.display = 'none';
    document.getElementById('loading-section').style.display = 'none';
    document.getElementById('file-input').value = '';
    document.getElementById('camera-input').value = '';
  },

  // ===== AI Analysis =====
  async analyzeImage() {
    if (!this.state.imageBase64) {
      this.showToast('画像を選択してください', 'error');
      return;
    }
    if (!this.state.apiKey) {
      this.showToast('Gemini APIキーを設定してください', 'error');
      this.openApiModal();
      return;
    }

    // Show loading
    const mainText = document.getElementById('loading-main-text');
    const subText = document.getElementById('loading-sub-text');
    if (mainText) mainText.textContent = 'AIが料理を高速分析中...';
    if (subText) subText.textContent = '⚡ 思考待機なしの爆速モードで解析しています';

    document.getElementById('preview-section').style.display = 'none';
    document.getElementById('loading-section').style.display = 'block';
    document.getElementById('result-section').style.display = 'none';

    try {
      const result = await this.callGeminiApi(this.state.imageBase64);
      this.state.currentResult = result;
      this.renderResult(result);
      document.getElementById('loading-section').style.display = 'none';
      document.getElementById('result-section').style.display = 'block';
      document.getElementById('result-section').classList.add('fade-in');

      // 自動保存
      await this.saveMeal(true);
    } catch (err) {
      console.error('Analysis error:', err);
      document.getElementById('loading-section').style.display = 'none';
      document.getElementById('preview-section').style.display = 'block';
      this.showToast(`分析エラー: ${err.message}`, 'error');
    }
  },

  _cachedModels: null,

  async getAvailableModels(apiKey, force = false) {
    if (!force && this._cachedModels && this._cachedModels.length > 0) {
      return this._cachedModels;
    }
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
      );
      if (!response.ok) return null;
      const resText = await response.text();
      let data;
      try {
        data = JSON.parse(resText);
      } catch (e) {
        return null;
      }
      if (!data.models || !Array.isArray(data.models)) return null;

      // generateContent をサポートし、tts/embedding/audio等の非Vision・特殊モデルを除外
      const available = data.models
        .filter(m => {
          if (!m.supportedGenerationMethods || !m.supportedGenerationMethods.includes('generateContent')) {
            return false;
          }
          const name = (m.name || '').toLowerCase();
          if (name.includes('tts') || name.includes('embedding') || name.includes('imagen') || 
              name.includes('audio') || name.includes('realtime') || name.includes('bison') ||
              name.includes('aqa') || name.includes('text-embedding')) {
            return false;
          }
          return true;
        })
        .map(m => m.name.replace(/^models\//, ''));

      this._cachedModels = available;
      return available;
    } catch (e) {
      console.warn('Geminiモデルリスト取得失敗:', e);
      return null;
    }
  },

  async executeGeminiGenerate({ prompt, base64Image = null, mimeType = 'image/jpeg', temperature = 0.1, isJson = true }) {
    // 高速・安定推奨モデル順（Gemini 2.5 Flash -> 2.0 Flash -> 2.0 Flash Lite -> 1.5 Flash -> 2.5 Pro）
    const preferredOrder = [
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest',
      'gemini-2.5-pro',
      'gemini-1.5-pro'
    ];

    let modelsToTry = [];

    // 1. ユーザーが特定のモデルを明示選択している場合、最優先
    if (this.state.selectedModel && this.state.selectedModel !== 'auto') {
      modelsToTry.push(this.state.selectedModel);
    }

    // 2. 直近で正常動作した最速モデルがあれば優先
    if (this.state.lastWorkingModel && !modelsToTry.includes(this.state.lastWorkingModel)) {
      modelsToTry.push(this.state.lastWorkingModel);
    }

    // 3. 高速推奨モデル順
    preferredOrder.forEach(m => {
      if (!modelsToTry.includes(m)) {
        modelsToTry.push(m);
      }
    });

    // 4. キャッシュされた利用可能モデルから追加（同期的にある場合のみ）
    if (this._cachedModels && this._cachedModels.length > 0) {
      this._cachedModels.forEach(m => {
        if (!modelsToTry.includes(m)) {
          modelsToTry.push(m);
        }
      });
    }

    let lastError = null;
    const attemptedModels = [];

    // parts構築
    const parts = [{ text: prompt }];
    if (base64Image) {
      parts.push({
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: base64Image
        }
      });
    }

    for (const modelName of modelsToTry) {
      attemptedModels.push(modelName);

      // 高速化の要：Gemini 2.5系等の思考（Thinking）モードを無効化し、思考待機時間をゼロにして即時応答させる
      const tryPayloads = [
        // パターンA: thinkingBudget = 0 で超高速生成（Gemini 2.5 Flash / 2.5 Pro等）
        {
          contents: [{ parts }],
          generationConfig: {
            temperature: temperature,
            ...(isJson ? { responseMimeType: 'application/json' } : {}),
            thinkingConfig: {
              thinkingBudget: 0
            }
          }
        },
        // パターンB: thinkingConfig非対応モデル（Gemini 2.0 / 1.5等）用のフォールバック
        {
          contents: [{ parts }],
          generationConfig: {
            temperature: temperature,
            ...(isJson ? { responseMimeType: 'application/json' } : {})
          }
        }
      ];

      for (let pIdx = 0; pIdx < tryPayloads.length; pIdx++) {
        const payload = tryPayloads[pIdx];
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒タイムアウト

        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.state.apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: controller.signal
            }
          );
          clearTimeout(timeoutId);

          const resText = await response.text();

          if (!response.ok) {
            let msg = `HTTPエラー ${response.status}`;
            let isThinkingConfigError = false;
            try {
              const errJson = JSON.parse(resText);
              msg = errJson?.error?.message || msg;
              if (msg.includes('thinkingConfig') || msg.includes('thinking_budget') || msg.includes('Unknown field')) {
                isThinkingConfigError = true;
              }
            } catch (e) {}

            // thinkingConfigが未対応でエラーになった場合は、直ちにパターンB（thinkingConfigなし）で即再試行
            if (isThinkingConfigError && pIdx === 0) {
              console.log(`モデル [${modelName}] はthinkingConfig非対応のため、標準設定で再試行します...`);
              continue;
            }

            console.warn(`Geminiモデル [${modelName}] 利用不可 (${msg})。フォールバックを試みます...`);
            lastError = new Error(`モデル [${modelName}]: ${msg}`);
            break; // 次のモデルへ
          }

          let data;
          try {
            data = JSON.parse(resText);
          } catch (e) {
            console.warn(`モデル [${modelName}] レスポンスJSONパース失敗。フォールバックを試みます...`);
            lastError = new Error(`モデル [${modelName}] レスポンス形式エラー`);
            break;
          }

          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) {
            console.warn(`モデル [${modelName}] からテキスト取得失敗。フォールバックを試みます...`);
            lastError = new Error(`モデル [${modelName}]: テキスト取得失敗`);
            break;
          }

          // 成功したモデルを記録・キャッシュして次回以降直行させる
          if (this.state.lastWorkingModel !== modelName) {
            this.state.lastWorkingModel = modelName;
            this.saveToStorage().catch(() => {});
          }

          if (!isJson) {
            return text.trim();
          }

          // マークダウン装飾（```json ... ```）の除去とJSON抽出
          let cleanText = text.trim();
          cleanText = cleanText.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
          const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
          const jsonStr = jsonMatch ? jsonMatch[0] : cleanText;

          try {
            return JSON.parse(jsonStr);
          } catch (parseErr) {
            console.warn(`モデル [${modelName}] JSON構文解析失敗:`, parseErr);
            lastError = new Error(`モデル [${modelName}]: JSON構文解析失敗`);
            break;
          }

        } catch (err) {
          clearTimeout(timeoutId);
          console.warn(`モデル [${modelName}] 呼び出し例外:`, err.name === 'AbortError' ? 'タイムアウト(15秒)' : err.message);
          lastError = err;
          break; // 次のモデルへ
        }
      }
    }

    throw lastError || new Error(`利用可能なGeminiモデルが見つかりませんでした (試行: ${attemptedModels.slice(0, 3).join(', ')})`);
  },

  async callGeminiApi(base64Image) {
    const ub = this.state.userBody || {};
    const uName = ub.userName ? `${ub.userName}さん` : '';
    const curW = ub.currentWeight || 65;
    const tarW = ub.targetWeight || 60;
    const goalCal = this.state.goals?.calories || 1800;
    const diff = (tarW - curW).toFixed(1);
    const age = this.getAge(ub.birthDate);
    const genderStr = ub.gender === 'female' ? '女性' : ub.gender === 'male' ? '男性' : '';
    const bpStr = (ub.bloodPressureSystolic && ub.bloodPressureDiastolic)
      ? `血圧:${ub.bloodPressureSystolic}/${ub.bloodPressureDiastolic}mmHg`
      : '';
    const extraInfo = [
      uName,
      age !== null ? `${age}歳` : '',
      genderStr,
      bpStr
    ].filter(Boolean).join(', ');

    let goalStr = `現在の体重: ${curW}kg, 目標体重: ${tarW}kg (${diff < 0 ? `減量 ${Math.abs(diff)}kg 目標` : diff > 0 ? `増量 ${diff}kg 目標` : '体重維持目標'}, 1日目標: ${goalCal}kcal)${extraInfo ? `, プロフィール:[${extraInfo}]` : ''}`;
    if (ub.routineNotes) {
      goalStr += `, 生活習慣・ルーティン・特記事項: [${ub.routineNotes}]`;
    }

    const prompt = `この料理の写真を詳しく分析して、以下のJSON形式で栄養情報を返してください。
ユーザーの身体・目標・生活ルーティン情報: 【${goalStr}】
aiCommentには、このユーザー（${uName || 'ユーザー'}）の目標（${diff < 0 ? '減量' : diff > 0 ? '増量' : '維持'}）および生活ルーティン・特記事項（設定されている場合）を考慮した個別アドバイスに加えて、分析した特徴的な栄養素が体にどのような効果（メリット）や悪影響（デメリット）をもたらすかを具体的に含め、日本語3〜4文程度で記述してください。${uName ? `可能であれば文頭などで自然に「${uName}」と呼びかけてください。` : ''}
推定値で構いません。必ずJSON形式のみで返し、説明文は不要です。
itemsには写真に写っている個々のおかず・食材をそれぞれ列挙してください。

{
  "foodName": "献立全体の名前（日本語）",
  "foodNameEn": "Food name in English",
  "calories": 数値（全体のkcal）,
  "servingSize": "提供量の説明（例: 1人前 約300g）",
  "items": [
    {
      "name": "おかず名（例：白米）",
      "emoji": "絵文字1文字",
      "calories": 数値（kcal）,
      "weight": "推定重量（例: 約150g）",
      "pfc": { "protein": 数値（g）, "fat": 数値（g）, "carbs": 数値（g）},
      "mainNutrients": "主な栄養素の特徴（日本語1文）"
    }
  ],
  "pfc": {
    "protein": 数値（g）,
    "fat": 数値（g）,
    "carbs": 数値（g）
  },
  "nutrients": {
    "fiber": 数値（g）,
    "sodium": 数値（mg）,
    "calcium": 数値（mg）,
    "iron": 数値（mg）,
    "vitaminC": 数値（mg）,
    "vitaminA": 数値（μg）
  },
  "healthScore": 数値（1-10、健康的かどうか）,
  "aiComment": "この食事についての健康・目標アドバイスと栄養素の効果（日本語、3〜4文程度）"
}`;

    return await this.executeGeminiGenerate({
      prompt,
      base64Image,
      mimeType: this.state.imageMimeType || 'image/jpeg',
      temperature: 0.1
    });
  },

  // ===== Result Rendering =====
  renderResult(result) {
    // Food name
    document.getElementById('result-food-name').textContent = result.foodName || '不明な料理';
    document.getElementById('result-food-name-en').textContent = result.foodNameEn || '';

    // Serving size
    const servingEl = document.getElementById('result-serving');
    if (servingEl) servingEl.textContent = result.servingSize || '';

    // Health score badge
    const healthScore = result.healthScore || 5;
    const badgeEl = document.getElementById('result-health-badge');
    if (badgeEl) {
      badgeEl.textContent = `健康スコア ${healthScore}/10`;
      badgeEl.className = `badge ${healthScore >= 7 ? 'badge-success' : 'badge-warning'}`;
    }

    // Calorie ring
    const calories = result.calories || 0;
    document.getElementById('result-calories').textContent = calories;
    const goalCal = this.state.goals.calories;
    const ratio = Math.min(calories / goalCal, 1);
    const circumference = 283;
    const offset = circumference - (circumference * ratio);
    setTimeout(() => {
      const ring = document.getElementById('calorie-ring-progress');
      if (ring) ring.style.strokeDashoffset = offset;
      // Count up animation
      this.animateCount('result-calories', 0, calories, 1200);
    }, 100);

    // PFC
    const { protein = 0, fat = 0, carbs = 0 } = result.pfc || {};
    const pfcTotal = protein * 4 + fat * 9 + carbs * 4;
    const proteinPct = pfcTotal > 0 ? (protein * 4 / pfcTotal * 100) : 33;
    const fatPct = pfcTotal > 0 ? (fat * 9 / pfcTotal * 100) : 33;
    const carbsPct = pfcTotal > 0 ? (carbs * 4 / pfcTotal * 100) : 34;

    document.getElementById('result-protein').textContent = `${protein}g`;
    document.getElementById('result-fat').textContent = `${fat}g`;
    document.getElementById('result-carbs').textContent = `${carbs}g`;

    setTimeout(() => {
      document.getElementById('pfc-protein-bar').style.width = `${proteinPct}%`;
      document.getElementById('pfc-fat-bar').style.width = `${fatPct}%`;
      document.getElementById('pfc-carbs-bar').style.width = `${carbsPct}%`;
    }, 200);

    // Nutrients
    const n = result.nutrients || {};
    const nutrientMap = [
      { id: 'n-fiber', value: n.fiber, unit: 'g', icon: '🌿', name: '食物繊維' },
      { id: 'n-sodium', value: n.sodium, unit: 'mg', icon: '🧂', name: 'ナトリウム' },
      { id: 'n-calcium', value: n.calcium, unit: 'mg', icon: '🦴', name: 'カルシウム' },
      { id: 'n-iron', value: n.iron, unit: 'mg', icon: '⚡', name: '鉄分' },
      { id: 'n-vitC', value: n.vitaminC, unit: 'mg', icon: '🍋', name: 'ビタミンC' },
      { id: 'n-vitA', value: n.vitaminA, unit: 'μg', icon: '👁️', name: 'ビタミンA' },
    ];

    const grid = document.getElementById('nutrients-grid');
    grid.innerHTML = '';
    nutrientMap.forEach(({ icon, name, value, unit }) => {
      if (value !== undefined && value !== null) {
        const chip = document.createElement('div');
        chip.className = 'nutrient-chip slide-in';
        chip.innerHTML = `
          <span class="nutrient-chip-icon">${icon}</span>
          <div class="nutrient-chip-name">${name}</div>
          <div class="nutrient-chip-value">${value}<span class="nutrient-chip-unit"> ${unit}</span></div>
        `;
        grid.appendChild(chip);
      }
    });

    // AI comment
    if (result.aiComment) {
      document.getElementById('ai-comment-text').textContent = result.aiComment;
    }

    // Per-item breakdown
    this.renderItems(result.items || []);
  },

  // ===== Per-dish Items Rendering =====
  renderItems(items) {
    const section = document.getElementById('items-section');
    const list = document.getElementById('items-list');
    const btn = document.getElementById('btn-toggle-items');
    if (!section || !list) return;

    if (!items || items.length === 0) {
      section.style.display = 'none';
      return;
    }

    // Store items on the list element for lazy rendering
    list._items = items;
    list._rendered = false;
    // Reset toggle state
    list.style.display = 'none';
    if (btn) {
      btn.classList.remove('open');
      btn.querySelector('.items-toggle-label').textContent = `おかず別内訳を見る（${items.length}品）`;
      btn.querySelector('.items-toggle-arrow').textContent = '▼';
    }
    section.style.display = 'block';
  },

  toggleItems() {
    const list = document.getElementById('items-list');
    const btn = document.getElementById('btn-toggle-items');
    if (!list) return;
    const isOpen = list.style.display !== 'none';
    if (isOpen) {
      list.style.display = 'none';
      btn.classList.remove('open');
      btn.querySelector('.items-toggle-arrow').textContent = '▼';
      const label = list._items ? `おかず別内訳を見る（${list._items.length}品）` : 'おかず別内訳を見る';
      btn.querySelector('.items-toggle-label').textContent = label;
    } else {
      // Render lazily on first open
      if (!list._rendered && list._items) {
        this._renderItemsInto(list._items, list, 'item-bar');
        list._rendered = true;
      }
      list.style.display = 'block';
      btn.classList.add('open');
      btn.querySelector('.items-toggle-arrow').textContent = '▲';
      btn.querySelector('.items-toggle-label').textContent = 'おかず別内訳を閉じる';
    }
  },

  toggleDetailItems() {
    const list = document.getElementById('detail-items-list');
    const btn = document.getElementById('detail-toggle-items-btn');
    if (!list) return;
    const isOpen = list.style.display !== 'none';
    if (isOpen) {
      list.style.display = 'none';
      btn.classList.remove('open');
      btn.querySelector('.items-toggle-arrow').textContent = '▼';
      const label = list._items ? `おかず別内訳を見る（${list._items.length}品）` : 'おかず別内訳を見る';
      btn.querySelector('.items-toggle-label').textContent = label;
    } else {
      if (!list._rendered && list._items) {
        this._renderItemsInto(list._items, list, 'detail-item-bar');
        list._rendered = true;
      }
      list.style.display = 'block';
      btn.classList.add('open');
      btn.querySelector('.items-toggle-arrow').textContent = '▲';
      btn.querySelector('.items-toggle-label').textContent = 'おかず別内訳を閉じる';
    }
  },

  // Shared item card renderer
  _renderItemsInto(items, listEl, barPrefix) {
    listEl.innerHTML = '';
    const totalCal = items.reduce((s, it) => s + (it.calories || 0), 0) || 1;

    items.forEach((item, idx) => {
      const cal = item.calories || 0;
      const ratio = Math.min(cal / totalCal, 1);
      const { protein = 0, fat = 0, carbs = 0 } = item.pfc || {};
      const pfcTotal = protein * 4 + fat * 9 + carbs * 4;
      const pPct = pfcTotal > 0 ? Math.round(protein * 4 / pfcTotal * 100) : 33;
      const fPct = pfcTotal > 0 ? Math.round(fat * 9 / pfcTotal * 100) : 33;
      const cPct = pfcTotal > 0 ? Math.round(carbs * 4 / pfcTotal * 100) : 34;
      const barId = `${barPrefix}-${idx}`;

      const card = document.createElement('div');
      card.className = 'item-card glass-card slide-in';
      card.style.animationDelay = `${idx * 0.07}s`;
      card.innerHTML = `
        <div class="item-card-header">
          <div class="item-emoji">${item.emoji || '🍽️'}</div>
          <div class="item-info">
            <div class="item-name">${item.name}</div>
            <div class="item-weight">${item.weight || ''}</div>
          </div>
          <div class="item-calorie-badge">${cal}<span>kcal</span></div>
        </div>
        <div class="item-calorie-bar-wrapper">
          <div class="item-calorie-bar-bg"><div class="item-calorie-bar-fill" id="${barId}" style="width:0%"></div></div>
          <div class="item-calorie-ratio">${Math.round(ratio * 100)}%</div>
        </div>
        <div class="item-pfc">
          <div class="item-pfc-bar">
            <div class="pfc-segment protein" style="width:${pPct}%"></div>
            <div class="pfc-segment fat"     style="width:${fPct}%"></div>
            <div class="pfc-segment carbs"   style="width:${cPct}%"></div>
          </div>
          <div class="item-pfc-labels">
            <span class="item-pfc-label protein-text">P: ${protein}g</span>
            <span class="item-pfc-label fat-text">F: ${fat}g</span>
            <span class="item-pfc-label carbs-text">C: ${carbs}g</span>
          </div>
        </div>
        ${item.mainNutrients ? `<div class="item-nutrient-note">💡 ${item.mainNutrients}</div>` : ''}
      `;
      listEl.appendChild(card);
      setTimeout(() => {
        const bar = document.getElementById(barId);
        if (bar) bar.style.width = `${ratio * 100}%`;
      }, 150 + idx * 70);
    });
  },


  animateCount(elementId, from, to, duration) {

    const el = document.getElementById(elementId);
    if (!el) return;
    const start = performance.now();
    const update = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(from + (to - from) * eased);
      if (progress < 1) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  },

  // ===== Save Meal =====
  async saveMeal(isAuto = false) {
    if (!this.state.currentResult) return;
    const meal = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      imageDataUrl: this.state.imageDataUrl,
      ...this.state.currentResult,
    };
    this.state.latestSavedMealId = meal.id;
    this.state.mealHistory.unshift(meal);
    
    // 30日を超過した古い記録の自動ローテーション（古いデータを1件ずつ削除）
    this.cleanupExpiredMeals(30);

    await this.saveToStorage();
    
    if (isAuto) {
      this.showToast(`「${meal.foodName}」を自動で記録しました`, 'success');
    } else {
      this.showToast(`「${meal.foodName}」を記録しました！`, 'success');
    }

    this.renderHistory();
    this.renderDashboard();
    // Switch to history tab
    if (!isAuto) {
      setTimeout(() => this.switchTab('history'), 800);
    }
  },

  // ===== Dashboard Date Helpers =====
  getTodayDateStr() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  getDashboardDateStr() {
    return this.state.selectedDashboardDate || this.getTodayDateStr();
  },

  changeDashboardDate(offsetDays) {
    const curStr = this.getDashboardDateStr();
    const [y, m, d] = curStr.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    dateObj.setDate(dateObj.getDate() + offsetDays);
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    this.state.selectedDashboardDate = `${year}-${month}-${day}`;
    this.renderDashboard();
  },

  setDashboardDateToday() {
    this.state.selectedDashboardDate = this.getTodayDateStr();
    this.renderDashboard();
  },

  // ===== Dashboard =====
  renderDashboard() {
    const dateStr = this.getDashboardDateStr();
    const todayStr = this.getTodayDateStr();
    const isToday = dateStr === todayStr;

    // 1. Date Navigation Display
    const [y, m, d] = dateStr.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const displayDate = dateObj.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short'
    });

    const dateDisplayEl = document.getElementById('dash-date-display');
    if (dateDisplayEl) dateDisplayEl.textContent = displayDate;

    const dateBadgeEl = document.getElementById('dash-date-badge');
    const todayBtnEl = document.getElementById('btn-dash-today');

    if (isToday) {
      if (dateBadgeEl) {
        dateBadgeEl.textContent = '今日';
        dateBadgeEl.className = 'badge badge-success';
      }
      if (todayBtnEl) todayBtnEl.style.display = 'none';
    } else {
      const todayDate = new Date();
      const diffTime = dateObj.getTime() - new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate()).getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
      let badgeText = '';
      if (diffDays === -1) badgeText = '昨日';
      else if (diffDays === 1) badgeText = '明日';
      else if (diffDays < 0) badgeText = `${Math.abs(diffDays)}日前`;
      else badgeText = `${diffDays}日後`;

      if (dateBadgeEl) {
        dateBadgeEl.textContent = badgeText;
        dateBadgeEl.className = 'badge badge-info';
      }
      if (todayBtnEl) todayBtnEl.style.display = 'inline-flex';
    }

    // 2. Filter meals for selected date (sort by time ascending)
    const dayMeals = this.state.mealHistory.filter(meal => {
      const mDate = new Date(meal.timestamp);
      const mStr = mDate.getFullYear() + '-' + String(mDate.getMonth() + 1).padStart(2, '0') + '-' + String(mDate.getDate()).padStart(2, '0');
      return mStr === dateStr;
    });
    dayMeals.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // 3. Quick Stats & Daily Summary Data for selected date
    // 食事記録が1件以上ある場合のみサマリーを有効とする
    const summary = (dayMeals.length > 0) ? this.state.dailySummaries[dateStr] : null;

    const mealsCountEl = document.getElementById('dash-meals');
    if (mealsCountEl) mealsCountEl.textContent = dayMeals.length;

    const weightEl = document.getElementById('dash-weight');
    if (weightEl) {
      if (dayMeals.length > 0) {
        const w = summary?.weight ?? this.state.userBody?.currentWeight;
        weightEl.textContent = (w !== undefined && w !== null) ? `${w}` : '--';
      } else {
        weightEl.textContent = '--';
      }
    }

    const bpEl = document.getElementById('dash-bp');
    if (bpEl) {
      if (dayMeals.length > 0) {
        if (summary?.bpSys && summary?.bpDia) {
          bpEl.textContent = `${summary.bpSys}/${summary.bpDia}`;
        } else if (this.state.userBody?.bloodPressureSystolic && this.state.userBody?.bloodPressureDiastolic) {
          bpEl.textContent = `${this.state.userBody.bloodPressureSystolic}/${this.state.userBody.bloodPressureDiastolic}`;
        } else {
          bpEl.textContent = '--';
        }
      } else {
        bpEl.textContent = '--';
      }
    }

    const totalEl = document.getElementById('dash-total');
    if (totalEl) totalEl.textContent = this.state.mealHistory.length;

    // 4. Render Daily Summary AI Advice & Measurements Card (#dash-daily-summary-section)
    const summarySecEl = document.getElementById('dash-daily-summary-section');
    if (summarySecEl) {
      if (dayMeals.length > 0 && summary) {
        const w = summary.weight ?? this.state.userBody?.currentWeight ?? '--';
        const sys = summary.bpSys ?? this.state.userBody?.bloodPressureSystolic;
        const dia = summary.bpDia ?? this.state.userBody?.bloodPressureDiastolic;
        
        let bpStatus = '';
        if (sys && dia) {
          if (sys >= 140 || dia >= 90) bpStatus = ' (高め)';
          else if (sys < 120 && dia < 80) bpStatus = ' (正常)';
        }
        const bpText = (sys && dia) ? `💓 ${sys}/${dia} mmHg${bpStatus}` : '';

        summarySecEl.innerHTML = `
          <div class="glass-card" style="padding:16px 18px; background:rgba(61,255,160,0.03); border:1px solid rgba(61,255,160,0.22); border-radius:var(--radius-md);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
              <div style="font-size:13px; font-weight:700; color:var(--text-primary); display:flex; align-items:center; gap:6px;">
                <span>🤖</span> AI 1日の総括アドバイス
              </div>
              <div style="display:flex; gap:6px; align-items:center;">
                <button class="btn btn-ghost" id="btn-speak-dash-summary" style="padding:3px 8px; font-size:11px; border-radius:10px; display:inline-flex; align-items:center; gap:4px;" title="総括アドバイスを読み上げる" onclick="App.speak(document.getElementById('dash-daily-ai-comment').textContent)">
                  🔊 読上げ
                </button>
                <button class="btn btn-ghost" onclick="App.openDailySummaryModal('${dateStr}')" style="padding:3px 10px; font-size:11px; border-radius:12px;">
                  ✏️ 測定値を変更・再分析 ➔
                </button>
              </div>
            </div>

            <!-- Measurement Badges -->
            <div style="display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap; align-items:center;">
              <span class="badge badge-success" style="font-size:11px; padding:3px 8px;">⚖️ ${w}kg</span>
              ${bpText ? `<span class="badge badge-info" style="font-size:11px; padding:3px 8px;">${bpText}</span>` : ''}
              <span class="badge" style="font-size:11px; padding:3px 8px; background:rgba(255,255,255,0.06); color:var(--text-light);">
                🔥 合計 ${summary.totalCalories || totalCal} kcal
              </span>
            </div>

            <!-- AI Comment -->
            <div id="dash-daily-ai-comment" style="font-size:13px; color:var(--text-primary); line-height:1.65; white-space:pre-wrap; background:rgba(0,0,0,0.18); padding:12px 14px; border-radius:var(--radius-sm); border:1px solid rgba(255,255,255,0.04);">
              ${summary.aiComment || '本日の総括アドバイスはありません。'}
            </div>
          </div>
        `;
      } else if (dayMeals.length > 0) {
        summarySecEl.innerHTML = `
          <div class="glass-card" style="padding:14px 16px; background:rgba(255,255,255,0.02); border:1px solid var(--glass-border); border-radius:var(--radius-md); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <div style="font-size:13px; font-weight:700; color:var(--text-primary); margin-bottom:2px;">
                📊 1日のAI総括が未実行です
              </div>
              <div style="font-size:11px; color:var(--text-muted);">
                体重・血圧を入力して、医師・栄養士AIから総合アドバイスを受け取れます
              </div>
            </div>
            <button class="btn btn-primary" onclick="App.openDailySummaryModal('${dateStr}')" style="padding:8px 14px; font-size:12px; font-weight:700;">
              🤖 AI総括を実行
            </button>
          </div>
        `;
      } else {
        summarySecEl.innerHTML = '';
      }
    }

    // 5. Calculate Totals
    const totalCal = dayMeals.reduce((s, m) => s + (m.calories || 0), 0);
    const totalProtein = dayMeals.reduce((s, m) => s + (m.pfc?.protein || 0), 0);
    const totalFat = dayMeals.reduce((s, m) => s + (m.pfc?.fat || 0), 0);
    const totalCarbs = dayMeals.reduce((s, m) => s + (m.pfc?.carbs || 0), 0);

    const goalCal = this.state.goals?.calories || 1800;

    // Calorie Display
    const calEl = document.getElementById('dash-calories');
    if (calEl) calEl.textContent = totalCal.toLocaleString();

    const targetTextEl = document.getElementById('dash-cal-target-text');
    if (targetTextEl) targetTextEl.textContent = `目標 ${goalCal.toLocaleString()} kcal`;

    const calProgress = Math.min((totalCal / goalCal) * 100, 100);
    const progressFillEl = document.getElementById('calorie-progress-fill');
    if (progressFillEl) progressFillEl.style.width = `${calProgress}%`;

    const progressLabelEl = document.getElementById('calorie-progress-label');
    if (progressLabelEl) {
      const pct = Math.round((totalCal / goalCal) * 100);
      progressLabelEl.textContent = `目標 ${goalCal.toLocaleString()} kcal の ${pct}%`;
    }

    const diffBadgeEl = document.getElementById('dash-cal-diff-badge');
    if (diffBadgeEl) {
      const calDiff = totalCal - goalCal;
      if (dayMeals.length === 0) {
        diffBadgeEl.textContent = '未記録';
        diffBadgeEl.className = 'badge';
        diffBadgeEl.style.background = 'rgba(255,255,255,0.08)';
        diffBadgeEl.style.color = 'var(--text-muted)';
      } else if (calDiff > 200) {
        diffBadgeEl.textContent = `+${calDiff.toLocaleString()} kcal 多め`;
        diffBadgeEl.className = 'badge badge-warning';
        diffBadgeEl.style.background = '';
        diffBadgeEl.style.color = '';
      } else if (calDiff < -200) {
        diffBadgeEl.textContent = `${calDiff.toLocaleString()} kcal 少なめ`;
        diffBadgeEl.className = 'badge badge-warning';
        diffBadgeEl.style.background = '';
        diffBadgeEl.style.color = '';
      } else {
        diffBadgeEl.textContent = '目標達成ペース！';
        diffBadgeEl.className = 'badge badge-success';
        diffBadgeEl.style.background = '';
        diffBadgeEl.style.color = '';
      }
    }

    // 5. Render per-meal calorie list
    const mealCalListEl = document.getElementById('dash-meals-calorie-list');
    if (mealCalListEl) {
      if (dayMeals.length === 0) {
        mealCalListEl.innerHTML = `
          <div style="font-size:12px; color:var(--text-muted); text-align:center; padding:12px 0;">
            🍽️ この日の食事記録はありません
          </div>
        `;
      } else {
        let calHtml = '<div style="display:flex; flex-direction:column; gap:8px;">';
        dayMeals.forEach(meal => {
          const mDate = new Date(meal.timestamp);
          const timeStr = mDate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
          const mCal = meal.calories || 0;
          const pct = totalCal > 0 ? Math.round((mCal / totalCal) * 100) : 0;
          
          calHtml += `
            <div class="glass-card" onclick="App.openMealDetail(${meal.id})" style="padding:10px 12px; cursor:pointer; background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:var(--radius-sm); transition:var(--transition-fast);">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <div style="display:flex; align-items:center; gap:8px; overflow:hidden; min-width:0;">
                  <span class="badge" style="font-size:11px; padding:2px 6px; background:rgba(61,255,160,0.12); color:var(--primary); flex-shrink:0;">${timeStr}</span>
                  <span style="font-weight:600; font-size:13px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${meal.foodName}</span>
                </div>
                <div style="text-align:right; flex-shrink:0; margin-left:8px;">
                  <span style="font-weight:700; font-size:14px; color:var(--primary); font-family:'Outfit',sans-serif;">${mCal}</span>
                  <span style="font-size:11px; color:var(--text-muted);"> kcal</span>
                  <span style="font-size:10px; color:var(--text-muted); margin-left:4px;">(${pct}%)</span>
                </div>
              </div>
              <div style="height:4px; background:rgba(255,255,255,0.06); border-radius:2px; overflow:hidden;">
                <div style="height:100%; width:${pct}%; background:var(--gradient-main); border-radius:2px;"></div>
              </div>
            </div>
          `;
        });
        calHtml += '</div>';
        mealCalListEl.innerHTML = calHtml;
      }
    }

    // 6. PFC Totals & Bar
    const pfcTotal = totalProtein * 4 + totalFat * 9 + totalCarbs * 4;
    const pPct = pfcTotal > 0 ? (totalProtein * 4 / pfcTotal * 100) : 33;
    const fPct = pfcTotal > 0 ? (totalFat * 9 / pfcTotal * 100) : 33;
    const cPct = pfcTotal > 0 ? (totalCarbs * 4 / pfcTotal * 100) : 34;

    const pEl = document.getElementById('dash-protein');
    const fEl = document.getElementById('dash-fat');
    const cEl = document.getElementById('dash-carbs');
    if (pEl) pEl.textContent = `${Math.round(totalProtein * 10) / 10}g`;
    if (fEl) fEl.textContent = `${Math.round(totalFat * 10) / 10}g`;
    if (cEl) cEl.textContent = `${Math.round(totalCarbs * 10) / 10}g`;

    setTimeout(() => {
      const pBar = document.getElementById('dash-pfc-protein');
      const fBar = document.getElementById('dash-pfc-fat');
      const cBar = document.getElementById('dash-pfc-carbs');
      if (pBar) pBar.style.width = `${pPct}%`;
      if (fBar) fBar.style.width = `${fPct}%`;
      if (cBar) cBar.style.width = `${cPct}%`;
    }, 150);

    // 7. Render per-meal PFC balance list
    const mealPfcListEl = document.getElementById('dash-meals-pfc-list');
    if (mealPfcListEl) {
      if (dayMeals.length === 0) {
        mealPfcListEl.innerHTML = `
          <div style="font-size:12px; color:var(--text-muted); text-align:center; padding:12px 0;">
            🍽️ この日の食事記録はありません
          </div>
        `;
      } else {
        let pfcHtml = '<div style="display:flex; flex-direction:column; gap:8px;">';
        dayMeals.forEach(meal => {
          const mDate = new Date(meal.timestamp);
          const timeStr = mDate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
          const { protein = 0, fat = 0, carbs = 0 } = meal.pfc || {};
          const mPfcTotal = protein * 4 + fat * 9 + carbs * 4;
          const mpPct = mPfcTotal > 0 ? Math.round(protein * 4 / mPfcTotal * 100) : 33;
          const mfPct = mPfcTotal > 0 ? Math.round(fat * 9 / mPfcTotal * 100) : 33;
          const mcPct = mPfcTotal > 0 ? Math.round(carbs * 4 / mPfcTotal * 100) : 34;

          pfcHtml += `
            <div class="glass-card" onclick="App.openMealDetail(${meal.id})" style="padding:10px 12px; cursor:pointer; background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:var(--radius-sm);">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <div style="display:flex; align-items:center; gap:8px; overflow:hidden; min-width:0;">
                  <span class="badge" style="font-size:11px; padding:2px 6px; background:rgba(56,189,248,0.12); color:var(--pfc-protein); flex-shrink:0;">${timeStr}</span>
                  <span style="font-weight:600; font-size:13px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${meal.foodName}</span>
                </div>
              </div>
              <!-- Mini PFC Bar -->
              <div class="pfc-bar-container" style="height:5px; margin-bottom:6px;">
                <div class="pfc-segment protein" style="width:${mpPct}%"></div>
                <div class="pfc-segment fat"     style="width:${mfPct}%"></div>
                <div class="pfc-segment carbs"   style="width:${mcPct}%"></div>
              </div>
              <!-- Mini PFC Values -->
              <div style="display:flex; justify-content:space-between; font-size:11px;">
                <span class="item-pfc-label protein-text">P: ${protein}g <span style="font-size:10px; color:var(--text-muted);">(${mpPct}%)</span></span>
                <span class="item-pfc-label fat-text">F: ${fat}g <span style="font-size:10px; color:var(--text-muted);">(${mfPct}%)</span></span>
                <span class="item-pfc-label carbs-text">C: ${carbs}g <span style="font-size:10px; color:var(--text-muted);">(${mcPct}%)</span></span>
              </div>
            </div>
          `;
        });
        pfcHtml += '</div>';
        mealPfcListEl.innerHTML = pfcHtml;
      }
    }

    // 8. Weekly Chart (週間カロリー推移)
    this.renderWeeklyChart();
  },

  renderWeeklyChart() {
    const canvas = document.getElementById('weekly-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;

    // Get past 7 days data
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toDateString();
      const meals = this.state.mealHistory.filter(m =>
        new Date(m.timestamp).toDateString() === dateStr
      );
      const cal = meals.reduce((s, m) => s + (m.calories || 0), 0);
      days.push({
        label: ['日', '月', '火', '水', '木', '金', '土'][d.getDay()],
        cal,
        isToday: i === 0
      });
    }

    const maxCal = Math.max(...days.map(d => d.cal), this.state.goals.calories, 500);
    const padding = { top: 20, right: 10, bottom: 30, left: 10 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;
    const barW = (chartW / days.length) * 0.6;
    const barGap = chartW / days.length;

    ctx.clearRect(0, 0, w, h);

    // Goal line
    const goalY = padding.top + chartH * (1 - this.state.goals.calories / maxCal);
    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(61, 255, 160, 0.25)';
    ctx.lineWidth = 1;
    ctx.moveTo(padding.left, goalY);
    ctx.lineTo(w - padding.right, goalY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Grid lines
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
    }

    // Bars
    days.forEach((day, i) => {
      const x = padding.left + barGap * i + (barGap - barW) / 2;
      const barH = day.cal > 0 ? (day.cal / maxCal) * chartH : 0;
      const y = padding.top + chartH - barH;

      // Gradient
      const grad = ctx.createLinearGradient(0, y, 0, y + barH);
      if (day.isToday) {
        grad.addColorStop(0, 'rgba(61, 255, 160, 0.9)');
        grad.addColorStop(1, 'rgba(0, 229, 255, 0.6)');
      } else {
        grad.addColorStop(0, 'rgba(61, 255, 160, 0.4)');
        grad.addColorStop(1, 'rgba(61, 255, 160, 0.1)');
      }

      ctx.fillStyle = grad;
      const radius = Math.min(6, barW / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + barW - radius, y);
      ctx.quadraticCurveTo(x + barW, y, x + barW, y + radius);
      ctx.lineTo(x + barW, y + barH);
      ctx.lineTo(x, y + barH);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      ctx.fill();

      // Calorie label on bar
      if (day.cal > 0) {
        ctx.fillStyle = day.isToday ? 'rgba(61, 255, 160, 0.9)' : 'rgba(138, 171, 150, 0.7)';
        ctx.font = `bold 9px Outfit, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(day.cal, x + barW / 2, y - 5);
      }

      // Day label
      ctx.fillStyle = day.isToday ? '#3dffa0' : 'rgba(138, 171, 150, 0.6)';
      ctx.font = `${day.isToday ? 'bold' : 'normal'} 11px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(day.label, x + barW / 2, h - padding.bottom + 16);
    });
  },

  // ===== History =====
  renderHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;

    if (this.state.mealHistory.length === 0) {
      list.innerHTML = `
        <div class="history-empty glass-card">
          <span class="history-empty-icon">🍽️</span>
          まだ食事記録がありません。<br>最初の食事を撮影してみましょう！
        </div>`;
      return;
    }

    // グループ化
    const groups = {};
    this.state.mealHistory.forEach(meal => {
      const dateObj = new Date(meal.timestamp);
      const d = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + String(dateObj.getDate()).padStart(2, '0');
      if (!groups[d]) groups[d] = [];
      groups[d].push(meal);
    });

    let html = '';
    const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    sortedDates.forEach(dateStr => {
      const dateObj = new Date(dateStr);
      const displayDate = dateObj.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' });
      
      html += `
        <div class="history-date-header" style="display:flex; justify-content:space-between; align-items:center; margin: 24px 0 12px 0; border-bottom: 1px solid var(--glass-border); padding-bottom: 8px;">
          <h3 style="margin:0; font-size:16px; color:var(--text-light);">${displayDate}</h3>
          <button class="btn btn-ghost" style="padding: 4px 12px; font-size:12px; border-radius:12px; background: rgba(0, 229, 255, 0.1); color: var(--primary);" onclick="App.openDailySummaryModal('${dateStr}')">📊 1日の総括</button>
        </div>
      `;

      html += groups[dateStr].map(meal => {
        const mealDate = new Date(meal.timestamp);
        const timeStr = mealDate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        const thumbHtml = meal.imageDataUrl
          ? `<img src="${meal.imageDataUrl}" class="history-thumb" alt="${meal.foodName}">`
          : `<div class="history-thumb-placeholder">🍽️</div>`;

        return `
          <div class="history-item glass-card" data-id="${meal.id}" onclick="App.openMealDetail(${meal.id})" style="cursor:pointer">
            ${thumbHtml}
            <div class="history-info">
              <div class="history-name">${meal.foodName}</div>
              <div class="history-time">${timeStr}</div>
            </div>
            <div class="history-calorie">${meal.calories}<span> kcal</span></div>
            <button class="btn btn-ghost btn-icon" onclick="event.stopPropagation();App.deleteMeal(${meal.id})" title="削除" style="margin-left:8px">🗑️</button>
          </div>`;
      }).join('');
    });

    list.innerHTML = html;
  },

  async deleteMeal(id) {
    if (!confirm('この食事記録を削除しますか？')) return;
    this.state.mealHistory = this.state.mealHistory.filter(m => m.id !== id);
    this.cleanOrphanDailySummaries();
    await this.saveToStorage();
    this.renderHistory();
    this.renderDashboard();
    this.showToast('食事記録を削除しました', 'info');
  },

  // ===== Date Edit Helper =====
  toDateTimeLocalString(timestamp) {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  },

  toggleEditDate(show) {
    const container = document.getElementById('edit-date-container');
    const btn = document.getElementById('btn-edit-date');
    if (!container) return;
    const isCurrentlyVisible = container.style.display === 'flex' || container.style.display === 'block';
    const nextState = (typeof show === 'boolean') ? show : !isCurrentlyVisible;

    if (nextState) {
      container.style.display = 'flex';
      if (btn) btn.style.display = 'none';
      const input = document.getElementById('edit-date-input');
      if (input) input.focus();
    } else {
      container.style.display = 'none';
      if (btn) btn.style.display = 'inline-flex';
    }
  },

  async saveNewDate() {
    if (!this.state.currentDetailId) return;
    const input = document.getElementById('edit-date-input');
    if (!input || !input.value) {
      this.showToast('日時を選択してください', 'error');
      return;
    }

    const newDate = new Date(input.value);
    if (isNaN(newDate.getTime())) {
      this.showToast('有効な日時を入力してください', 'error');
      return;
    }

    const meal = this.state.mealHistory.find(m => m.id === this.state.currentDetailId);
    if (!meal) {
      this.showToast('対象の食事記録が見つかりません', 'error');
      return;
    }

    meal.timestamp = newDate.toISOString();

    // 履歴を日時の新しい順に再ソート
    this.state.mealHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // 食事がなくなった日の古いサマリーを自動クリーンアップ
    this.cleanOrphanDailySummaries();

    await this.saveToStorage();
    this.renderDetailModal(meal);
    this.renderHistory();
    this.renderDashboard();
    this.toggleEditDate(false);
    this.showToast('食事の日時を更新しました', 'success');
  },

  openEditDateForResult() {
    let targetId = this.state.latestSavedMealId;
    if (!targetId && this.state.mealHistory.length > 0) {
      targetId = this.state.mealHistory[0].id;
    }
    if (!targetId) {
      this.showToast('変更対象の食事記録がありません', 'error');
      return;
    }
    this.openMealDetail(targetId);
    setTimeout(() => this.toggleEditDate(true), 150);
  },

  // ===== Meal Detail Modal =====
  openMealDetail(id) {
    const meal = this.state.mealHistory.find(m => m.id === id);
    if (!meal) return;
    this.state.currentDetailId = id;
    this.renderDetailModal(meal);
    document.getElementById('detail-modal').classList.add('active');
  },

  closeMealDetail() {
    document.getElementById('detail-modal').classList.remove('active');
  },

  renderDetailModal(meal) {
    const date = new Date(meal.timestamp);
    const timeStr = date.toLocaleString('ja-JP', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', weekday: 'short'
    });

    // Reset date edit UI & set input value
    this.toggleEditDate(false);
    const dateInput = document.getElementById('edit-date-input');
    if (dateInput) {
      dateInput.value = this.toDateTimeLocalString(meal.timestamp);
    }

    // Header
    document.getElementById('detail-food-name').textContent = meal.foodName || '不明な料理';
    document.getElementById('detail-food-name-en').textContent = meal.foodNameEn || '';
    document.getElementById('detail-time').textContent = timeStr;
    document.getElementById('detail-calories').textContent = meal.calories || 0;
    const hs = meal.healthScore || 5;
    const hsBadge = document.getElementById('detail-health-badge');
    hsBadge.textContent = `健康スコア ${hs}/10`;
    hsBadge.className = `badge ${hs >= 7 ? 'badge-success' : 'badge-warning'}`;

    // Image
    const imgEl = document.getElementById('detail-image');
    const imgWrap = document.getElementById('detail-image-wrap');
    if (meal.imageDataUrl) {
      imgEl.src = meal.imageDataUrl;
      imgWrap.style.display = 'block';
    } else {
      imgWrap.style.display = 'none';
    }

    // PFC
    const { protein = 0, fat = 0, carbs = 0 } = meal.pfc || {};
    const pfcTotal = protein * 4 + fat * 9 + carbs * 4;
    const pPct = pfcTotal > 0 ? (protein * 4 / pfcTotal * 100) : 33;
    const fPct = pfcTotal > 0 ? (fat * 9 / pfcTotal * 100) : 33;
    const cPct = pfcTotal > 0 ? (carbs * 4 / pfcTotal * 100) : 34;
    document.getElementById('detail-protein').textContent = `${protein}g`;
    document.getElementById('detail-fat').textContent = `${fat}g`;
    document.getElementById('detail-carbs').textContent = `${carbs}g`;
    setTimeout(() => {
      document.getElementById('detail-pfc-protein').style.width = `${pPct}%`;
      document.getElementById('detail-pfc-fat').style.width = `${fPct}%`;
      document.getElementById('detail-pfc-carbs').style.width = `${cPct}%`;
    }, 150);

    // Nutrients
    const n = meal.nutrients || {};
    const nutrientMap = [
      { value: n.fiber, unit: 'g', icon: '🌿', name: '食物繊維' },
      { value: n.sodium, unit: 'mg', icon: '🧂', name: 'ナトリウム' },
      { value: n.calcium, unit: 'mg', icon: '🦴', name: 'カルシウム' },
      { value: n.iron, unit: 'mg', icon: '⚡', name: '鉄分' },
      { value: n.vitaminC, unit: 'mg', icon: '🍋', name: 'ビタミンC' },
      { value: n.vitaminA, unit: 'μg', icon: '👁️', name: 'ビタミンA' },
    ];
    const ngrid = document.getElementById('detail-nutrients-grid');
    ngrid.innerHTML = '';
    nutrientMap.forEach(({ icon, name, value, unit }) => {
      if (value !== undefined && value !== null) {
        const chip = document.createElement('div');
        chip.className = 'nutrient-chip';
        chip.innerHTML = `
          <span class="nutrient-chip-icon">${icon}</span>
          <div class="nutrient-chip-name">${name}</div>
          <div class="nutrient-chip-value">${value}<span class="nutrient-chip-unit"> ${unit}</span></div>
        `;
        ngrid.appendChild(chip);
      }
    });

    // Items (per-dish) - toggle対応
    const itemsSection = document.getElementById('detail-items-section');
    const itemsList = document.getElementById('detail-items-list');
    const detailToggleBtn = document.getElementById('detail-toggle-items-btn');
    if (meal.items && meal.items.length > 0) {
      itemsSection.style.display = 'block';
      itemsList._items = meal.items;
      itemsList._rendered = false;
      itemsList.style.display = 'none';
      if (detailToggleBtn) {
        detailToggleBtn.classList.remove('open');
        detailToggleBtn.querySelector('.items-toggle-label').textContent =
          `おかず別内訳を見る（${meal.items.length}品）`;
        detailToggleBtn.querySelector('.items-toggle-arrow').textContent = '▼';
      }
    } else {
      itemsSection.style.display = 'none';
    }


    // AI Comment
    const aiEl = document.getElementById('detail-ai-comment');
    if (aiEl) aiEl.textContent = meal.aiComment || '';
  },

  // ===== Text-to-Speech (TTS) & Speech Recognition =====
  recognition: null,
  isRecognizingSpeech: false,
  currentSpeakingBtn: null,

  toggleSpeechRecognition() {
    if (this.isRecognizingSpeech) {
      this.stopSpeechRecognition();
    } else {
      this.startSpeechRecognition();
    }
  },

  startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.showToast('お使いのブラウザは音声認識に対応していません', 'error');
      return;
    }

    try {
      if (this.recognition) {
        try { this.recognition.abort(); } catch (e) {}
      }
      const recog = new SpeechRecognition();
      recog.lang = 'ja-JP';
      recog.interimResults = true;
      recog.continuous = false;

      const micBtn = document.getElementById('btn-mic-chat');
      const chatInput = document.getElementById('chat-input');
      let baseText = chatInput ? chatInput.value : '';

      recog.onstart = () => {
        this.isRecognizingSpeech = true;
        if (micBtn) {
          micBtn.classList.add('recording');
          micBtn.title = '音声入力中...クリックで終了';
          micBtn.setAttribute('aria-label', '音声入力中');
        }
        this.showToast('🎙️ 音声入力中...お話しください', 'info');
      };

      recog.onresult = (e) => {
        let interim = '';
        let final = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) {
          if (e.results[i].isFinal) {
            final += e.results[i][0].transcript;
          } else {
            interim += e.results[i][0].transcript;
          }
        }
        if (chatInput) {
          const prefix = baseText ? (baseText.endsWith(' ') || baseText.endsWith('\n') ? baseText : baseText + ' ') : '';
          const currentResult = final || interim;
          chatInput.value = prefix + currentResult;
          chatInput.style.height = 'auto';
          chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
        }
      };

      recog.onerror = (e) => {
        console.warn('音声認識エラー:', e.error);
        if (e.error === 'not-allowed') {
          this.showToast('マイクの使用が許可されていません（ブラウザの設定をご確認ください）', 'error');
        } else if (e.error !== 'no-speech') {
          this.showToast(`音声認識エラー: ${e.error}`, 'error');
        }
        this.stopSpeechRecognition();
      };

      recog.onend = () => {
        this.stopSpeechRecognition();
      };

      this.recognition = recog;
      recog.start();
    } catch (err) {
      console.error('Speech recognition failed to start:', err);
      this.showToast('音声認識の開始に失敗しました', 'error');
      this.stopSpeechRecognition();
    }
  },

  stopSpeechRecognition() {
    this.isRecognizingSpeech = false;
    const micBtn = document.getElementById('btn-mic-chat');
    if (micBtn) {
      micBtn.classList.remove('recording');
      micBtn.title = '音声で入力';
      micBtn.setAttribute('aria-label', '音声入力開始');
    }
    if (this.recognition) {
      try { this.recognition.stop(); } catch (e) {}
      this.recognition = null;
    }
  },

  speak(text, btnElement = null) {
    if (!text) return;
    if (!('speechSynthesis' in window)) {
      this.showToast('お使いのブラウザは音声読み上げに対応していません', 'error');
      return;
    }

    // 既に再生中の場合は停止処理
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      if (this.currentSpeakingBtn) {
        this.currentSpeakingBtn.classList.remove('speaking');
        const label = this.currentSpeakingBtn.querySelector('.chat-speak-label');
        if (label) label.textContent = '読み上げ';
        const icon = this.currentSpeakingBtn.querySelector('.chat-speak-icon');
        if (icon) icon.textContent = '🔊';
        if (this.currentSpeakingBtn.tagName === 'BUTTON' && !label && !icon) {
          this.currentSpeakingBtn.textContent = '🔊';
        }
      }
      // 同じボタンを押して停止した場合はそのまま終了
      if (this.currentSpeakingBtn === btnElement) {
        this.currentSpeakingBtn = null;
        return;
      }
    }

    // 読み上げテキストからMarkdown記号や絵文字等を取り除いて聞きやすく整形
    const cleanText = text
      .replace(/[*#_`~>]/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/^[・\-\*]\s+/gm, '')
      .trim();

    if (!cleanText) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'ja-JP';
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    if (btnElement) {
      this.currentSpeakingBtn = btnElement;
      btnElement.classList.add('speaking');
      const label = btnElement.querySelector('.chat-speak-label');
      if (label) label.textContent = '停止';
      const icon = btnElement.querySelector('.chat-speak-icon');
      if (icon) icon.textContent = '⏹️';
      if (btnElement.tagName === 'BUTTON' && !label && !icon) {
        btnElement.textContent = '⏹️';
      }
    }

    utterance.onend = () => {
      if (btnElement) {
        btnElement.classList.remove('speaking');
        const label = btnElement.querySelector('.chat-speak-label');
        if (label) label.textContent = '読み上げ';
        const icon = btnElement.querySelector('.chat-speak-icon');
        if (icon) icon.textContent = '🔊';
        if (btnElement.tagName === 'BUTTON' && !label && !icon) {
          btnElement.textContent = '🔊';
        }
      }
      this.currentSpeakingBtn = null;
    };

    utterance.onerror = (e) => {
      console.warn('TTSエラー:', e);
      if (btnElement) {
        btnElement.classList.remove('speaking');
        const label = btnElement.querySelector('.chat-speak-label');
        if (label) label.textContent = '読み上げ';
        const icon = btnElement.querySelector('.chat-speak-icon');
        if (icon) icon.textContent = '🔊';
        if (btnElement.tagName === 'BUTTON' && !label && !icon) {
          btnElement.textContent = '🔊';
        }
      }
      this.currentSpeakingBtn = null;
    };

    window.speechSynthesis.speak(utterance);
  },

  async clearHistory() {
    if (!confirm('全ての食事記録を削除しますか？')) return;
    this.state.mealHistory = [];
    this.state.dailySummaries = {};
    await this.saveToStorage();
    this.renderHistory();
    this.renderDashboard();
    this.showToast('食事記録をリセットしました', 'info');
  },

  // ===== Age Helper =====
  getAge(birthDateStr) {
    if (!birthDateStr) return null;
    const birth = new Date(birthDateStr);
    if (isNaN(birth.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age >= 0 ? age : null;
  },

  onBirthdateChange() {
    const val = document.getElementById('user-birthdate')?.value;
    const age = this.getAge(val);
    const preview = document.getElementById('user-age-preview');
    if (preview) {
      preview.textContent = age !== null ? `(${age}歳)` : '';
    }
    this.calculateGoalsFromWeight();
  },

  // ===== Daily Summary =====
  async openDailySummaryModal(dateStr) {
    this.state.currentSummaryDate = dateStr;
    const modal = document.getElementById('daily-summary-modal');
    modal.classList.add('active');
    const dateObj = new Date(dateStr);
    const displayDate = dateObj.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' });
    document.getElementById('daily-summary-date').textContent = `${displayDate} の総括`;

    const summary = this.state.dailySummaries[dateStr];
    if (summary) {
      this.renderDailySummaryResult(summary);
    } else {
      this.showDailySummaryConfirm();
    }
  },

  closeDailySummaryModal() {
    document.getElementById('daily-summary-modal').classList.remove('active');
  },

  showDailySummaryConfirm() {
    document.getElementById('daily-summary-confirm').style.display = 'block';
    document.getElementById('daily-summary-loading').style.display = 'none';
    document.getElementById('daily-summary-result').style.display = 'none';

    const ub = this.state.userBody || {};
    const age = this.getAge(ub.birthDate);
    const genderStr = ub.gender === 'female' ? '女性' : ub.gender === 'male' ? '男性' : 'その他';
    const curW = ub.currentWeight || 65;
    const tarW = ub.targetWeight || 60;
    const bpSys = ub.bloodPressureSystolic || 120;
    const bpDia = ub.bloodPressureDiastolic || 80;

    const profileBadge = document.getElementById('daily-confirm-profile-badge');
    if (profileBadge) {
      const ageText = age !== null ? `${age}歳` : '年齢未設定';
      profileBadge.textContent = `👤 ${ageText} / ${genderStr}`;
    }

    const goalBadge = document.getElementById('daily-confirm-goal-badge');
    if (goalBadge) {
      goalBadge.textContent = `🎯 目標 ${tarW}kg (${tarW < curW ? '減量' : tarW > curW ? '増量' : '維持'})`;
    }

    const weightInput = document.getElementById('daily-input-weight');
    const bpSysInput = document.getElementById('daily-input-bp-sys');
    const bpDiaInput = document.getElementById('daily-input-bp-dia');

    if (weightInput) weightInput.value = curW;
    if (bpSysInput) bpSysInput.value = bpSys;
    if (bpDiaInput) bpDiaInput.value = bpDia;
  },

  async confirmAndAnalyzeDaily() {
    const weightInput = document.getElementById('daily-input-weight');
    const bpSysInput = document.getElementById('daily-input-bp-sys');
    const bpDiaInput = document.getElementById('daily-input-bp-dia');

    const weight = parseFloat(weightInput?.value) || this.state.userBody.currentWeight || 65;
    const bpSys = parseInt(bpSysInput?.value) || this.state.userBody.bloodPressureSystolic || 120;
    const bpDia = parseInt(bpDiaInput?.value) || this.state.userBody.bloodPressureDiastolic || 80;

    // 現在の設定値として自動更新
    this.state.userBody.currentWeight = weight;
    this.state.userBody.bloodPressureSystolic = bpSys;
    this.state.userBody.bloodPressureDiastolic = bpDia;
    await this.saveToStorage();
    this.renderGoals();
    this.renderDashboard();

    const dateStr = this.state.currentSummaryDate;
    await this.analyzeDaily(dateStr, true, { weight, bpSys, bpDia });
  },

  renderDailySummaryResult(summary) {
    document.getElementById('daily-summary-confirm').style.display = 'none';
    document.getElementById('daily-summary-loading').style.display = 'none';
    document.getElementById('daily-summary-result').style.display = 'block';

    const w = summary.weight || this.state.userBody.currentWeight || 65;
    const bpSys = summary.bpSys || this.state.userBody.bloodPressureSystolic || 120;
    const bpDia = summary.bpDia || this.state.userBody.bloodPressureDiastolic || 80;

    const wBadge = document.getElementById('daily-result-weight-badge');
    if (wBadge) wBadge.textContent = `⚖️ ${w}kg`;

    const bpBadge = document.getElementById('daily-result-bp-badge');
    if (bpBadge) {
      let bpStatus = '';
      if (bpSys >= 140 || bpDia >= 90) bpStatus = ' (高め)';
      else if (bpSys < 120 && bpDia < 80) bpStatus = ' (正常)';
      bpBadge.textContent = `💓 ${bpSys}/${bpDia} mmHg${bpStatus}`;
    }

    document.getElementById('daily-total-calories').textContent = summary.totalCalories || 0;
    
    const badge = document.getElementById('daily-calories-eval');
    if (summary.goalDiff > 200) {
      badge.textContent = 'カロリーオーバー気味';
      badge.className = 'badge badge-warning';
    } else if (summary.goalDiff < -200) {
      badge.textContent = 'カロリー不足気味';
      badge.className = 'badge badge-warning';
    } else {
      badge.textContent = '目標達成ペース！';
      badge.className = 'badge badge-success';
    }

    const { protein = 0, fat = 0, carbs = 0 } = summary.pfc || {};
    const pfcTotal = protein * 4 + fat * 9 + carbs * 4;
    const pPct = pfcTotal > 0 ? (protein * 4 / pfcTotal * 100) : 33;
    const fPct = pfcTotal > 0 ? (fat * 9 / pfcTotal * 100) : 33;
    const cPct = pfcTotal > 0 ? (carbs * 4 / pfcTotal * 100) : 34;

    document.getElementById('daily-protein').textContent = `${protein}g`;
    document.getElementById('daily-fat').textContent = `${fat}g`;
    document.getElementById('daily-carbs').textContent = `${carbs}g`;
    
    setTimeout(() => {
      document.getElementById('daily-pfc-protein').style.width = `${pPct}%`;
      document.getElementById('daily-pfc-fat').style.width = `${fPct}%`;
      document.getElementById('daily-pfc-carbs').style.width = `${cPct}%`;
    }, 150);

    document.getElementById('daily-ai-comment').textContent = summary.aiComment || 'アドバイスがありません。';
  },

  async analyzeDaily(dateStr, force = false, measurementData = null) {
    if (!this.state.apiKey) {
      this.showToast('Gemini APIキーを設定してください', 'error');
      this.closeDailySummaryModal();
      this.openApiModal();
      return;
    }

    const meals = this.state.mealHistory.filter(m => {
      const dateObj = new Date(m.timestamp);
      const d = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + String(dateObj.getDate()).padStart(2, '0');
      return d === dateStr;
    });

    if (meals.length === 0) {
      this.showToast('この日の食事記録がありません。', 'error');
      this.closeDailySummaryModal();
      return;
    }

    document.getElementById('daily-summary-confirm').style.display = 'none';
    document.getElementById('daily-summary-loading').style.display = 'block';
    document.getElementById('daily-summary-result').style.display = 'none';

    let totalCalories = 0;
    let totalPFC = { protein: 0, fat: 0, carbs: 0 };
    let mealsSummaryText = '';

    meals.forEach(m => {
      totalCalories += (m.calories || 0);
      totalPFC.protein += (m.pfc?.protein || 0);
      totalPFC.fat += (m.pfc?.fat || 0);
      totalPFC.carbs += (m.pfc?.carbs || 0);
      const sodiumInfo = m.nutrients?.sodium ? `, ナトリウム:${m.nutrients.sodium}mg` : '';
      mealsSummaryText += `・${m.foodName} (${m.calories}kcal, P:${m.pfc?.protein || 0}g, F:${m.pfc?.fat || 0}g, C:${m.pfc?.carbs || 0}g${sodiumInfo}) - AI評価: ${m.aiComment}\n`;
    });

    const goalCal = this.state.goals?.calories || 1800;
    const goalDiff = totalCalories - goalCal;
    const diffText = goalDiff > 0 ? `+${goalDiff}` : goalDiff;

    const ub = this.state.userBody || {};
    const curW = measurementData?.weight ?? ub.currentWeight ?? 65;
    const tarW = ub.targetWeight || 60;
    const bpSys = measurementData?.bpSys ?? ub.bloodPressureSystolic ?? 120;
    const bpDia = measurementData?.bpDia ?? ub.bloodPressureDiastolic ?? 80;
    const age = this.getAge(ub.birthDate);
    const genderStr = ub.gender === 'female' ? '女性' : ub.gender === 'male' ? '男性' : 'その他';
    const uName = ub.userName ? `${ub.userName}さん` : '';

    let mode = '維持';
    if (tarW < curW) mode = '減量';
    if (tarW > curW) mode = '増量';

    const prompt = `あなたはプロの医師・管理栄養士AIです。以下のユーザーの身体情報（お名前・年齢・性別・体重・血圧）と「1日の食事記録」を総合的に分析し、医学的・栄養学的な総括アドバイスを生成してください。

【ユーザー身体・健康データ】
${uName ? `お名前: ${uName}\n` : ''}年齢: ${age !== null ? `${age}歳` : '未設定'}
性別: ${genderStr}
現在の体重: ${curW}kg (目標: ${tarW}kg, ${mode}目標)
現在の血圧: ${bpSys}/${bpDia} mmHg (収縮期${bpSys} / 拡張期${bpDia})
1日の目標摂取カロリー: ${goalCal}kcal
生活習慣・ルーティン・特記事項: ${ub.routineNotes || 'なし'}

【本日の食事データ】
総摂取カロリー: ${totalCalories}kcal (目標との差: ${diffText}kcal)
合計PFC: タンパク質 ${totalPFC.protein}g, 脂質 ${totalPFC.fat}g, 炭水化物 ${totalPFC.carbs}g
食べたもの一覧と個別の評価:
${mealsSummaryText}

【総括指示】
これらのデータを元に、1日の総括となるAIアドバイス（日本語、4〜5文程度）を作成してください。${uName ? `文頭などで自然に「${uName}、今日もお疲れ様でした！」のように呼びかけてください。` : ''}
以下の内容を必ず含めてください：
1. カロリーおよびPFCの摂取バランス評価
2. ユーザーの年齢・性別・体重目標に対するフィードバック
3. 血圧（最高${bpSys} / 最低${bpDia} mmHg）を踏まえた栄養アドバイス（塩分・ナトリウムの摂りすぎ注意、カリウムや食物繊維の摂取、水分や脂質のバランスなど）
4. ユーザーの生活ルーティンや特記事項（設定されている場合）に配慮した、実践的かつ継続しやすいアドバイス
5. 良かった点と、明日以降の具体的な改善アクション

必ず以下のJSON形式のみで出力してください。

{
  "aiComment": "ここへ総括アドバイスを記述"
}`;

    try {
      const parsed = await this.executeGeminiGenerate({
        prompt,
        temperature: 0.2
      });

      const summary = {
        totalCalories,
        pfc: totalPFC,
        goalDiff,
        weight: curW,
        bpSys,
        bpDia,
        aiComment: parsed.aiComment || '本日の食事記録および体重・血圧データから総括分析を完了しました。'
      };

      this.state.dailySummaries[dateStr] = summary;
      await this.saveToStorage();
      this.renderDailySummaryResult(summary);
      this.renderDashboard();
      
      if (force) {
        this.showToast('1日の総括分析が完了しました', 'success');
      }

    } catch (err) {
      console.error('Daily analysis error:', err);
      document.getElementById('daily-summary-loading').style.display = 'none';
      this.closeDailySummaryModal();
      this.showToast(`分析エラー: ${err.message}`, 'error');
    }
  },

  // ===== Goal Settings =====
  calculateGoalsFromWeight() {
    const nameEl = document.getElementById('user-name');
    const curWEl = document.getElementById('user-current-weight');
    const tarWEl = document.getElementById('user-target-weight');
    const actEl = document.getElementById('user-activity-level');
    const birthEl = document.getElementById('user-birthdate');
    const genderEl = document.getElementById('user-gender');
    const bpSysEl = document.getElementById('user-bp-systolic');
    const bpDiaEl = document.getElementById('user-bp-diastolic');
    if (!curWEl || !tarWEl || !actEl) return null;

    const userName = nameEl?.value?.trim() || this.state.userBody.userName || '';
    const currentWeight = parseFloat(curWEl.value) || 65;
    const targetWeight = parseFloat(tarWEl.value) || 60;
    const activity = actEl.value || 'moderate';
    const birthDate = birthEl?.value || '';
    const gender = genderEl?.value || 'male';
    const bloodPressureSystolic = parseInt(bpSysEl?.value) || 120;
    const bloodPressureDiastolic = parseInt(bpDiaEl?.value) || 80;

    this.state.userBody = {
      ...this.state.userBody,
      userName,
      birthDate,
      gender,
      currentWeight,
      targetWeight,
      activityLevel: activity,
      bloodPressureSystolic,
      bloodPressureDiastolic
    };

    // 1. 基礎代謝 (BMR) 算出 (性別と体重)
    const baseMult = gender === 'female' ? 21.5 : gender === 'male' ? 24 : 22.5;
    const bmr = currentWeight * baseMult;

    // 2. 活動レベル乗数
    const actMultipliers = { light: 1.3, moderate: 1.5, active: 1.75 };
    const tdee = bmr * (actMultipliers[activity] || 1.5);

    // 3. モード判定と目標カロリーの調整
    const diff = targetWeight - currentWeight;
    let modeText = '⚖️ 体重維持モード';
    let targetCal = Math.round(tdee);

    if (diff < -0.2) {
      const loseDiff = Math.abs(diff).toFixed(1);
      modeText = `📉 減量モード (-${loseDiff}kg)`;
      targetCal = Math.max(1200, Math.round(tdee - 400));
    } else if (diff > 0.2) {
      const gainDiff = diff.toFixed(1);
      modeText = `📈 増量モード (+${gainDiff}kg)`;
      targetCal = Math.round(tdee + 350);
    }

    // 4. PFCバランス計算
    let pRatio = 1.3;
    if (diff < -0.2) pRatio = 1.6;
    if (diff > 0.2) pRatio = 1.8;
    const protein = Math.round(currentWeight * pRatio);

    const fat = Math.round((targetCal * 0.22) / 9);

    const carbs = Math.max(50, Math.round((targetCal - (protein * 4 + fat * 9)) / 4));

    // UI表示の更新
    const badgeEl = document.getElementById('target-mode-badge');
    if (badgeEl) badgeEl.textContent = modeText;

    const calcCalEl = document.getElementById('calc-calories');
    if (calcCalEl) calcCalEl.textContent = `${targetCal} kcal`;

    const calcPEl = document.getElementById('calc-protein');
    if (calcPEl) calcPEl.textContent = `${protein}g`;

    const calcFEl = document.getElementById('calc-fat');
    if (calcFEl) calcFEl.textContent = `${fat}g`;

    const calcCEl = document.getElementById('calc-carbs');
    if (calcCEl) calcCEl.textContent = `${carbs}g`;

    // 手動入力フォームへの同期
    const calInput = document.getElementById('goal-calories');
    const pInput = document.getElementById('goal-protein');
    const fInput = document.getElementById('goal-fat');
    const cInput = document.getElementById('goal-carbs');

    if (calInput && (!calInput.value || document.activeElement !== calInput)) calInput.value = targetCal;
    if (pInput && (!pInput.value || document.activeElement !== pInput)) pInput.value = protein;
    if (fInput && (!fInput.value || document.activeElement !== fInput)) fInput.value = fat;
    if (cInput && (!cInput.value || document.activeElement !== cInput)) cInput.value = carbs;

    return { calories: targetCal, protein, fat, carbs };
  },

  renderGoals() {
    const ub = this.state.userBody || {
      userName: '', birthDate: '', gender: 'male', currentWeight: 65, targetWeight: 60,
      activityLevel: 'moderate', bloodPressureSystolic: 120, bloodPressureDiastolic: 80,
      routineNotes: ''
    };
    const nameEl = document.getElementById('user-name');
    const birthEl = document.getElementById('user-birthdate');
    const genderEl = document.getElementById('user-gender');
    const curWEl = document.getElementById('user-current-weight');
    const tarWEl = document.getElementById('user-target-weight');
    const actEl = document.getElementById('user-activity-level');
    const bpSysEl = document.getElementById('user-bp-systolic');
    const bpDiaEl = document.getElementById('user-bp-diastolic');
    const routineEl = document.getElementById('user-routine-notes');

    if (nameEl) nameEl.value = ub.userName || '';
    if (birthEl) {
      birthEl.value = ub.birthDate || '';
      const age = this.getAge(ub.birthDate);
      const preview = document.getElementById('user-age-preview');
      if (preview) preview.textContent = age !== null ? `(${age}歳)` : '';
    }
    if (genderEl) genderEl.value = ub.gender || 'male';
    if (curWEl) curWEl.value = ub.currentWeight ?? 65;
    if (tarWEl) tarWEl.value = ub.targetWeight ?? 60;
    if (actEl) actEl.value = ub.activityLevel || 'moderate';
    if (bpSysEl) bpSysEl.value = ub.bloodPressureSystolic ?? 120;
    if (bpDiaEl) bpDiaEl.value = ub.bloodPressureDiastolic ?? 80;
    if (routineEl) routineEl.value = ub.routineNotes || '';

    if (this.state.goals) {
      const calInput = document.getElementById('goal-calories');
      const pInput = document.getElementById('goal-protein');
      const fInput = document.getElementById('goal-fat');
      const cInput = document.getElementById('goal-carbs');
      if (calInput) calInput.value = this.state.goals.calories;
      if (pInput) pInput.value = this.state.goals.protein;
      if (fInput) fInput.value = this.state.goals.fat;
      if (cInput) cInput.value = this.state.goals.carbs;
    }
    this.calculateGoalsFromWeight();
  },

  addRoutineTag(tagText) {
    const el = document.getElementById('user-routine-notes');
    if (!el) return;
    const curVal = el.value.trim();
    if (curVal.includes(tagText)) {
      this.showToast(`「${tagText}」は既に入力欄に含まれています`, 'info');
      el.focus();
      return;
    }
    if (curVal.length > 0) {
      el.value = `${curVal}\n・${tagText}`;
    } else {
      el.value = `・${tagText}`;
    }
    el.focus();
  },

  async saveGoals() {
    const calc = this.calculateGoalsFromWeight() || {};
    this.state.goals = {
      calories: parseInt(document.getElementById('goal-calories').value) || calc.calories || 1800,
      protein: parseInt(document.getElementById('goal-protein').value) || calc.protein || 90,
      fat: parseInt(document.getElementById('goal-fat').value) || calc.fat || 45,
      carbs: parseInt(document.getElementById('goal-carbs').value) || calc.carbs || 220,
    };

    const userName = document.getElementById('user-name')?.value?.trim() || '';
    const birthDate = document.getElementById('user-birthdate')?.value || '';
    const gender = document.getElementById('user-gender')?.value || 'male';
    const curW = parseFloat(document.getElementById('user-current-weight')?.value) || 65;
    const tarW = parseFloat(document.getElementById('user-target-weight')?.value) || 60;
    const act = document.getElementById('user-activity-level')?.value || 'moderate';
    const bpSys = parseInt(document.getElementById('user-bp-systolic')?.value) || 120;
    const bpDia = parseInt(document.getElementById('user-bp-diastolic')?.value) || 80;
    const routineNotes = document.getElementById('user-routine-notes')?.value?.trim() || '';

    this.state.userBody = {
      userName,
      birthDate,
      gender,
      currentWeight: curW,
      targetWeight: tarW,
      activityLevel: act,
      bloodPressureSystolic: bpSys,
      bloodPressureDiastolic: bpDia,
      routineNotes
    };

    await this.saveToStorage();
    this.renderDashboard();
    this.renderChatHistory();
    this.showToast('お名前・身体情報・目標・生活ルーティンを保存しました！', 'success');
  },

  // ===== API Modal =====
  openApiModal() {
    document.getElementById('api-modal').classList.add('active');
    const input = document.getElementById('api-key-input');
    input.value = this.state.apiKey;
    input.type = 'password';
    const modelSelect = document.getElementById('api-model-select');
    if (modelSelect) {
      modelSelect.value = this.state.selectedModel || 'auto';
    }
    if (this.state.apiKey) {
      this.getAvailableModels(this.state.apiKey).catch(() => {});
    }
    setTimeout(() => input.focus(), 100);
  },

  closeApiModal() {
    document.getElementById('api-modal').classList.remove('active');
  },

  async saveApiKey() {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key) {
      this.showToast('APIキーを入力してください', 'error');
      return;
    }
    const modelSelect = document.getElementById('api-model-select');
    if (modelSelect) {
      this.state.selectedModel = modelSelect.value || 'auto';
      if (this.state.selectedModel !== 'auto') {
        this.state.lastWorkingModel = this.state.selectedModel;
      }
    }
    this.state.apiKey = key;
    this._cachedModels = null; // キャッシュクリア
    // バックグラウンドで非同期にモデル一覧を事前フェッチ
    this.getAvailableModels(key, true).catch(() => {});

    await this.saveToStorage();
    this.closeApiModal();
    const keyStatus = document.getElementById('key-status');
    if (keyStatus) {
      keyStatus.textContent = '✓ 設定済み';
      keyStatus.className = 'badge badge-success';
    }
    this.showToast('APIキー・モデル設定を保存しました', 'success');
  },

  toggleApiKeyVisibility() {
    const input = document.getElementById('api-key-input');
    const btn = document.getElementById('btn-toggle-key');
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '🙈';
    } else {
      input.type = 'password';
      btn.textContent = '👁️';
    }
  },

  // ===== AI Nutrition Chat =====
  renderChatHistory(scrollToBottom = false) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    container.innerHTML = '';

    const userName = this.state.userBody?.userName;
    const greetingName = userName ? `${userName}さん、` : '';

    // ウェルカムメッセージ
    const welcomeEl = document.createElement('div');
    welcomeEl.className = 'chat-msg ai';
    welcomeEl.innerHTML = `
      <div class="chat-avatar">👩‍⚕️</div>
      <div class="chat-bubble">
        <div>
          <p>こんにちは！${greetingName}あなたの専属管理栄養士AIです🌿</p>
          <p>本日の食事記録や目標（カロリー・PFC・血圧）、生活ルーティンを踏まえて、最適な食事アドバイスや献立の疑問にお答えします。音声入力（🎙️）や読み上げ（🔊）も可能です。何でもお気軽にご相談ください！</p>
        </div>
        <div class="chat-msg-footer">
          <button class="chat-speak-btn" onclick="App.speak(this.closest('.chat-bubble').querySelector('div').innerText, this)" title="メッセージを音声で読み上げ">
            <span class="chat-speak-icon">🔊</span>
            <span class="chat-speak-label">読み上げ</span>
          </button>
        </div>
      </div>
    `;
    container.appendChild(welcomeEl);

    // 履歴メッセージ
    const history = this.state.chatHistory || [];
    history.forEach(msg => {
      const msgEl = document.createElement('div');
      msgEl.className = `chat-msg ${msg.role === 'user' ? 'user' : 'ai'}`;
      const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      if (msg.role === 'user') {
        msgEl.innerHTML = `
          <div class="chat-bubble">
            <div>${this.escapeHtml(msg.content).replace(/\n/g, '<br>')}</div>
            ${timeStr ? `<div class="chat-msg-time">${timeStr}</div>` : ''}
          </div>
        `;
      } else {
        msgEl.innerHTML = `
          <div class="chat-avatar">👩‍⚕️</div>
          <div class="chat-bubble">
            <div>${this.formatChatMarkdown(msg.content)}</div>
            <div class="chat-msg-footer">
              <button class="chat-speak-btn" onclick="App.speak(this.closest('.chat-bubble').querySelector('div').innerText, this)" title="回答を音声で読み上げ">
                <span class="chat-speak-icon">🔊</span>
                <span class="chat-speak-label">読み上げ</span>
              </button>
              ${timeStr ? `<div class="chat-msg-time">${timeStr}</div>` : ''}
            </div>
          </div>
        `;
      }
      container.appendChild(msgEl);
    });

    if (scrollToBottom) {
      setTimeout(() => {
        container.scrollTop = container.scrollHeight;
      }, 50);
    }
  },

  escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  formatChatMarkdown(text) {
    if (!text) return '';
    let formatted = this.escapeHtml(text);

    // 太字 **text**
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // 箇条書き・リスト
    const lines = formatted.split('\n');
    let inList = false;
    let result = [];

    lines.forEach(line => {
      const trimmed = line.trim();
      if (/^[・\-\*]\s+(.*)/.test(trimmed)) {
        if (!inList) {
          result.push('<ul>');
          inList = true;
        }
        result.push(`<li>${trimmed.replace(/^[・\-\*]\s+/, '')}</li>`);
      } else if (/^\d+\.\s+(.*)/.test(trimmed)) {
        if (!inList) {
          result.push('<ol>');
          inList = true;
        }
        result.push(`<li>${trimmed.replace(/^\d+\.\s+/, '')}</li>`);
      } else {
        if (inList) {
          result.push(result[result.length - 1].startsWith('<ol>') ? '</ol>' : '</ul>');
          inList = false;
        }
        if (trimmed) {
          result.push(`<p>${line}</p>`);
        }
      }
    });

    if (inList) {
      result.push('</ul>');
    }

    return result.join('');
  },

  async sendChatMessageFromInput() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    await this.sendChatMessage(text);
  },

  async sendQuickChat(text) {
    this.switchTab('chat');
    await this.sendChatMessage(text);
  },

  async sendChatMessage(userText) {
    if (!userText) return;

    if (!this.state.apiKey) {
      this.showToast('Gemini APIキーを設定してください', 'error');
      this.openApiModal();
      return;
    }

    // ユーザーメッセージを記録
    const userMsg = {
      role: 'user',
      content: userText,
      timestamp: Date.now()
    };
    this.state.chatHistory.push(userMsg);
    this.renderChatHistory(true);

    // タイピングインジケーター表示
    const container = document.getElementById('chat-messages');
    const typingEl = document.createElement('div');
    typingEl.className = 'chat-msg ai';
    typingEl.id = 'chat-typing-indicator';
    typingEl.innerHTML = `
      <div class="chat-avatar">👩‍⚕️</div>
      <div class="chat-bubble">
        <div class="typing-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;
    container.appendChild(typingEl);
    container.scrollTop = container.scrollHeight;

    // 送信ボタンの無効化
    const sendBtn = document.getElementById('btn-send-chat');
    if (sendBtn) sendBtn.disabled = true;

    try {
      // コンテキストデータの収集
      const ub = this.state.userBody || {};
      const uName = ub.userName ? `${ub.userName}さん` : '';
      const age = this.getAge(ub.birthDate);
      const genderStr = ub.gender === 'female' ? '女性' : ub.gender === 'male' ? '男性' : 'その他';
      const curW = ub.currentWeight || 65;
      const tarW = ub.targetWeight || 60;
      const bpSys = ub.bloodPressureSystolic || 120;
      const bpDia = ub.bloodPressureDiastolic || 80;
      const goalCal = this.state.goals?.calories || 1800;
      const routine = ub.routineNotes || '未設定';

      const now = new Date();
      const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

      const todayMeals = this.state.mealHistory.filter(m => {
        const d = new Date(m.timestamp);
        return (d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')) === todayStr;
      });

      let todayCal = 0, todayP = 0, todayF = 0, todayC = 0, todaySodium = 0;
      let mealListStr = '';
      todayMeals.forEach(m => {
        todayCal += (m.calories || 0);
        todayP += (m.pfc?.protein || 0);
        todayF += (m.pfc?.fat || 0);
        todayC += (m.pfc?.carbs || 0);
        todaySodium += (m.nutrients?.sodium || 0);
        const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        mealListStr += `・[${time}] ${m.foodName} (${m.calories}kcal, P:${m.pfc?.protein || 0}g, F:${m.pfc?.fat || 0}g, C:${m.pfc?.carbs || 0}g, 塩分換算約:${((m.nutrients?.sodium || 0) * 2.54 / 1000).toFixed(1)}g)\n`;
      });
      if (!mealListStr) mealListStr = '（本日の食事記録はまだありません）';

      // 直近の対話履歴（過去5件）
      const recentDialog = this.state.chatHistory.slice(-6, -1).map(h => `${h.role === 'user' ? 'ユーザー' : '管理栄養士AI'}: ${h.content}`).join('\n');

      const prompt = `あなたは親切で専門性の高い専属管理栄養士・ヘルスケアAIです。
ユーザーからの食事・栄養・献立・健康に関する相談や質問に対して、温かく寄り添いながら、科学的根拠に基づいた実践的なアドバイスを日本語で回答してください。

【ユーザー身体・健康データ】
${uName ? `- お名前: ${uName}\n` : ''}- 年齢: ${age !== null ? `${age}歳` : '未設定'}
- 性別: ${genderStr}
- 現在の体重: ${curW}kg (目標体重: ${tarW}kg)
- 現在の血圧: ${bpSys}/${bpDia} mmHg
- 1日目標カロリー: ${goalCal}kcal (PFC目標: タンパク質${this.state.goals?.protein || 90}g, 脂質${this.state.goals?.fat || 45}g, 炭水化物${this.state.goals?.carbs || 220}g)
- 生活習慣・ルーティン・特記事項: ${routine}

【本日の食事摂取状況 (${todayStr})】
- 総摂取カロリー: ${todayCal} kcal (目標との差: ${todayCal - goalCal > 0 ? '+' : ''}${todayCal - goalCal} kcal)
- PFC合計: タンパク質 ${todayP}g, 脂質 ${todayF}g, 炭水化物 ${todayC}g
- ナトリウム合計: ${todaySodium}mg (食塩相当量 約${(todaySodium * 2.54 / 1000).toFixed(1)}g)
- 本日の食事記録一覧:
${mealListStr}

${recentDialog ? `【これまでの対話の文脈】\n${recentDialog}\n` : ''}

【ユーザーからのメッセージ・質問】
${userText}

【回答ガイドライン】
1. ユーザーの身体データや本日の食事記録、生活ルーティンを適宜参照し、ユーザー一人ひとりの現状に合わせた具体的・実践的な回答を行ってください。
${uName ? `2. ユーザーのお名前（${uName}）を適宜自然に呼びかけ、親しみやすい対話を行ってください。\n` : ''}3. 箇条書きや重要なポイントの太字（**強調**）を適度に使って、スマホ画面でも読みやすく整理してください。
4. 専門的でありつつも親しみやすく、モチベーションを高めるトーンを心がけてください。
5. JSONではなく、通常の自然な日本語テキスト（マークダウン形式）で直接回答してください。`;

      const aiResponseText = await this.executeGeminiGenerate({
        prompt,
        isJson: false,
        temperature: 0.7
      });

      const aiMsg = {
        role: 'ai',
        content: aiResponseText || '申し訳ありません。アドバイスの生成に失敗しました。もう一度お試しください。',
        timestamp: Date.now()
      };
      this.state.chatHistory.push(aiMsg);
      await this.saveToStorage();

    } catch (err) {
      console.error('Chat error:', err);
      const errMsg = {
        role: 'ai',
        content: `エラーが発生しました: ${err.message}\nAPIキーや通信状況をご確認の上、再度お試しください。`,
        timestamp: Date.now()
      };
      this.state.chatHistory.push(errMsg);
    } finally {
      const typing = document.getElementById('chat-typing-indicator');
      if (typing) typing.remove();
      if (sendBtn) sendBtn.disabled = false;
      this.renderChatHistory(true);
    }
  },

  async clearChatHistory() {
    if (!this.state.chatHistory || this.state.chatHistory.length === 0) {
      this.showToast('チャット履歴はありません', 'info');
      return;
    }
    if (confirm('チャットの対話履歴を消去しますか？')) {
      this.state.chatHistory = [];
      await this.saveToStorage();
      this.renderChatHistory(true);
      this.showToast('チャット履歴を消去しました', 'info');
    }
  },

  askAboutCurrentDetail() {
    if (!this.state.currentDetailId) return;
    const meal = this.state.mealHistory.find(m => m.id === this.state.currentDetailId);
    if (!meal) return;

    this.closeMealDetail();
    this.switchTab('chat');

    const promptText = `「${meal.foodName}」(${meal.calories}kcal, P:${meal.pfc?.protein || 0}g, F:${meal.pfc?.fat || 0}g, C:${meal.pfc?.carbs || 0}g) を食べたのですが、この食事についての評価や、次の食事で調整すべきアドバイスを教えてください。`;

    setTimeout(() => {
      const chatInput = document.getElementById('chat-input');
      if (chatInput) {
        chatInput.value = promptText;
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
        chatInput.focus();
      }
    }, 200);
  },

  // ===== Toast Notifications =====
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  },
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());

// Handle window resize for chart
window.addEventListener('resize', () => {
  if (App.state.currentTab === 'dashboard') App.renderWeeklyChart();
});
