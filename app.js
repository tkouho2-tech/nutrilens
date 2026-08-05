// ===== NutriLens App - Main Application Logic =====

const App = {
  // State
  state: {
    currentTab: 'capture',
    apiKey: '',
    imageBase64: null,
    imageDataUrl: null,
    currentResult: null,
    mealHistory: [],
    goals: { calories: 2000, protein: 60, fat: 65, carbs: 250 },
    isLoading: false,
  },

  // ===== Initialization =====
  init() {
    this.loadFromStorage();
    this.bindEvents();
    this.renderHistory();
    this.renderDashboard();
    this.renderGoals();
    this.checkApiKey();
  },

  loadFromStorage() {
    const saved = localStorage.getItem('nutrilens_data');
    if (saved) {
      const data = JSON.parse(saved);
      this.state.mealHistory = data.mealHistory || [];
      this.state.goals = data.goals || this.state.goals;
      this.state.apiKey = data.apiKey || '';
    }
  },

  saveToStorage() {
    const data = {
      mealHistory: this.state.mealHistory,
      goals: this.state.goals,
      apiKey: this.state.apiKey,
    };
    localStorage.setItem('nutrilens_data', JSON.stringify(data));
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

    // Save meal button
    document.getElementById('btn-save-meal').addEventListener('click', () => this.saveMeal());

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

    // Goal inputs
    document.querySelectorAll('.goal-input').forEach(input => {
      input.addEventListener('change', () => this.saveGoals());
    });

    // Clear history
    document.getElementById('btn-clear-history').addEventListener('click', () => this.clearHistory());
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
  },

  // ===== Image Handling =====
  handleImageFile(file) {
    if (!file.type.startsWith('image/')) {
      this.showToast('画像ファイルを選択してください', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      this.state.imageDataUrl = dataUrl;
      // Extract base64 part
      this.state.imageBase64 = dataUrl.split(',')[1];
      this.showPreview(dataUrl);
    };
    reader.readAsDataURL(file);
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
    } catch (err) {
      console.error('Analysis error:', err);
      document.getElementById('loading-section').style.display = 'none';
      document.getElementById('preview-section').style.display = 'block';
      this.showToast(`分析エラー: ${err.message}`, 'error');
    }
  },

  async callGeminiApi(base64Image) {
    const prompt = `この料理の写真を詳しく分析して、以下のJSON形式で栄養情報を返してください。
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
  "aiComment": "この食事についての健康アドバイス（日本語、2文程度）"
}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.state.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: base64Image
                }
              }
            ]
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1
          }
        })
      }
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const msg = errData?.error?.message || `HTTPエラー ${response.status}`;
      throw new Error(msg);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('APIからレスポンスが取得できませんでした');

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSONの解析に失敗しました');
    return JSON.parse(jsonMatch[0]);
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
  saveMeal() {
    if (!this.state.currentResult) return;
    const meal = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      imageDataUrl: this.state.imageDataUrl,
      ...this.state.currentResult,
    };
    this.state.mealHistory.unshift(meal);
    this.saveToStorage();
    this.showToast(`「${meal.foodName}」を記録しました！`, 'success');
    this.renderHistory();
    this.renderDashboard();
    // Switch to history tab
    setTimeout(() => this.switchTab('history'), 800);
  },

  // ===== Dashboard =====
  renderDashboard() {
    const today = new Date().toDateString();
    const todayMeals = this.state.mealHistory.filter(m =>
      new Date(m.timestamp).toDateString() === today
    );

    const totalCal = todayMeals.reduce((s, m) => s + (m.calories || 0), 0);
    const totalProtein = todayMeals.reduce((s, m) => s + (m.pfc?.protein || 0), 0);
    const totalFat = todayMeals.reduce((s, m) => s + (m.pfc?.fat || 0), 0);
    const totalCarbs = todayMeals.reduce((s, m) => s + (m.pfc?.carbs || 0), 0);

    document.getElementById('dash-calories').textContent = totalCal;
    document.getElementById('dash-meals').textContent = todayMeals.length;
    document.getElementById('dash-protein').textContent = `${totalProtein}g`;

    const calProgress = Math.min((totalCal / this.state.goals.calories) * 100, 100);
    document.getElementById('calorie-progress-fill').style.width = `${calProgress}%`;
    document.getElementById('calorie-progress-label').textContent =
      `目標 ${this.state.goals.calories} kcal の ${Math.round(calProgress)}%`;

    // Total record count
    const totalEl = document.getElementById('dash-total');
    if (totalEl) totalEl.textContent = this.state.mealHistory.length;

    // PFC totals
    document.getElementById('dash-pfc').textContent = `P:${totalProtein}g F:${totalFat}g C:${totalCarbs}g`;

    // Weekly chart
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

    list.innerHTML = this.state.mealHistory.map((meal, idx) => {
      const date = new Date(meal.timestamp);
      const timeStr = date.toLocaleString('ja-JP', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
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

  },

  deleteMeal(id) {
    this.state.mealHistory = this.state.mealHistory.filter(m => m.id !== id);
    this.saveToStorage();
    this.renderHistory();
    this.renderDashboard();
    this.showToast('食事記録を削除しました', 'info');
  },

  // ===== Meal Detail Modal =====
  openMealDetail(id) {
    const meal = this.state.mealHistory.find(m => m.id === id);
    if (!meal) return;
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
      { value: n.fiber,     unit: 'g',  icon: '🌿', name: '食物繊維' },
      { value: n.sodium,    unit: 'mg', icon: '🧂', name: 'ナトリウム' },
      { value: n.calcium,   unit: 'mg', icon: '🦴', name: 'カルシウム' },
      { value: n.iron,      unit: 'mg', icon: '⚡', name: '鉄分' },
      { value: n.vitaminC,  unit: 'mg', icon: '🍋', name: 'ビタミンC' },
      { value: n.vitaminA,  unit: 'μg', icon: '👁️', name: 'ビタミンA' },
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

  // ===== Text-to-Speech (TTS) =====
  speak(text) {
    if (!text) return;
    if ('speechSynthesis' in window) {
      // 読み上げ中の場合はキャンセル
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ja-JP';
      // 少し聞き取りやすい速度とピッチに調整
      utterance.rate = 1.1; 
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } else {
      this.showToast('お使いのブラウザは音声読み上げに対応していません', 'error');
    }
  },

  clearHistory() {
    if (!confirm('全ての食事記録を削除しますか？')) return;
    this.state.mealHistory = [];
    this.saveToStorage();
    this.renderHistory();
    this.renderDashboard();
    this.showToast('食事記録をリセットしました', 'info');
  },

  // ===== Goal Settings =====
  renderGoals() {
    document.getElementById('goal-calories').value = this.state.goals.calories;
    document.getElementById('goal-protein').value = this.state.goals.protein;
    document.getElementById('goal-fat').value = this.state.goals.fat;
    document.getElementById('goal-carbs').value = this.state.goals.carbs;
  },

  saveGoals() {
    this.state.goals = {
      calories: parseInt(document.getElementById('goal-calories').value) || 2000,
      protein: parseInt(document.getElementById('goal-protein').value) || 60,
      fat: parseInt(document.getElementById('goal-fat').value) || 65,
      carbs: parseInt(document.getElementById('goal-carbs').value) || 250,
    };
    this.saveToStorage();
    this.renderDashboard();
    this.showToast('目標を保存しました', 'success');
  },

  // ===== API Modal =====
  openApiModal() {
    document.getElementById('api-modal').classList.add('active');
    const input = document.getElementById('api-key-input');
    input.value = this.state.apiKey;
    input.type = 'password';
    setTimeout(() => input.focus(), 100);
  },

  closeApiModal() {
    document.getElementById('api-modal').classList.remove('active');
  },

  saveApiKey() {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key) {
      this.showToast('APIキーを入力してください', 'error');
      return;
    }
    this.state.apiKey = key;
    this.saveToStorage();
    this.closeApiModal();
    const keyStatus = document.getElementById('key-status');
    if (keyStatus) {
      keyStatus.textContent = '✓ 設定済み';
      keyStatus.className = 'badge badge-success';
    }
    this.showToast('APIキーを保存しました', 'success');
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
