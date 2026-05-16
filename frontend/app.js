/**
 * StockSense AI Frontend Logic
 * Handles dynamic rendering of insights, SHAP drivers, and Chart.js initialization.
 */

let forecastChartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    // 0. Initialize Authentication (Free Database System)
    initAuth();

    // 1. Fetch real insight data from the FastAPI backend
    fetchDefaultInsight();

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
        const token = localStorage.getItem('stockSense_jwt');
        const response = await fetch('/api/inventory', {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const result = await response.json();
        if (result.status === 'success' && result.data) {
            fullInventoryData = result.data;
            currentInventoryContext = result.data;
            renderInventoryTable(fullInventoryData);
            // Dynamically populate category filter from real data
            populateCategoryFilter(fullInventoryData);
        }
    } catch (error) {
        console.error("Inventory error:", error);
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--status-danger);">Failed to load inventory. Please log in again.</td></tr>';
    }
}

let currentInventoryPage = 1;
const itemsPerPage = 15;
let currentFilteredData = [];

function renderInventoryTable(data, page = 1) {
    currentFilteredData = data;
    currentInventoryPage = page;
    
    const tbody = document.getElementById('inventoryTableBody');
    const badge = document.getElementById('inventoryCountBadge');
    
    tbody.innerHTML = '';
    badge.innerText = data.length;

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-muted); padding: 2rem;">No products match your filters.</td></tr>';
        renderPagination(0, 1);
        return;
    }

    const startIdx = (page - 1) * itemsPerPage;
    const endIdx = startIdx + itemsPerPage;
    const paginatedData = data.slice(startIdx, endIdx);

    paginatedData.forEach(item => {
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
                <button class="icon-btn action-delete" data-sku="${item.sku}" style="width: 32px; height: 32px; font-size: 0.8rem; border:none; background: rgba(239, 68, 68, 0.1); color: #ef4444; cursor: pointer; border-radius: 8px;" title="Delete Item"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Attach delete listeners
    document.querySelectorAll('.action-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const sku = e.currentTarget.getAttribute('data-sku');
            if (confirm(`Are you sure you want to delete SKU ${sku}?`)) {
                try {
                    const token = localStorage.getItem('stockSense_jwt');
                    const res = await fetch(`/api/inventory/${encodeURIComponent(sku)}`, { 
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const data = await res.json();
                    if (data.status === 'success') {
                        addNotification('Item Deleted', `Successfully removed ${sku} from inventory.`, 'success');
                        loadInventoryData();
                    } else {
                        addNotification('Delete Failed', data.message || 'Could not delete item.', 'warning');
                    }
                } catch (error) {
                    console.error("Delete failed:", error);
                }
            }
        });
    });

    renderPagination(data.length, page);
}

function renderPagination(totalItems, currentPage) {
    let paginationContainer = document.getElementById('inventoryPagination');
    if (!paginationContainer) {
        paginationContainer = document.createElement('div');
        paginationContainer.id = 'inventoryPagination';
        paginationContainer.style.display = 'flex';
        paginationContainer.style.justifyContent = 'space-between';
        paginationContainer.style.alignItems = 'center';
        paginationContainer.style.marginTop = '1rem';
        paginationContainer.style.padding = '1rem';
        paginationContainer.style.borderTop = '1px solid rgba(255, 255, 255, 0.05)';
        document.querySelector('.inventory-table-container').appendChild(paginationContainer);
    }
    
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }
    
    paginationContainer.innerHTML = `
        <div style="font-size: 0.85rem; color: var(--text-muted);">
            Showing ${(currentPage - 1) * itemsPerPage + 1} to ${Math.min(currentPage * itemsPerPage, totalItems)} of ${totalItems} entries
        </div>
        <div style="display: flex; gap: 0.5rem;">
            <button class="secondary-btn" id="prevPageBtn" ${currentPage === 1 ? 'disabled' : ''} style="padding: 0.25rem 0.75rem; font-size: 0.85rem;">Previous</button>
            <button class="secondary-btn" id="nextPageBtn" ${currentPage === totalPages ? 'disabled' : ''} style="padding: 0.25rem 0.75rem; font-size: 0.85rem;">Next</button>
        </div>
    `;
    
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    
    if (prevBtn) prevBtn.addEventListener('click', () => renderInventoryTable(currentFilteredData, currentPage - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => renderInventoryTable(currentFilteredData, currentPage + 1));
}

// ==========================================
// Toast (in-page, for auth screen / overlays)
// ==========================================
function showToast(message, type = 'info') {
    let toast = document.getElementById('stocksense-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'stocksense-toast';
        toast.style.cssText = [
            'position:fixed', 'bottom:2rem', 'left:50%',
            'transform:translateX(-50%) translateY(20px)',
            'background:var(--glass-bg)', 'backdrop-filter:blur(20px)',
            'border:1px solid rgba(255,255,255,0.1)', 'border-radius:12px',
            'padding:0.85rem 1.5rem', 'font-size:0.9rem', 'font-weight:500',
            'color:var(--text-primary)', 'z-index:99999', 'opacity:0',
            'transition:all 0.3s ease', 'box-shadow:0 8px 32px rgba(0,0,0,0.4)',
            'display:flex', 'align-items:center', 'gap:0.75rem', 'max-width:380px'
        ].join(';');
        document.body.appendChild(toast);
    }
    const icons = { info:'fa-circle-info', warning:'fa-triangle-exclamation', error:'fa-circle-xmark', success:'fa-circle-check' };
    const colors = { info:'var(--accent-primary)', warning:'#f59e0b', error:'var(--status-danger)', success:'var(--status-success)' };
    toast.innerHTML = `<i class="fa-solid ${icons[type]||icons.info}" style="color:${colors[type]};flex-shrink:0;"></i> ${message}`;
    toast.style.borderColor = colors[type] || colors.info;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
    }, 3500);
}

// ==========================================
// Add Item Modal
// ==========================================
function showModalAddItem() {
    const old = document.getElementById('addItemModal');
    if (old) old.remove();

    const categories = [...new Set(fullInventoryData.map(i => i.category))].filter(Boolean).sort();
    const catOpts = categories.length > 0
        ? categories.map(c => `<option value="${c}">${c}</option>`).join('')
        : '<option value="Electronics">Electronics</option><option value="Accessories">Accessories</option>';

    const modal = document.createElement('div');
    modal.id = 'addItemModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.65);backdrop-filter:blur(8px);';
    modal.innerHTML = `
        <div class="glass-panel" style="width:500px;max-width:95vw;padding:2rem;display:flex;flex-direction:column;gap:1.25rem;box-shadow:0 25px 60px rgba(0,0,0,0.5);">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <h3 style="margin:0;font-size:1.2rem;"><i class="fa-solid fa-plus-circle" style="color:var(--accent-primary);margin-right:0.5rem;"></i>Add New Product</h3>
                <button id="closeAddModal" style="background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                <div class="settings-group" style="margin:0;">
                    <label>SKU <span style="color:var(--status-danger)">*</span></label>
                    <input type="text" id="modalSku" class="settings-input" placeholder="e.g. ELEC-013" />
                </div>
                <div class="settings-group" style="margin:0;">
                    <label>Category <span style="color:var(--status-danger)">*</span></label>
                    <select id="modalCategory" class="settings-input">
                        ${catOpts}
                        <option value="_new_">+ New Category...</option>
                    </select>
                </div>
                <div class="settings-group" style="grid-column:1/-1;margin:0;">
                    <label>Product Name <span style="color:var(--status-danger)">*</span></label>
                    <input type="text" id="modalName" class="settings-input" placeholder="e.g. Sony WH-1000XM5" />
                </div>
                <div class="settings-group" style="margin:0;">
                    <label>Unit Price ($) <span style="color:var(--status-danger)">*</span></label>
                    <input type="number" id="modalPrice" class="settings-input" placeholder="0.00" min="0" step="0.01" />
                </div>
                <div class="settings-group" style="margin:0;">
                    <label>Stock Quantity <span style="color:var(--status-danger)">*</span></label>
                    <input type="number" id="modalStock" class="settings-input" placeholder="0" min="0" step="1" />
                </div>
                <div class="settings-group" style="grid-column:1/-1;margin:0;">
                    <label>Supplier Name</label>
                    <input type="text" id="modalSupplier" class="settings-input" placeholder="e.g. Sony Direct" />
                </div>
            </div>
            <p id="modalError" style="color:var(--status-danger);font-size:0.85rem;margin:0;display:none;padding:0.5rem 0.75rem;background:rgba(239,68,68,0.1);border-radius:8px;"></p>
            <div style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:0.5rem;">
                <button id="cancelAddModal" class="secondary-btn" style="padding:0.6rem 1.25rem;">Cancel</button>
                <button id="confirmAddModal" class="primary-btn" style="padding:0.6rem 1.5rem;"><i class="fa-solid fa-plus"></i> Add Product</button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    const closeModal = () => { modal.style.opacity = '0'; setTimeout(() => modal.remove(), 200); };
    document.getElementById('closeAddModal').addEventListener('click', closeModal);
    document.getElementById('cancelAddModal').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    document.getElementById('modalCategory').addEventListener('change', function() {
        if (this.value === '_new_') {
            const newCat = (window.prompt('Enter new category name:') || '').trim();
            if (newCat) {
                const opt = new Option(newCat, newCat);
                this.insertBefore(opt, this.lastElementChild);
                this.value = newCat;
            } else {
                this.value = categories[0] || 'Electronics';
            }
        }
    });

    document.getElementById('confirmAddModal').addEventListener('click', async () => {
        const sku      = document.getElementById('modalSku').value.trim();
        const name     = document.getElementById('modalName').value.trim();
        const category = document.getElementById('modalCategory').value;
        const price    = parseFloat(document.getElementById('modalPrice').value) || 0;
        const stockVal = parseInt(document.getElementById('modalStock').value)   || 0;
        const supplier = document.getElementById('modalSupplier').value.trim();
        const errEl    = document.getElementById('modalError');

        if (!sku || !name || !category || category === '_new_') {
            errEl.textContent = 'SKU, Product Name, and Category are required fields.';
            errEl.style.display = 'block'; return;
        }
        if (price < 0 || stockVal < 0) {
            errEl.textContent = 'Price and Stock must be non-negative numbers.';
            errEl.style.display = 'block'; return;
        }
        errEl.style.display = 'none';

        const status = stockVal === 0 ? 'Out of Stock' : stockVal < 10 ? 'Low Stock' : 'In Stock';
        const confirmBtn = document.getElementById('confirmAddModal');
        confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
        confirmBtn.disabled = true;

        try {
            const token = localStorage.getItem('stockSense_jwt');
            const res = await fetch('/api/inventory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ sku, name, category, price, stock: stockVal, supplier, status })
            });
            const data = await res.json();
            if (data.status === 'success') {
                closeModal();
                addNotification('Product Added', `"${name}" (${sku}) added successfully.`, 'success');
                loadInventoryData();
            } else {
                errEl.textContent = data.message || 'Failed to add item.';
                errEl.style.display = 'block';
            }
        } catch (e) {
            errEl.textContent = 'Network error. Is the server running?';
            errEl.style.display = 'block';
        } finally {
            confirmBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Product';
            confirmBtn.disabled = false;
        }
    });
}

// ==========================================
// Dynamic Category Filter Population
// ==========================================
function populateCategoryFilter(data) {
    const select = document.getElementById('filterCategory');
    if (!select) return;
    const categories = [...new Set(data.map(i => i.category))].filter(Boolean).sort();
    select.innerHTML = '<option value="all">All Categories</option>'
        + categories.map(c => `<option value="${c}">${c}</option>`).join('');
}

function initInventoryActions() {

    const filterBtn = document.getElementById('inventoryFilterBtn');
    const downloadBtn = document.getElementById('inventoryDownloadBtn');
    const dropdown = document.getElementById('inventoryFilterDropdown');
    const applyBtn = document.getElementById('applyFilters');
    const resetBtn = document.getElementById('resetFilters');
    const addBtn = document.getElementById('inventoryAddBtn');

    if (addBtn) {
        addBtn.addEventListener('click', () => showModalAddItem());
    }

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
    
    // Load existing history
    loadChatHistory();
}

async function loadChatHistory() {
    const token = localStorage.getItem('stockSense_jwt');
    if (!token) return;
    try {
        const res = await fetch('/api/chat/history', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.status === 'success' && data.history) {
            chatHistory = data.history;
            const chatMessages = document.getElementById('chatMessages');
            // Keep the first default message if any, then append
            chatHistory.forEach(msg => {
                const div = document.createElement('div');
                div.className = `message ${msg.role}`;
                div.innerHTML = `<div class="msg-bubble">${msg.content}</div>`;
                chatMessages.appendChild(div);
            });
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    } catch (e) {
        console.error("Failed to load chat history", e);
    }
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
        const token = localStorage.getItem('stockSense_jwt');
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
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
        
        // Filter drivers if on dashboard
        const driverItems = document.querySelectorAll('.driver-item');
        driverItems.forEach(item => {
            const name = item.querySelector('.driver-name').textContent.toLowerCase();
            const impact = item.querySelector('.driver-impact').textContent.toLowerCase();
            
            if (name.includes(query) || impact.includes(query)) {
                item.style.display = 'block';
            } else {
                item.style.display = 'none';
            }
        });
        
        // Filter global inventory
        if (typeof fullInventoryData !== 'undefined' && fullInventoryData.length > 0) {
            const filteredInventory = fullInventoryData.filter(item => {
                return (item.name && item.name.toLowerCase().includes(query)) ||
                       (item.sku && item.sku.toLowerCase().includes(query)) ||
                       (item.category && item.category.toLowerCase().includes(query)) ||
                       (item.supplier && item.supplier.toLowerCase().includes(query));
            });
            renderInventoryTable(filteredInventory);
        }
        
        // Seamlessly switch to Inventory Database if searching
        if (query.length > 0 && typeof currentView !== 'undefined' && currentView === 'dashboard') {
            const navInventory = document.getElementById('navInventory');
            if (navInventory) {
                navInventory.click();
                searchInput.focus(); // Re-focus after view switch
            }
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
            const token = localStorage.getItem('stockSense_jwt');
            const strategy = localStorage.getItem('stockSense_cfgStrategy') || 'balanced';
            const dl = localStorage.getItem('stockSense_cfgDL') !== 'false';
            
            const response = await fetch(`/api/predict?strategy=${strategy}&deep_learning=${dl}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
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

async function fetchDefaultInsight() {
    try {
        const token = localStorage.getItem('stockSense_jwt');
        const strategy = localStorage.getItem('stockSense_cfgStrategy') || 'balanced';
        const dl = localStorage.getItem('stockSense_cfgDL') !== 'false';
        const stockout = localStorage.getItem('stockSense_cfgStockout') !== 'false';

        const response = await fetch(`/api/insight?strategy=${strategy}&deep_learning=${dl}&stockout_alerts=${stockout}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
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
    const toggleAuthBtn = document.getElementById('toggleAuthBtn');
    const authIndustryGroup = document.getElementById('authIndustryGroup');
    
    let isSignup = false;
    
    if (toggleAuthBtn) {
        toggleAuthBtn.addEventListener('click', () => {
            isSignup = !isSignup;
            if (isSignup) {
                authIndustryGroup.style.display = 'block';
                loginBtn.innerHTML = 'Create Account <i class="fa-solid fa-user-plus"></i>';
                toggleAuthBtn.innerHTML = 'Already have an account? Log In';
            } else {
                authIndustryGroup.style.display = 'none';
                loginBtn.innerHTML = 'Access Dashboard <i class="fa-solid fa-arrow-right"></i>';
                toggleAuthBtn.innerHTML = 'Need an account? Sign Up';
            }
        });
    }
    
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const orgName = document.getElementById('authStoreName').value.trim();
            const password = document.getElementById('authPassword').value.trim();
            const industry = document.getElementById('authIndustry').value;
            
            if (!orgName || !password) {
                showToast('Please enter both Organization Name and Password', 'warning');
                return;
            }

            const originalText = loginBtn.innerHTML;
            loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...';
            loginBtn.disabled = true;

            try {
                const endpoint = isSignup ? '/api/user/signup' : '/api/user/login';
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        org_name: orgName,
                        industry: isSignup ? industry : "N/A",
                        password: password,
                        avatar_url: ""
                    })
                });
                
                const data = await response.json();
                
                if (data.status !== 'success') {
                    showToast(data.message || 'Authentication failed.', 'error');
                    return;
                }
                
                let finalIndustry = industry;
                let finalAvatar = '';
                
                if (!isSignup && data.data) {
                    finalIndustry = data.data.industry;
                    finalAvatar = data.data.avatar_url;
                }

                // Update LocalStorage Session
                localStorage.setItem('stockSense_storeName', orgName);
                localStorage.setItem('stockSense_industry', finalIndustry);
                localStorage.setItem('stockSense_avatarUrl', finalAvatar);
                if (data.token) localStorage.setItem('stockSense_jwt', data.token);
                
                // Update settings inputs
                const storeNameInput = document.getElementById('settingStoreName');
                const industryInput = document.getElementById('settingIndustry');
                const avatarInput = document.getElementById('settingAvatarUrl');
                if (storeNameInput) storeNameInput.value = orgName;
                if (industryInput) industryInput.value = finalIndustry;
                if (avatarInput) avatarInput.value = finalAvatar;
                
                checkAuth(); // Proceed to dashboard
                addNotification(isSignup ? 'Account Created' : 'Login Successful', `Welcome to StockSense AI, ${orgName}!`, 'success');
            } catch (error) {
                console.error("Auth Error:", error);
                showToast('Connection failed. Is the server running?', 'error');
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
    
    const strategyInput = document.getElementById('settingStrategy');
    const dlInput = document.getElementById('settingDeepLearning');
    const stockoutInput = document.getElementById('settingStockoutAlerts');

    if (storeNameInput && savedName) storeNameInput.value = savedName;
    if (industryInput && savedRole) industryInput.value = savedRole;
    if (avatarInput) avatarInput.value = savedAvatar;

    if (strategyInput) strategyInput.value = localStorage.getItem('stockSense_cfgStrategy') || 'balanced';
    if (dlInput) dlInput.checked = localStorage.getItem('stockSense_cfgDL') !== 'false'; // default true
    if (stockoutInput) stockoutInput.checked = localStorage.getItem('stockSense_cfgStockout') !== 'false';
    
    // PDF Generation Logic
    const generatePdfBtn = document.getElementById('generatePdfBtn');
    if (generatePdfBtn) {
        generatePdfBtn.addEventListener('click', async () => {
            const originalText = generatePdfBtn.innerHTML;
            generatePdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';
            generatePdfBtn.disabled = true;

            try {
                const token = localStorage.getItem('stockSense_jwt');
                const response = await fetch('/api/report', {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.detail || 'Failed to generate report');
                }

                // Convert response to blob and trigger download
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                // Get filename from header if possible, else default
                const contentDisposition = response.headers.get('content-disposition');
                let filename = 'StockSense_Weekly_Report.pdf';
                if (contentDisposition && contentDisposition.includes('filename=')) {
                    filename = contentDisposition.split('filename=')[1].replace(/["']/g, '');
                }
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();
                
                addNotification('Report Generated', 'Your weekly PDF report is downloading.', 'success');
            } catch (error) {
                console.error("PDF Generation Error:", error);
                showToast(error.message || 'Failed to generate PDF report.', 'error');
            } finally {
                generatePdfBtn.innerHTML = originalText;
                generatePdfBtn.disabled = false;
            }
        });
    }

    // 2. Avatar Upload Logic
    const uploadBtn = document.getElementById('uploadAvatarBtn');
    const avatarFileInput = document.getElementById('avatarFileInput');
    
    if (uploadBtn && avatarFileInput) {
        uploadBtn.addEventListener('click', () => avatarFileInput.click());
        
        avatarFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            // Validate file size (2MB)
            if (file.size > 2 * 1024 * 1024) {
                showToast('File is too large. Max 2MB allowed.', 'warning');
                return;
            }
            
            const formData = new FormData();
            formData.append('file', file);
            
            const originalText = uploadBtn.innerHTML;
            uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';
            uploadBtn.disabled = true;
            
            try {
                const token = localStorage.getItem('stockSense_jwt');
                const response = await fetch('/api/user/upload-avatar', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });
                
                const result = await response.json();
                if (result.status === 'success') {
                    // Update hidden input
                    if (avatarInput) avatarInput.value = result.avatar_url;
                    
                    // Immediately update local storage
                    localStorage.setItem('stockSense_avatarUrl', result.avatar_url);
                    
                    // Fetch current name/role for the update
                    const currentName = localStorage.getItem('stockSense_storeName') || 'Store';
                    const currentRole = localStorage.getItem('stockSense_industry') || 'Electronics';
                    
                    // Auto-save the new avatar to the backend database
                    const token = localStorage.getItem('stockSense_jwt');
                    fetch('/api/user/profile', {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({
                            org_name: currentName,
                            industry: currentRole,
                            avatar_url: result.avatar_url
                        })
                    }).catch(err => console.error("Auto-save avatar failed", err));
                    
                    // Immediately update the entire UI (sidebar, settings, etc.)
                    updateUserProfileUI(currentName, currentRole, result.avatar_url);
                    
                    addNotification('Avatar Applied', 'Your new profile picture has been updated and saved successfully.', 'success');
                } else {
                    throw new Error(result.message || 'Upload failed');
                }
            } catch (error) {
                console.error("Upload Error:", error);
                addNotification('Upload Failed', 'Could not upload your logo.', 'warning');
            } finally {
                uploadBtn.innerHTML = originalText;
                uploadBtn.disabled = false;
            }
        });
    }
    
    // 3. Profile Dropdown Toggle
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
                localStorage.removeItem('stockSense_jwt');
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
                const token = localStorage.getItem('stockSense_jwt');
                const response = await fetch('/api/user/profile', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
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
                
                // Update Configs
                if (strategyInput) localStorage.setItem('stockSense_cfgStrategy', strategyInput.value);
                if (dlInput) localStorage.setItem('stockSense_cfgDL', dlInput.checked);
                if (stockoutInput) localStorage.setItem('stockSense_cfgStockout', stockoutInput.checked);
                
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

    // 5. Danger Zone — Purge All Data
    const purgeBtn = document.getElementById('purgeDataBtn');
    if (purgeBtn) {
        purgeBtn.addEventListener('click', async () => {
            const orgName = localStorage.getItem('stockSense_storeName') || 'your organization';
            const confirmed = confirm(
                `⚠️ WARNING: This will permanently delete ALL inventory items and chat history for "${orgName}".\n\nThis action cannot be undone. Are you absolutely sure?`
            );
            if (!confirmed) return;

            const originalText = purgeBtn.innerHTML;
            purgeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Purging...';
            purgeBtn.disabled = true;

            try {
                const token = localStorage.getItem('stockSense_jwt');
                const response = await fetch('/api/user/purge', {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const result = await response.json();
                if (result.status === 'success') {
                    addNotification('Data Purged', result.message, 'warning');
                    // Clear the local inventory table immediately
                    if (typeof fullInventoryData !== 'undefined') fullInventoryData = [];
                    renderInventoryTable([]);
                } else {
                    throw new Error(result.detail || 'Purge failed');
                }
            } catch (error) {
                console.error("Purge Error:", error);
                addNotification('Purge Failed', 'Could not purge data. Check your connection.', 'warning');
            } finally {
                purgeBtn.innerHTML = originalText;
                purgeBtn.disabled = false;
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
    
    // Settings Preview
    const settingsPreview = document.getElementById('settingsAvatarPreview');
    const settingsIcon = document.getElementById('settingsAvatarIcon');
    if (settingsPreview && settingsIcon) {
        if (avatarUrl && avatarUrl.trim() !== '') {
            settingsPreview.style.backgroundImage = `url('${avatarUrl}')`;
            settingsIcon.style.display = 'none';
        } else {
            settingsPreview.style.backgroundImage = `linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))`;
            settingsIcon.style.display = 'block';
        }
    }
    
    // Dropdown Header
    const dropdownName = document.getElementById('dropdownUserName');
    const dropdownRole = document.getElementById('dropdownUserRole');
    if (dropdownName) dropdownName.textContent = name;
    if (dropdownRole) dropdownRole.textContent = role;
    
    // Dropdown Avatar Logic
    const dropdownAvatar = document.getElementById('dropdownAvatar');
    const dropdownAvatarIcon = document.getElementById('dropdownAvatarIcon');
    if (dropdownAvatar && dropdownAvatarIcon) {
        if (avatarUrl && avatarUrl.trim() !== '') {
            dropdownAvatar.style.backgroundImage = `url('${avatarUrl}')`;
            dropdownAvatarIcon.style.display = 'none';
        } else {
            dropdownAvatar.style.backgroundImage = `linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))`;
            dropdownAvatarIcon.style.display = 'block';
        }
    }
    
    // Update main header dashboard text
    const aiInsightTitle = document.querySelector('.insight-section .section-header h2.gradient-text');
    if (aiInsightTitle) {
        aiInsightTitle.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> AI Insight for ${name} — ${role}`;
    }
}
