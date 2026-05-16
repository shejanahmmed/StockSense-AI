/**
 * StockSense AI Frontend Logic
 * Handles dynamic rendering of insights, SHAP drivers, and Chart.js initialization.
 */

let forecastChartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    // 0. Initialize Authentication (Free Database System)
    initAuth();

    // 1. Fetch real insight data from the FastAPI backend
    fetchDataFromBackend();

    // 2. Initialize the Forecast Chart
    initChart();
    
    // 3. Setup CSV Upload Listener
    setupCsvUpload();

    // 4. Initialize Search Filtering
    initSearch();

    // 5. Initialize Notifications
    initNotifications();

    // 6. Setup Navigation
    setupNavigation();

    // 7. Initialize Chat
    initChat();

    // 8. Initialize Inventory Actions (Filter & Download)
    initInventoryActions();

    // 9. Initialize User Profile
    initUserProfile();
});

let fullInventoryData = [];

// ==========================================
// Navigation & Views
// ==========================================
function setupNavigation() {
    const navDashboard = document.getElementById('navDashboard');
    const navInventory = document.getElementById('navInventory');
    const navInsights = document.getElementById('navInsights');
    const navSettings = document.getElementById('navSettings');

    const dashboardView = document.getElementById('dashboardView');
    const inventoryView = document.getElementById('inventoryView');
    const insightsView = document.getElementById('insightsView');
    const settingsView = document.getElementById('settingsView');
    
    // Default view
    let currentView = 'dashboard';

    function hideAll() {
        dashboardView.style.display = 'none';
        inventoryView.style.display = 'none';
        insightsView.style.display = 'none';
        settingsView.style.display = 'none';
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    }

    navDashboard.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentView === 'dashboard') return;
        currentView = 'dashboard';
        hideAll();
        navDashboard.classList.add('active');
        dashboardView.style.display = 'flex';
    });

    navInventory.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentView === 'inventory') return;
        currentView = 'inventory';
        hideAll();
        navInventory.classList.add('active');
        inventoryView.style.display = 'flex';
        
        // Load data if not already loaded
        const tbody = document.getElementById('inventoryTableBody');
        if (tbody.children.length === 0) {
            loadInventoryData();
        }
    });

    navInsights.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentView === 'insights') return;
        currentView = 'insights';
        hideAll();
        navInsights.classList.add('active');
        insightsView.style.display = 'flex';
    });

    navSettings.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentView === 'settings') return;
        currentView = 'settings';
        hideAll();
        navSettings.classList.add('active');
        settingsView.style.display = 'flex';
    });
}

// ==========================================
// Inventory Management
// ==========================================
async function loadInventoryData() {
    const tbody = document.getElementById('inventoryTableBody');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading inventory...</td></tr>';
    
    try {
        const response = await fetch('/api/inventory');
        if (!response.ok) throw new Error('Failed to fetch inventory');
        
        const result = await response.json();
        if (result.status === 'success' && result.data) {
            fullInventoryData = result.data;
            currentInventoryContext = result.data; // Capture context for Chat AI
            renderInventoryTable(fullInventoryData);
        }
    } catch (error) {
        console.error("Inventory error:", error);
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--status-danger);">Failed to load inventory database.</td></tr>';
    }
}

function renderInventoryTable(data) {
    const tbody = document.getElementById('inventoryTableBody');
    const badge = document.getElementById('inventoryCountBadge');
    
    tbody.innerHTML = '';
    badge.innerText = data.length;

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-muted); padding: 2rem;">No products match your filters.</td></tr>';
        return;
    }

    data.forEach(item => {
        const tr = document.createElement('tr');
        
        let statusClass = 'in-stock';
        if (item.status === 'Low Stock') statusClass = 'low-stock';
        if (item.status === 'Out of Stock') statusClass = 'out-of-stock';
        
        let icon = 'fa-box';
        const category = item.category.toLowerCase();
        if (category.includes('laptop') || category.includes('monitor')) icon = 'fa-laptop';
        if (category.includes('camera')) icon = 'fa-camera';
        if (category.includes('audio') || category.includes('headphone')) icon = 'fa-headphones';
        if (category.includes('accessory') || category.includes('keyboard')) icon = 'fa-keyboard';
        if (category.includes('tv')) icon = 'fa-tv';
        if (category.includes('tablet')) icon = 'fa-tablet-screen-button';
        if (category.includes('component') || category.includes('microchip')) icon = 'fa-microchip';
        
        tr.innerHTML = `
            <td style="color: var(--text-muted); font-family: monospace; font-size: 0.85rem;">${item.sku}</td>
            <td>
                <div class="product-cell">
                    <div class="product-icon"><i class="fa-solid ${icon}"></i></div>
                    <div class="product-details">
                        <span class="product-name">${item.name}</span>
                        <span class="product-category">${item.category}</span>
                    </div>
                </div>
            </td>
            <td style="font-weight: 500;">$${item.price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}</td>
            <td>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-weight: 600; font-size: 1.05rem;">${item.stock}</span>
                    <span style="color: var(--text-muted); font-size: 0.8rem;">units</span>
                </div>
            </td>
            <td style="color: var(--text-secondary);">${item.supplier}</td>
            <td><span class="status-pill ${statusClass}">${item.status}</span></td>
            <td>
                <button class="icon-btn glass-panel" style="width: 32px; height: 32px; font-size: 0.8rem; border:none; background: transparent;"><i class="fa-solid fa-ellipsis-vertical"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function initInventoryActions() {
    const filterBtn = document.getElementById('inventoryFilterBtn');
    const downloadBtn = document.getElementById('inventoryDownloadBtn');
    const dropdown = document.getElementById('inventoryFilterDropdown');
    const applyBtn = document.getElementById('applyFilters');
    const resetBtn = document.getElementById('resetFilters');

    if (!filterBtn || !downloadBtn) return;

    // Toggle filter dropdown
    filterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (dropdown && !dropdown.contains(e.target) && e.target !== filterBtn) {
            dropdown.style.display = 'none';
        }
    });

    // Apply filters
    applyBtn.addEventListener('click', () => {
        const category = document.getElementById('filterCategory').value;
        const status = document.getElementById('filterStatus').value;

        let filtered = fullInventoryData;

        if (category !== 'all') {
            filtered = filtered.filter(item => item.category === category);
        }

        if (status !== 'all') {
            filtered = filtered.filter(item => item.status === status);
        }

        renderInventoryTable(filtered);
        dropdown.style.display = 'none';
        addNotification('Filters Applied', `Showing ${filtered.length} matching products.`, 'info');
    });

    // Reset filters
    resetBtn.addEventListener('click', () => {
        document.getElementById('filterCategory').value = 'all';
        document.getElementById('filterStatus').value = 'all';
        renderInventoryTable(fullInventoryData);
        dropdown.style.display = 'none';
    });

    // Download CSV
    downloadBtn.addEventListener('click', () => {
        exportToCSV(fullInventoryData, 'StockSense_Inventory_Report.csv');
        addNotification('Export Successful', 'Inventory data has been exported to CSV.', 'success');
    });
}

function exportToCSV(data, filename) {
    if (!data || data.length === 0) return;

    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(item => {
        return Object.values(item).map(val => {
            if (typeof val === 'string' && val.includes(',')) {
                return `"${val}"`;
            }
            return val;
        }).join(',');
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


// ==========================================
// AI Chat Assistant logic
// ==========================================
let chatHistory = [];
let currentInventoryContext = null;

function initChat() {
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('sendChatBtn');
    
    if (!input || !btn) return;

    btn.addEventListener('click', () => sendChatMessage());
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
}

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    // Add user message to UI
    appendMessage('user', text);
    input.value = '';

    // If context isn't loaded yet, try to load it from the table or memory
    if (!currentInventoryContext) {
        // Simple mock context if inventory isn't fetched
        currentInventoryContext = { info: "SME Electronics Store Inventory" };
    }

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: text,
                history: chatHistory,
                inventory_context: currentInventoryContext
            })
        });

        const result = await response.json();
        if (result.status === 'success') {
            appendMessage('assistant', result.response);
            chatHistory.push({ role: 'user', content: text });
            chatHistory.push({ role: 'assistant', content: result.response });
        }
    } catch (error) {
        console.error("Chat Error:", error);
        appendMessage('assistant', "I'm sorry, I encountered an error connecting to the AI server. Please try again.");
    }
}

function appendMessage(role, content) {
    const chatMessages = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.innerHTML = `<div class="msg-bubble">${content}</div>`;
    chatMessages.appendChild(div);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function initSearch() {
    const searchInput = document.getElementById('dashboardSearch');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const driverItems = document.querySelectorAll('.driver-item');
        let visibleCount = 0;

        driverItems.forEach(item => {
            const name = item.querySelector('.driver-name').textContent.toLowerCase();
            const impact = item.querySelector('.driver-impact').textContent.toLowerCase();
            
            if (name.includes(query) || impact.includes(query)) {
                item.style.display = 'block'; // Or original display type
                visibleCount++;
            } else {
                item.style.display = 'none';
            }
        });

        // Toggle 'No results' message if needed
        let noResults = document.getElementById('no-search-results');
        if (visibleCount === 0 && query !== '') {
            if (!noResults) {
                noResults = document.createElement('p');
                noResults.id = 'no-search-results';
                noResults.style.color = 'var(--text-muted)';
                noResults.style.padding = '1rem';
                noResults.style.textAlign = 'center';
                noResults.innerText = 'No matching drivers found.';
                document.getElementById('drivers-list').appendChild(noResults);
            }
        } else if (noResults) {
            noResults.remove();
        }
    });
}

function setupCsvUpload() {
    const fileInput = document.getElementById('csvFileInput');
    const uploadBtn = document.getElementById('uploadCsvBtn');
    
    if (!fileInput || !uploadBtn) return;
    
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const originalText = uploadBtn.innerHTML;
        uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
        uploadBtn.disabled = true;
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            const response = await fetch('/api/predict', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) throw new Error('Prediction failed');
            const data = await response.json();
            
            if (data.status === 'success') {
                updateChartWithData(data.historical, data.forecast);
                if (data.insight && data.drivers) {
                    renderInsight(data.insight);
                    renderDrivers(data.drivers);
                }
                if (data.kpis) {
                    updateKPIs(data.kpis);
                }
                
                // Add success notification
                addNotification('Forecast Generated', 'New predictions have been generated successfully from your data.', 'success');
            }
        } catch (error) {
            console.error("Upload error:", error);
            alert("Failed to process CSV file. Ensure it has date, sales, promo, and holiday columns.");
        } finally {
            uploadBtn.innerHTML = originalText;
            uploadBtn.disabled = false;
            fileInput.value = ''; // Reset input
        }
    });
}

function updateKPIs(kpis) {
    document.getElementById('kpi-stock').innerText = kpis.current_stock.toLocaleString();
    document.getElementById('kpi-demand').innerText = kpis.forecasted_demand.toLocaleString();
    
    const changeElem = document.getElementById('kpi-demand-change');
    changeElem.innerHTML = `${kpis.percent_change.startsWith('+') ? '<i class="fa-solid fa-arrow-up"></i>' : '<i class="fa-solid fa-arrow-down"></i>'} ${kpis.percent_change}`;
    changeElem.className = `trend ${kpis.percent_change.startsWith('+') ? 'positive' : 'negative'}`;
    
    document.getElementById('kpi-order').innerText = kpis.recommended_order.toLocaleString();
    
    document.getElementById('kpi-stockout').innerText = kpis.time_to_stockout;
    const stockoutSub = document.getElementById('kpi-stockout-sub');
    if (kpis.time_to_stockout === "Healthy") {
        stockoutSub.innerText = "Sufficient Stock";
        stockoutSub.className = "trend positive";
        stockoutSub.parentElement.parentElement.querySelector('.kpi-icon').className = "kpi-icon success-icon";
    } else {
        stockoutSub.innerText = "Depletion Warning";
        stockoutSub.className = "trend negative";
        stockoutSub.parentElement.parentElement.querySelector('.kpi-icon').className = "kpi-icon warning-icon";
        
        // Push warning notification
        addNotification('Stockout Alert', `Store 12 is at risk of depletion in ${kpis.time_to_stockout}.`, 'warning');
    }
}

// ==========================================
// Notification System
// ==========================================
let unreadNotifications = 0;

function initNotifications() {
    const notifBtn = document.getElementById('notificationBtn');
    const dropdown = document.getElementById('notificationDropdown');
    const clearBtn = document.getElementById('clearNotifications');
    
    // Toggle dropdown
    notifBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = dropdown.style.display === 'none';
        dropdown.style.display = isHidden ? 'flex' : 'none';
        if (isHidden) {
            unreadNotifications = 0;
            document.getElementById('notificationDot').style.display = 'none';
        }
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== notifBtn) {
            dropdown.style.display = 'none';
        }
    });

    // Clear all
    clearBtn.addEventListener('click', () => {
        const list = document.getElementById('notificationList');
        list.innerHTML = '<p class="empty-state">No new notifications</p>';
        unreadNotifications = 0;
        document.getElementById('notificationDot').style.display = 'none';
    });
}

function addNotification(title, message, type = 'info') {
    const list = document.getElementById('notificationList');
    const emptyState = list.querySelector('.empty-state');
    
    if (emptyState) {
        emptyState.remove();
    }

    let iconClass = 'fa-solid fa-circle-info';
    if (type === 'success') iconClass = 'fa-solid fa-circle-check';
    if (type === 'warning') iconClass = 'fa-solid fa-triangle-exclamation';

    const item = document.createElement('div');
    item.className = `notification-item ${type}`;
    item.innerHTML = `
        <i class="notif-icon ${iconClass}"></i>
        <div class="notif-content">
            <h5>${title}</h5>
            <p>${message}</p>
        </div>
    `;

    // Add to top of list
    list.insertBefore(item, list.firstChild);

    // Update unread count
    unreadNotifications++;
    const dot = document.getElementById('notificationDot');
    dot.style.display = 'block';
}

function updateChartWithData(historical, forecast) {
    if (!forecastChartInstance) return;
    
    // Process Data
    const histDates = historical.map(d => d.date);
    const histSales = historical.map(d => Math.round(d.sales));
    
    const foreDates = forecast.map(d => d.date);
    const predictedSales = forecast.map(d => Math.round(d.predicted_sales));
    const upper = forecast.map(d => Math.round(d.upper_bound));
    const lower = forecast.map(d => Math.round(d.lower_bound));
    
    // Combine labels
    const labels = [...histDates, ...foreDates];
    
    // Construct arrays to match the labels length
    const historicalData = new Array(labels.length).fill(null);
    const forecastData = new Array(labels.length).fill(null);
    const confidenceUpper = new Array(labels.length).fill(null);
    const confidenceLower = new Array(labels.length).fill(null);
    
    // Fill historical
    for (let i = 0; i < histDates.length; i++) {
        historicalData[i] = histSales[i];
    }
    
    // Connect the lines by putting the last historical point as the start of the forecast line
    const connectIndex = histDates.length - 1;
    if (connectIndex >= 0) {
        forecastData[connectIndex] = histSales[connectIndex];
        confidenceUpper[connectIndex] = histSales[connectIndex];
        confidenceLower[connectIndex] = histSales[connectIndex];
    }
    
    // Fill forecast
    for (let i = 0; i < foreDates.length; i++) {
        const idx = histDates.length + i;
        forecastData[idx] = predictedSales[i];
        confidenceUpper[idx] = upper[i];
        confidenceLower[idx] = lower[i];
    }
    
    // Update Chart
    forecastChartInstance.data.labels = labels;
    forecastChartInstance.data.datasets[0].data = historicalData;
    forecastChartInstance.data.datasets[1].data = forecastData;
    forecastChartInstance.data.datasets[2].data = confidenceUpper;
    forecastChartInstance.data.datasets[3].data = confidenceLower;
    
    forecastChartInstance.update();
}

async function fetchDataFromBackend() {
    try {
        const response = await fetch('/api/insight');
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        
        if (data.status === 'success') {
            renderInsight(data.insight);
            renderDrivers(data.drivers);
        }
    } catch (error) {
        console.error('Error fetching insight:', error);
        // Fallback error state showing exact error to debug
        const container = document.getElementById('ai-insight-text');
        container.innerHTML = `<p class="animated-text" style="color: var(--status-danger);">Failed to load AI insights. Error: ${error.message}. <br>Make sure you are at http://127.0.0.1:8000/ and NOT file:///C:/...</p>`;
        document.getElementById('drivers-list').innerHTML = '<p style="color: var(--text-muted);">Drivers unavailable</p>';
    }
}

function renderInsight(insightText) {
    const container = document.getElementById('ai-insight-text');
    
    // Format the text slightly for HTML display
    let formattedText = insightText.replace(/Stockout Warning:/g, '<span style="color: var(--status-warning); font-weight: 600;"><i class="fa-solid fa-triangle-exclamation"></i> Stockout Warning:</span>');
    formattedText = formattedText.replace(/⚠️/g, ''); // Remove emoji if it's there to avoid duplication with icon
    
    const insightHTML = `
        <p class="animated-text" style="white-space: pre-line;">
            ${formattedText}
        </p>
    `;
    
    container.innerHTML = insightHTML;
}

function renderDrivers(drivers) {
    const driversList = document.getElementById('drivers-list');
    let html = '';
    
    drivers.forEach((driver, index) => {
        // Staggered animation delay
        const delay = index * 0.15;
        
        html += `
            <div class="driver-item" style="animation: slideInUp 0.4s ease-out ${delay}s both;">
                <div class="driver-header">
                    <span class="driver-name">${driver.name}</span>
                    <span class="driver-impact">${driver.impact}</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${driver.value}%; background: ${driver.color}"></div>
                </div>
            </div>
        `;
    });

    driversList.innerHTML = html;
}

function initChart() {
    const ctx = document.getElementById('forecastChart').getContext('2d');
    
    // Gradient for the line area
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(139, 92, 246, 0.4)');
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0.0)');

    // Mock Data: 7 days historical, 7 days forecast
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon (F)', 'Tue (F)', 'Wed (F)', 'Thu (F)', 'Fri (F)', 'Sat (F)', 'Sun (F)'];
    
    // Historical data ends at index 6, Forecast starts at index 6 to connect the line
    const historicalData = [310, 340, 325, 380, 450, 520, 480, null, null, null, null, null, null, null];
    const forecastData = [null, null, null, null, null, null, 480, 510, 560, 590, 720, 850, 910, 890];
    const confidenceUpper = [null, null, null, null, null, null, 480, 530, 590, 620, 780, 920, 990, 960];
    const confidenceLower = [null, null, null, null, null, null, 480, 490, 530, 560, 660, 780, 830, 820];

    // Global chart defaults for dark theme
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Outfit', sans-serif";

    forecastChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Historical Sales',
                    data: historicalData,
                    borderColor: '#64748b',
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 6
                },
                {
                    label: 'Predicted Sales',
                    data: forecastData,
                    borderColor: '#8b5cf6',
                    backgroundColor: gradient,
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: '#0f111a',
                    pointBorderColor: '#8b5cf6',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6
                },
                // Confidence Intervals (invisible lines to create the shaded area)
                {
                    label: 'Upper Confidence',
                    data: confidenceUpper,
                    borderColor: 'transparent',
                    backgroundColor: 'transparent',
                    pointRadius: 0,
                    fill: false,
                    tension: 0.4
                },
                {
                    label: 'Lower Confidence',
                    data: confidenceLower,
                    borderColor: 'transparent',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    pointRadius: 0,
                    fill: '-1', // Fill to previous dataset (Upper Confidence)
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: false // We use custom HTML legend
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 17, 26, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#e2e8f0',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: true,
                    callbacks: {
                        label: function(context) {
                            // Don't show tooltip for confidence bounds
                            if (context.datasetIndex > 1) return null;
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y + ' units';
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false,
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false,
                    },
                    beginAtZero: true
                }
            }
        }
    });
}

// ==========================================
// Authentication & Database Logic
// ==========================================
function checkAuth() {
    const savedName = localStorage.getItem('stockSense_storeName');
    const appContainer = document.getElementById('appContainer');
    const authScreen = document.getElementById('authScreen');
    
    if (!savedName) {
        // Not logged in - Show Auth Screen
        if (appContainer) appContainer.style.display = 'none';
        if (authScreen) authScreen.style.display = 'flex';
        return false;
    } else {
        // Logged in - Show Dashboard
        if (authScreen) authScreen.style.display = 'none';
        if (appContainer) appContainer.style.display = 'flex';
        
        // Restore user data
        const savedRole = localStorage.getItem('stockSense_industry') || 'Electronics';
        const savedAvatar = localStorage.getItem('stockSense_avatarUrl') || '';
        updateUserProfileUI(savedName, savedRole, savedAvatar);
        return true;
    }
}

function initAuth() {
    checkAuth();
    
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const orgName = document.getElementById('authStoreName').value.trim();
            const industry = document.getElementById('authIndustry').value;
            
            if (!orgName) {
                alert('Please enter your Organization Name');
                return;
            }

            const originalText = loginBtn.innerHTML;
            loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...';
            loginBtn.disabled = true;

            try {
                // Fetch from SQLite DB via FastAPI
                const response = await fetch(`/api/user/profile/${encodeURIComponent(orgName)}`);
                const data = await response.json();
                
                let finalIndustry = industry;
                let finalAvatar = '';

                if (data.status === 'success') {
                    // Existing User - Load DB values
                    finalIndustry = data.data.industry;
                    finalAvatar = data.data.avatar_url;
                } else {
                    // New User - Save to DB
                    await fetch('/api/user/profile', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            org_name: orgName,
                            industry: industry,
                            avatar_url: ""
                        })
                    });
                }

                // Update LocalStorage Session
                localStorage.setItem('stockSense_storeName', orgName);
                localStorage.setItem('stockSense_industry', finalIndustry);
                localStorage.setItem('stockSense_avatarUrl', finalAvatar);
                
                // Update settings inputs
                const storeNameInput = document.getElementById('settingStoreName');
                const industryInput = document.getElementById('settingIndustry');
                const avatarInput = document.getElementById('settingAvatarUrl');
                if (storeNameInput) storeNameInput.value = orgName;
                if (industryInput) industryInput.value = finalIndustry;
                if (avatarInput) avatarInput.value = finalAvatar;
                
                checkAuth(); // Proceed to dashboard
                addNotification('Authentication Successful', `Welcome to StockSense AI, ${orgName}!`, 'success');
            } catch (error) {
                console.error("Auth Error:", error);
                alert("Failed to connect to SQLite database.");
            } finally {
                loginBtn.innerHTML = originalText;
                loginBtn.disabled = false;
            }
        });
    }
}

// ==========================================
// User Profile & Settings
// ==========================================
function initUserProfile() {
    // 1. Load User Profile from localStorage
    const savedName = localStorage.getItem('stockSense_storeName');
    const savedRole = localStorage.getItem('stockSense_industry');
    const savedAvatar = localStorage.getItem('stockSense_avatarUrl') || '';
    
    if (savedName) updateUserProfileUI(savedName, savedRole, savedAvatar);
    
    // Initialize Input Fields
    const storeNameInput = document.getElementById('settingStoreName');
    const industryInput = document.getElementById('settingIndustry');
    const avatarInput = document.getElementById('settingAvatarUrl');
    if (storeNameInput && savedName) storeNameInput.value = savedName;
    if (industryInput && savedRole) industryInput.value = savedRole;
    if (avatarInput) avatarInput.value = savedAvatar;
    
    // 2. Profile Dropdown Toggle
    const profileBtn = document.getElementById('userProfileBtn');
    const profileDropdown = document.getElementById('profileDropdown');
    const chevron = document.getElementById('userProfileChevron');
    
    if (profileBtn && profileDropdown) {
        profileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = profileDropdown.style.display === 'none';
            profileDropdown.style.display = isHidden ? 'flex' : 'none';
            if (chevron) {
                chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
            }
        });
        
        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!profileDropdown.contains(e.target) && !profileBtn.contains(e.target)) {
                profileDropdown.style.display = 'none';
                if (chevron) chevron.style.transform = 'rotate(0deg)';
            }
        });
    }
    
    // 3. Dropdown Actions
    const dropdownSettingsBtn = document.getElementById('dropdownSettingsBtn');
    if (dropdownSettingsBtn) {
        dropdownSettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Navigate to settings (trigger nav click)
            document.getElementById('navSettings').click();
            profileDropdown.style.display = 'none';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        });
    }
    
    const dropdownLogoutBtn = document.getElementById('dropdownLogoutBtn');
    if (dropdownLogoutBtn) {
        dropdownLogoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if(confirm('Are you sure you want to sign out?')) {
                // Clear state
                localStorage.removeItem('stockSense_storeName');
                localStorage.removeItem('stockSense_industry');
                // Reload to reset
                window.location.reload();
            }
        });
    }
    
    // 4. Save Settings Button
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', async () => {
            const newName = storeNameInput.value.trim();
            if (!newName) {
                alert('Organization Name cannot be empty.');
                return;
            }
            const newRole = industryInput.value;
            const newAvatar = avatarInput ? avatarInput.value.trim() : '';
            
            const originalText = saveSettingsBtn.innerHTML;
            saveSettingsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
            saveSettingsBtn.disabled = true;

            try {
                // Save to SQLite DB
                const response = await fetch('/api/user/profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        org_name: newName,
                        industry: newRole,
                        avatar_url: newAvatar
                    })
                });
                const data = await response.json();
                if (data.status !== 'success') throw new Error("DB Save Failed");

                // Update Session
                localStorage.setItem('stockSense_storeName', newName);
                localStorage.setItem('stockSense_industry', newRole);
                localStorage.setItem('stockSense_avatarUrl', newAvatar);
                
                updateUserProfileUI(newName, newRole, newAvatar);
                addNotification('Settings Saved', 'Your preferences have been successfully updated in SQLite.', 'success');
            } catch (error) {
                console.error("Save Error:", error);
                addNotification('Save Failed', 'Could not save to SQLite database.', 'warning');
            } finally {
                saveSettingsBtn.innerHTML = originalText;
                saveSettingsBtn.disabled = false;
            }
        });
    }
}

function updateUserProfileUI(name, role, avatarUrl) {
    // Sidebar
    const sidebarName = document.getElementById('sidebarUserName');
    const sidebarRole = document.getElementById('sidebarUserRole');
    if (sidebarName) sidebarName.textContent = name;
    if (sidebarRole) sidebarRole.textContent = role;
    
    // Avatar Logic
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    const sidebarAvatarIcon = document.getElementById('sidebarAvatarIcon');
    if (sidebarAvatar && sidebarAvatarIcon) {
        if (avatarUrl && avatarUrl.trim() !== '') {
            sidebarAvatar.style.backgroundImage = `url('${avatarUrl}')`;
            sidebarAvatarIcon.style.display = 'none';
        } else {
            sidebarAvatar.style.backgroundImage = `linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))`;
            sidebarAvatarIcon.style.display = 'block';
        }
    }
    
    // Dropdown Header
    const dropdownName = document.getElementById('dropdownUserName');
    const dropdownRole = document.getElementById('dropdownUserRole');
    if (dropdownName) dropdownName.textContent = name;
    if (dropdownRole) dropdownRole.textContent = role;
    
    // Update main header dashboard text
    const aiInsightTitle = document.querySelector('.insight-section .section-header h2.gradient-text');
    if (aiInsightTitle) {
        aiInsightTitle.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> AI Insight for ${name} — ${role}`;
    }
}
