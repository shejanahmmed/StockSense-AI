/**
 * StockSense AI Frontend Logic
 * Handles dynamic rendering of insights, SHAP drivers, and Chart.js initialization.
 */

let forecastChartInstance = null;

// Chart data cache for filtering
let _chartDataCache = {
    historical: [],
    forecast: []
};
let _chartFilter = {
    range: 'all',     // 'all' | number (days)
    forecastOnly: false
};

document.addEventListener('DOMContentLoaded', () => {
    // 0. Initialize Authentication
    initAuth();

    // 2. Initialize the Forecast Chart
    initChart();
    initChartControls();

    // 3. Setup CSV Upload Listener (also restores cached data if CSV was uploaded before)
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

    // 10. Initialize Footer
    initFooter();

    // 11. Initialize Legal Pages Scroll-Spy (Privacy + Terms of Service)
    initLegalScrollSpy();

    // Initialize Pricing Currency based on saved settings
    updatePricingCurrency();

    // 12. Setup KPI SKU Modal Trigger
    setupKpiSkuTrigger();
    setupKpiTotalUnitsTrigger();
    setupKpiAtRiskTrigger();

    // 10. If no CSV has been uploaded, show a clean empty state
    //     Otherwise, fetchDefaultInsight is skipped — cached data is restored in setupCsvUpload
    if (checkAuth()) {
        const hasUploadedFile = !!localStorage.getItem('stockSense_uploadedFile');
        if (hasUploadedFile) {
            // Data will be restored from localStorage cache inside setupCsvUpload
        } else {
            resetDashboardToEmpty();
        }
    }
});

let fullInventoryData = [];

// ==========================================
// Reset Dashboard to Empty / Fresh State
// ==========================================
function resetDashboardToEmpty() {
    // KPI cards → zeroed out
    const kpiFields = {
        'kpi-stock': '0',
        'kpi-total-units': '0',
        'kpi-demand': '0',
        'kpi-order': '0',
        'kpi-stockout': 'N/A',
    };
    Object.entries(kpiFields).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    });
    const demandChange = document.getElementById('kpi-demand-change');
    if (demandChange) { demandChange.textContent = 'Awaiting data'; demandChange.className = 'trend neutral'; }
    const stockoutSub = document.getElementById('kpi-stockout-sub');
    if (stockoutSub) { stockoutSub.textContent = 'Awaiting data'; stockoutSub.className = 'trend neutral'; }

    // AI Insight panel → placeholder
    const insightContainer = document.getElementById('ai-insight-text');
    if (insightContainer) {
        insightContainer.innerHTML = `
            <p class="animated-text" style="color: var(--text-muted);">
                <i class="fa-solid fa-cloud-arrow-up" style="color: var(--accent-primary); margin-right: 0.5rem;"></i>
                Upload a multi-product sales CSV to generate AI-driven demand forecasts, populate your inventory, and unlock actionable insights.
            </p>`;
    }

    // SHAP drivers → placeholder
    const driversList = document.getElementById('drivers-list');
    if (driversList) {
        driversList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">Upload a CSV to see demand drivers.</p>';
    }

    // BI Metrics → zeroed out
    const biFields = ['metric-daily-sales', 'metric-cash-flow', 'metric-gross-margin',
                      'metric-sell-through', 'metric-inventory-turn', 'metric-revenue'];
    biFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = '—';
            if (el.parentElement && el.parentElement.nextElementSibling) {
                const sub = el.parentElement.nextElementSibling;
                if (sub.classList.contains('trend')) {
                    sub.textContent = 'Awaiting data';
                    sub.className = 'trend neutral';
                }
            }
        }
    });

    // Chart → clear to empty
    if (forecastChartInstance) {
        forecastChartInstance.data.labels = [];
        forecastChartInstance.data.datasets.forEach(ds => ds.data = []);
        forecastChartInstance.update();
    }

    // Top products section → clear
    const topProducts = document.getElementById('topProductsList');
    if (topProducts) {
        topProducts.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">No data yet. Upload a CSV file.</p>';
    }

    // Promotional Suggestions → clear
    const promoContainer = document.getElementById('promo-suggestions-container');
    if (promoContainer) {
        promoContainer.innerHTML = `
            <p class="empty-state" style="color: var(--text-muted); font-size: 0.9rem; padding: 1rem 0; width: 100%;">
                <i class="fa-solid fa-circle-info" style="color: var(--accent-primary); margin-right: 0.5rem;"></i>
                Upload a CSV file to generate smart promotional campaign suggestions.
            </p>`;
    }
}

function formatCurrency(amount) {
    let formattedAmount = Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (formattedAmount.endsWith('.00')) formattedAmount = formattedAmount.slice(0, -3);
    
    return `${getCurrencySymbol()}${formattedAmount}`;
}

function getCurrencySymbol() {
    const currency = localStorage.getItem('stockSense_cfgCurrency') || 'BDT';
    if (currency === 'USD') return '$';
    if (currency === 'CAD') return 'C$';
    if (currency === 'CNY') return '¥';
    return '৳';
}

function updatePricingCurrency() {
    const region = localStorage.getItem('stockSense_cfgRegion') || 'BD';
    let symbol = '৳';
    let attr = 'bdt';

    if (region === 'US') {
        symbol = '$';
        attr = 'usd';
    } else if (region === 'CA') {
        symbol = 'C$';
        attr = 'cad';
    } else if (region === 'GB') {
        symbol = '£';
        attr = 'gbp';
    } else {
        symbol = '৳';
        attr = 'bdt';
    }

    // Update pricing view symbols
    document.querySelectorAll('#pricingView .currency-symbol').forEach(el => {
        el.textContent = symbol;
    });

    // Update pricing view prices
    document.querySelectorAll('#pricingView .price-value').forEach(el => {
        const val = el.getAttribute(`data-${attr}`);
        if (val) {
            el.textContent = val;
        }
    });
}

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
    const privacyView = document.getElementById('privacyView');
    const termsView  = document.getElementById('termsView');
    const featuresView = document.getElementById('featuresView');
    const howItWorksView = document.getElementById('howItWorksView');
    const pricingView = document.getElementById('pricingView');
    const aboutView = document.getElementById('aboutView');
    const contactView = document.getElementById('contactView');

    let currentView = 'dashboard';

    function hideAll() {
        dashboardView.style.display = 'none';
        inventoryView.style.display = 'none';
        insightsView.style.display = 'none';
        settingsView.style.display = 'none';
        if (privacyView) privacyView.style.display = 'none';
        if (termsView)  termsView.style.display  = 'none';
        if (featuresView) featuresView.style.display = 'none';
        if (howItWorksView) howItWorksView.style.display = 'none';
        if (pricingView) pricingView.style.display = 'none';
        if (aboutView) aboutView.style.display = 'none';
        if (contactView) contactView.style.display = 'none';
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    }

    function switchView(view) {
        if (currentView === view) return;
        currentView = view;
        localStorage.setItem('stockSense_activeView', view);
        hideAll();

        // Close mobile nav drawer if open
        const navMenu = document.querySelector('.nav-menu');
        const mobileToggle = document.getElementById('mobileMenuToggle');
        if (navMenu && navMenu.classList.contains('open')) {
            navMenu.classList.remove('open');
            if (mobileToggle) {
                const icon = mobileToggle.querySelector('i');
                if (icon) icon.className = 'fa-solid fa-bars';
            }
        }

        // Toggle top-bar visibility (hide it on legal and features pages to clean up layout)
        const topBar = document.querySelector('.top-bar');
        if (topBar) {
            topBar.style.display = (view === 'privacy' || view === 'terms' || view === 'features' || view === 'howItWorks' || view === 'pricing' || view === 'about' || view === 'contact') ? 'none' : 'flex';
        }

        if (view === 'dashboard') {
            navDashboard.classList.add('active');
            dashboardView.style.display = 'flex';
        } else if (view === 'inventory') {
            navInventory.classList.add('active');
            inventoryView.style.display = 'flex';
            const tbody = document.getElementById('inventoryTableBody');
            if (tbody.children.length === 0) loadInventoryData();
        } else if (view === 'insights') {
            navInsights.classList.add('active');
            insightsView.style.display = 'flex';
        } else if (view === 'settings') {
            navSettings.classList.add('active');
            settingsView.style.display = 'flex';
        } else if (view === 'privacy') {
            if (privacyView) privacyView.style.display = 'flex';
        } else if (view === 'terms') {
            if (termsView) termsView.style.display = 'flex';
        } else if (view === 'features') {
            if (featuresView) featuresView.style.display = 'flex';
        } else if (view === 'howItWorks') {
            if (howItWorksView) howItWorksView.style.display = 'flex';
        } else if (view === 'pricing') {
            if (pricingView) pricingView.style.display = 'flex';
        } else if (view === 'about') {
            if (aboutView) aboutView.style.display = 'flex';
        } else if (view === 'contact') {
            if (contactView) contactView.style.display = 'flex';
        }

        // Reset scroll position to top of main content immediately on any page/view switch
        const mainContainer = document.querySelector('.main-content');
        if (mainContainer) {
            mainContainer.scrollTop = 0;
            mainContainer.scrollTo({ top: 0, behavior: 'auto' });
            // Re-verify after a layout cycle to catch asynchronous dynamic shifts
            setTimeout(() => {
                mainContainer.scrollTop = 0;
                mainContainer.scrollTo({ top: 0, behavior: 'auto' });
            }, 0);
        }
    }

    // Restore last active view from localStorage
    const savedView = localStorage.getItem('stockSense_activeView') || 'dashboard';
    currentView = null; // reset to null to force switchView execution
    switchView(savedView);

    navDashboard.addEventListener('click', (e) => { e.preventDefault(); switchView('dashboard'); });
    navInventory.addEventListener('click', (e) => { e.preventDefault(); switchView('inventory'); });
    navInsights.addEventListener('click',  (e) => { e.preventDefault(); switchView('insights');  });
    navSettings.addEventListener('click',  (e) => { e.preventDefault(); switchView('settings');  });

    // Wire up Privacy View triggers
    const footerNavPrivacy = document.getElementById('footerNavPrivacy');
    if (footerNavPrivacy) {
        footerNavPrivacy.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('privacy');
        });
    }

    const privacyBackBtn = document.getElementById('privacyBackBtn');
    if (privacyBackBtn) {
        privacyBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('dashboard');
        });
    }

    const privacyToSettingsBtn = document.getElementById('privacyToSettingsBtn');
    if (privacyToSettingsBtn) {
        privacyToSettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('settings');
        });
    }

    // Wire up Terms of Service view triggers
    const footerNavTerms = document.getElementById('footerNavTerms');
    if (footerNavTerms) {
        footerNavTerms.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('terms');
        });
    }

    const termsBackBtn = document.getElementById('termsBackBtn');
    if (termsBackBtn) {
        termsBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('dashboard');
        });
    }

    // Wire up Features View triggers
    const footerNavFeatures = document.getElementById('footerNavFeatures');
    if (footerNavFeatures) {
        footerNavFeatures.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('features');
        });
    }

    const featuresBackBtn = document.getElementById('featuresBackBtn');
    if (featuresBackBtn) {
        featuresBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('dashboard');
        });
    }

    const featuresPromoBtn = document.getElementById('featuresPromoBtn');
    if (featuresPromoBtn) {
        featuresPromoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('dashboard');
            document.getElementById('csvFileInput')?.click();
        });
    }

    // Wire up How It Works view triggers
    const footerNavHowItWorks = document.getElementById('footerNavHowItWorks');
    if (footerNavHowItWorks) {
        footerNavHowItWorks.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('howItWorks');
        });
    }

    const hiwBackBtn = document.getElementById('hiwBackBtn');
    if (hiwBackBtn) {
        hiwBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('dashboard');
        });
    }

    const hiwUploadBtn = document.getElementById('hiwUploadBtn');
    if (hiwUploadBtn) {
        hiwUploadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('dashboard');
            document.getElementById('csvFileInput')?.click();
        });
    }

    // Wire up Pricing View triggers
    const footerNavPricing = document.getElementById('footerNavPricing');
    if (footerNavPricing) {
        footerNavPricing.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('pricing');
        });
    }

    const pricingBackBtn = document.getElementById('pricingBackBtn');
    if (pricingBackBtn) {
        pricingBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('dashboard');
        });
    }

    // Wire up About Us View triggers
    const footerNavAbout = document.getElementById('footerNavAbout');
    if (footerNavAbout) {
        footerNavAbout.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('about');
        });
    }

    const aboutBackBtn = document.getElementById('aboutBackBtn');
    if (aboutBackBtn) {
        aboutBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('dashboard');
        });
    }

    // Wire up Contact View triggers
    const footerNavContact = document.getElementById('footerNavContact');
    if (footerNavContact) {
        footerNavContact.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('contact');
        });
    }

    const contactBackBtn = document.getElementById('contactBackBtn');
    if (contactBackBtn) {
        contactBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('dashboard');
        });
    }

    // Contact Form Submission logic
    const contactForm = document.getElementById('contactForm');
    const contactSuccessAlert = document.getElementById('contactSuccessAlert');
    const contactSubmitBtn = document.getElementById('contactSubmitBtn');

    if (contactForm) {
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            if (contactSubmitBtn) {
                contactSubmitBtn.disabled = true;
                contactSubmitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
            }

            // Simulate form submission delay
            setTimeout(() => {
                // Clear the form
                contactForm.reset();

                // Show success alert
                if (contactSuccessAlert) {
                    contactSuccessAlert.style.display = 'flex';
                    contactSuccessAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }

                // Restore button state
                if (contactSubmitBtn) {
                    contactSubmitBtn.disabled = false;
                    contactSubmitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Message';
                }

                // Trigger in-app notification if showNotification exists, otherwise append to local system notifications dropdown
                if (typeof showNotification === 'function') {
                    showNotification('Inquiry sent! Our team will contact you shortly.', 'success');
                } else {
                    const notificationList = document.getElementById('notificationList');
                    const notificationDot = document.getElementById('notificationDot');
                    if (notificationList) {
                        const newNotif = document.createElement('div');
                        newNotif.className = 'notification-item success';
                        newNotif.innerHTML = `
                            <div class="notif-icon"><i class="fa-solid fa-circle-check"></i></div>
                            <div class="notif-content">
                                <h5>Support Inquiry Logged</h5>
                                <p>Message from contact form sent successfully.</p>
                            </div>
                        `;
                        const emptyState = notificationList.querySelector('.empty-state');
                        if (emptyState) emptyState.remove();
                        notificationList.insertBefore(newNotif, notificationList.firstChild);
                        if (notificationDot) notificationDot.style.display = 'block';
                    }
                }
                
                // Hide alert after 8 seconds
                setTimeout(() => {
                    if (contactSuccessAlert) {
                        contactSuccessAlert.style.display = 'none';
                    }
                }, 8000);

            }, 1000);
        });
    }

    // Wire up Demo View triggers
    const footerNavDemo = document.getElementById('footerNavDemo');
    if (footerNavDemo) {
        footerNavDemo.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('dashboard');
        });
    }

    // Auto-hide Top Navbar on scroll
    const mainContent = document.querySelector('.main-content');
    const topNavbar = document.querySelector('.top-navbar');
    let lastScrollTop = 0;
    if (mainContent && topNavbar) {
        mainContent.addEventListener('scroll', () => {
            let scrollTop = mainContent.scrollTop;
            if (scrollTop > lastScrollTop && scrollTop > 70) {
                topNavbar.classList.add('navbar-hidden');
            } else {
                topNavbar.classList.remove('navbar-hidden');
            }
            lastScrollTop = scrollTop;
        });
    }

    // Mobile Hamburger Menu Setup
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const navMenu = document.querySelector('.nav-menu');
    if (mobileMenuToggle && navMenu) {
        mobileMenuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            navMenu.classList.toggle('open');
            const icon = mobileMenuToggle.querySelector('i');
            if (navMenu.classList.contains('open')) {
                icon.className = 'fa-solid fa-xmark';
            } else {
                icon.className = 'fa-solid fa-bars';
            }
        });
        
        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (navMenu.classList.contains('open') && !navMenu.contains(e.target) && e.target !== mobileMenuToggle && !mobileMenuToggle.contains(e.target)) {
                navMenu.classList.remove('open');
                const icon = mobileMenuToggle.querySelector('i');
                if (icon) icon.className = 'fa-solid fa-bars';
            }
        });
    }
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
        
        const forecastDemand = item.forecasted_demand !== undefined ? item.forecasted_demand : '—';
        const reorderPt = item.reorder_point !== undefined ? item.reorder_point : '—';
        const leadDays = item.supplier_lead_days !== undefined ? item.supplier_lead_days : '—';
        const price = (item.price && item.price > 0) ? formatCurrency(item.price) : '—';

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
            <td style="font-weight: 500;">${price}</td>
            <td>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-weight: 600; font-size: 1.05rem;">${item.stock}</span>
                    <span style="color: var(--text-muted); font-size: 0.8rem;">units</span>
                </div>
            </td>
            <td style="color: var(--text-secondary);">${reorderPt}</td>
            <td style="color: var(--text-secondary);">${leadDays}d</td>
            <td style="color: var(--accent-primary); font-weight: 600;">${forecastDemand !== '—' ? forecastDemand + ' units' : '—'}</td>
            <td><span class="status-pill ${statusClass}">${item.status}</span></td>
            <td style="text-align: right;">
                <button class="icon-btn action-delete" data-sku="${item.sku}" title="Delete SKU ${item.sku}" style="color: var(--status-danger); width: 32px; height: 32px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2);">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
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
        : '<option value="Electronics">Electronics</option><option value="Apparel">Apparel</option><option value="Footwear">Footwear</option><option value="Accessories">Accessories</option>';

    const hasCSV     = !!localStorage.getItem('stockSense_uploadedFile');
    const csvName    = localStorage.getItem('stockSense_uploadedFile') || '';
    const csvBanner  = hasCSV
        ? `<div style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.65rem 0.85rem;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.18);border-radius:10px;">
               <i class="fa-solid fa-circle-info" style="color:var(--accent-primary);margin-top:0.1rem;flex-shrink:0;font-size:0.85rem;"></i>
               <span style="font-size:0.8rem;color:var(--text-secondary);">Sales history data you enter below will be appended to <strong style="color:var(--text-primary);">${csvName}</strong> so the AI can forecast demand for this product on the next run.</span>
           </div>`
        : `<div style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.65rem 0.85rem;background:rgba(251,191,36,0.07);border:1px solid rgba(251,191,36,0.2);border-radius:10px;">
               <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;margin-top:0.1rem;flex-shrink:0;font-size:0.85rem;"></i>
               <span style="font-size:0.8rem;color:var(--text-secondary);">No CSV uploaded yet. The product will be saved to inventory, but <strong>AI forecasting</strong> won't be available until you upload a CSV file.</span>
           </div>`;

    const modal = document.createElement('div');
    modal.id = 'addItemModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);backdrop-filter:blur(10px);';

    modal.innerHTML = `
        <div class="glass-panel" style="width:660px;max-width:96vw;max-height:92vh;overflow-y:auto;padding:2rem;display:flex;flex-direction:column;gap:1.5rem;box-shadow:0 30px 80px rgba(0,0,0,0.6);">

            <!-- ── Header ─────────────────────────────────────── -->
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div>
                    <h3 style="margin:0;font-size:1.2rem;display:flex;align-items:center;gap:0.5rem;">
                        <i class="fa-solid fa-box-open" style="color:var(--accent-primary);"></i> Add New Product
                    </h3>
                    <p style="margin:0.2rem 0 0;font-size:0.78rem;color:var(--text-muted);">Fill in product details and sales history to enable AI demand forecasting.</p>
                </div>
                <button id="closeAddModal" style="background:none;border:none;color:var(--text-muted);font-size:1.25rem;cursor:pointer;line-height:1;padding:0.2rem;"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <!-- ── Section 1: Product & Inventory Details ─────── -->
            <div style="display:flex;flex-direction:column;gap:0.9rem;">
                <div style="display:flex;align-items:center;gap:0.5rem;padding-bottom:0.45rem;border-bottom:1px solid rgba(255,255,255,0.07);">
                    <i class="fa-solid fa-warehouse" style="color:var(--accent-primary);font-size:0.8rem;"></i>
                    <span style="font-size:0.75rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:var(--text-secondary);">Product &amp; Inventory Details</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                    <div class="settings-group" style="margin:0;">
                        <label>Product ID / SKU <span style="color:var(--status-danger)">*</span></label>
                        <input type="text" id="modalSku" class="settings-input" placeholder="e.g. SKU-005" />
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
                        <input type="text" id="modalName" class="settings-input" placeholder="e.g. Sony WH-1000XM5 Headphones" />
                    </div>
                    <div class="settings-group" style="margin:0;">
                        <label>Unit Price (${getCurrencySymbol()}) <span style="color:var(--status-danger)">*</span></label>
                        <input type="number" id="modalPrice" class="settings-input" placeholder="0.00" min="0" step="0.01" />
                    </div>
                    <div class="settings-group" style="margin:0;">
                        <label>Stock on Hand <span style="color:var(--status-danger)">*</span></label>
                        <input type="number" id="modalStock" class="settings-input" placeholder="Current units in stock" min="0" step="1" />
                    </div>
                    <div class="settings-group" style="margin:0;">
                        <label>Reorder Point <span style="color:var(--status-danger)">*</span>
                            <span style="color:var(--text-muted);font-size:0.72rem;font-weight:400;"> — trigger restocking below this</span>
                        </label>
                        <input type="number" id="modalReorder" class="settings-input" placeholder="e.g. 50" min="0" step="1" value="50" />
                    </div>
                    <div class="settings-group" style="margin:0;">
                        <label>Supplier Lead Days <span style="color:var(--status-danger)">*</span>
                            <span style="color:var(--text-muted);font-size:0.72rem;font-weight:400;"> — days to receive stock</span>
                        </label>
                        <input type="number" id="modalLeadDays" class="settings-input" placeholder="e.g. 7" min="1" step="1" value="7" />
                    </div>
                    <div class="settings-group" style="grid-column:1/-1;margin:0;">
                        <label>Supplier Name <span style="color:var(--text-muted);font-size:0.72rem;font-weight:400;">(optional)</span></label>
                        <input type="text" id="modalSupplier" class="settings-input" placeholder="e.g. Sony Direct, Alibaba" />
                    </div>
                </div>
            </div>

            <!-- ── Section 2: CSV / Sales History ─────────────── -->
            <div style="display:flex;flex-direction:column;gap:0.9rem;">
                <div style="display:flex;align-items:center;gap:0.5rem;padding-bottom:0.45rem;border-bottom:1px solid rgba(255,255,255,0.07);">
                    <i class="fa-solid fa-file-csv" style="color:var(--status-success);font-size:0.8rem;"></i>
                    <span style="font-size:0.75rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:var(--text-secondary);">Sales History for CSV &amp; AI Forecasting</span>
                </div>
                ${csvBanner}
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                    <div class="settings-group" style="margin:0;">
                        <label>Avg Daily Sales Qty <span style="color:var(--status-danger)">*</span>
                            <span style="color:var(--text-muted);font-size:0.72rem;font-weight:400;"> — units sold per day</span>
                        </label>
                        <input type="number" id="modalAvgSales" class="settings-input" placeholder="e.g. 25" min="0" step="1" ${!hasCSV ? 'disabled' : ''} style="${!hasCSV ? 'opacity:0.45;' : ''}" />
                    </div>
                    <div class="settings-group" style="margin:0;">
                        <label>Days of History to Generate</label>
                        <select id="modalHistoryDays" class="settings-input" ${!hasCSV ? 'disabled' : ''} style="${!hasCSV ? 'opacity:0.45;' : ''}">
                            <option value="7">7 days</option>
                            <option value="14" selected>14 days</option>
                            <option value="30">30 days</option>
                            <option value="60">60 days</option>
                        </select>
                    </div>
                    <div class="settings-group" style="margin:0;">
                        <label>Promotional Sales Period?</label>
                        <label style="display:flex;align-items:center;gap:0.6rem;cursor:${hasCSV ? 'pointer' : 'not-allowed'};padding:0.6rem 0.8rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;margin-top:0.25rem;">
                            <input type="checkbox" id="modalPromo" style="width:15px;height:15px;accent-color:var(--accent-primary);" ${!hasCSV ? 'disabled' : ''} />
                            <span style="font-size:0.85rem;color:var(--text-secondary);">Mark as promotional period</span>
                        </label>
                    </div>
                </div>
            </div>

            <!-- ── Error Message ───────────────────────────────── -->
            <p id="modalError" style="color:var(--status-danger);font-size:0.84rem;margin:0;display:none;padding:0.5rem 0.8rem;background:rgba(239,68,68,0.09);border:1px solid rgba(239,68,68,0.2);border-radius:8px;"></p>

            <!-- ── Actions ─────────────────────────────────────── -->
            <div style="display:flex;gap:0.75rem;justify-content:flex-end;padding-top:0.25rem;border-top:1px solid rgba(255,255,255,0.06);">
                <button id="cancelAddModal" class="secondary-btn" style="padding:0.6rem 1.25rem;">Cancel</button>
                <button id="confirmAddModal" class="primary-btn" style="padding:0.6rem 1.6rem;gap:0.5rem;">
                    <i class="fa-solid fa-plus"></i> Add Product
                </button>
            </div>
        </div>`;

    document.body.appendChild(modal);

    const closeModal = () => {
        modal.style.opacity = '0';
        modal.style.transition = 'opacity 0.18s ease';
        setTimeout(() => modal.remove(), 200);
    };

    document.getElementById('closeAddModal').addEventListener('click', closeModal);
    document.getElementById('cancelAddModal').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    document.getElementById('modalCategory').addEventListener('change', function () {
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
        const sku        = document.getElementById('modalSku').value.trim();
        const name       = document.getElementById('modalName').value.trim();
        const category   = document.getElementById('modalCategory').value;
        const price      = parseFloat(document.getElementById('modalPrice').value) || 0;
        const stockVal   = parseInt(document.getElementById('modalStock').value)   || 0;
        const reorderPt  = parseInt(document.getElementById('modalReorder').value) || 50;
        const leadDays   = parseInt(document.getElementById('modalLeadDays').value) || 7;
        const supplier   = document.getElementById('modalSupplier').value.trim();
        const avgSales   = parseInt(document.getElementById('modalAvgSales').value)  || 0;
        const histDays   = parseInt(document.getElementById('modalHistoryDays').value) || 14;
        const promo      = document.getElementById('modalPromo').checked ? 1 : 0;
        const errEl      = document.getElementById('modalError');

        // ── Validation ────────────────────────────────────────────────────────
        if (!sku || !name || !category || category === '_new_') {
            errEl.textContent = 'Product ID, Product Name, and Category are required.';
            errEl.style.display = 'block'; return;
        }
        if (price < 0 || stockVal < 0 || reorderPt < 0) {
            errEl.textContent = 'Price, Stock, and Reorder Point must be non-negative numbers.';
            errEl.style.display = 'block'; return;
        }
        if (leadDays < 1) {
            errEl.textContent = 'Supplier Lead Days must be at least 1.';
            errEl.style.display = 'block'; return;
        }
        if (hasCSV && avgSales <= 0) {
            errEl.textContent = 'Average Daily Sales Qty is required to update the CSV for AI forecasting.';
            errEl.style.display = 'block'; return;
        }
        errEl.style.display = 'none';

        const confirmBtn = document.getElementById('confirmAddModal');
        confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
        confirmBtn.disabled = true;

        try {
            const token = localStorage.getItem('stockSense_jwt');
            const res = await fetch('/api/inventory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    sku, name, category, price,
                    stock:               stockVal,
                    reorder_point:       reorderPt,
                    supplier_lead_days:  leadDays,
                    supplier,
                    avg_daily_sales:     avgSales,
                    history_days:        histDays,
                    promo,
                    region: localStorage.getItem('stockSense_cfgRegion') || 'BD',
                })
            });
            const data = await res.json();
            if (data.status === 'success') {
                closeModal();
                const notifMsg = data.csv_updated
                    ? `"${name}" added. ${data.csv_rows_added} CSV rows written — re-run forecast to include this product.`
                    : `"${name}" (${sku}) added to inventory.`;
                addNotification('Product Added', notifMsg, 'success');
                loadInventoryData();
            } else {
                errEl.textContent = data.message || 'Failed to add product.';
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
    const fileIndicator = document.getElementById('uploadedFileIndicator');
    const fileNameDisplay = document.getElementById('uploadedFileName');
    const clearFileBtn = document.getElementById('clearUploadedFileBtn');
    
    // Restore uploaded file indicator and all dashboard data from localStorage
    const savedFileName = localStorage.getItem('stockSense_uploadedFile');
    if (savedFileName && fileIndicator && fileNameDisplay) {
        fileNameDisplay.textContent = savedFileName;
        fileIndicator.style.display = 'flex';

        // Restore cached dashboard data so refresh doesn't wipe the analysis
        try {
            const cachedData = JSON.parse(localStorage.getItem('stockSense_lastResult') || 'null');
            if (cachedData) {
                if (cachedData.historical && cachedData.forecast) {
                    updateChartWithData(cachedData.historical, cachedData.forecast);
                }
                if (cachedData.insight) renderInsight(cachedData.insight);
                if (cachedData.drivers) renderDrivers(cachedData.drivers);
                if (cachedData.kpis)    updateKPIs(cachedData.kpis);
                if (cachedData.bi_metrics) updateBIMetrics(cachedData.bi_metrics);
                if (cachedData.promo_suggestions) renderPromoSuggestions(cachedData.promo_suggestions);
            }
        } catch (e) {
            console.warn('Could not restore cached dashboard data:', e);
        }
    }

    if (clearFileBtn) {
        clearFileBtn.addEventListener('click', async () => {
            const confirmed = confirm('Remove CSV data? This will clear all inventory and forecast data from the app so it is ready for a fresh upload.');
            if (!confirmed) return;

            // Wipe backend DB (inventory + forecasts) for this org
            try {
                const token = localStorage.getItem('stockSense_jwt');
                await fetch('/api/user/purge', {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } catch (e) {
                console.warn('Backend purge failed, continuing with local clear:', e);
            }

            // Clear all cached frontend state
            localStorage.removeItem('stockSense_uploadedFile');
            localStorage.removeItem('stockSense_lastResult');

            if (fileIndicator) fileIndicator.style.display = 'none';
            if (fileInput) fileInput.value = '';

            // Full page reload — app is now fresh and ready for another upload
            window.location.reload();
        });
    }

    if (!fileInput || !uploadBtn) return;
    
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (fileIndicator) fileIndicator.style.display = 'none';
        
        const originalText = uploadBtn.innerHTML;
        uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analysing Products...';
        uploadBtn.disabled = true;
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            const token = localStorage.getItem('stockSense_jwt');
            const strategy = localStorage.getItem('stockSense_cfgStrategy') || 'balanced';
            const dl = localStorage.getItem('stockSense_cfgDL') !== 'false';
            const region = localStorage.getItem('stockSense_cfgRegion') || 'BD';
            
            const response = await fetch(`/api/predict?strategy=${strategy}&deep_learning=${dl}&region=${region}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const detail  = errData.detail || {};

                // Special case: not enough data in the CSV
                if (detail.error === 'INSUFFICIENT_DATA') {
                    const days    = detail.data_span_days || '?';
                    const errMsg  = detail.message || 'Insufficient data.';
                    addNotification(
                        '⚠ Not Enough Data',
                        `Your CSV covers only ${days} day(s). Upload at least 90 days to enable forecasting.`,
                        'warning'
                    );
                    // Show a prominent blocking banner in the AI Insight panel
                    const insightContainer = document.getElementById('ai-insight-text');
                    if (insightContainer) {
                        insightContainer.innerHTML = `
                            <div style="display:flex;flex-direction:column;gap:1rem;">
                                <div style="display:flex;align-items:flex-start;gap:0.75rem;padding:1rem;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:12px;">
                                    <i class="fa-solid fa-circle-xmark" style="color:var(--status-danger);font-size:1.4rem;flex-shrink:0;margin-top:0.1rem;"></i>
                                    <div>
                                        <strong style="color:var(--status-danger);font-size:1rem;">Forecast Blocked — Insufficient Data</strong>
                                        <p style="margin:0.4rem 0 0;font-size:0.88rem;color:var(--text-secondary);line-height:1.6;">Your CSV covers only <strong>${days} day(s)</strong> of sales history. StockSense AI requires a minimum of <strong>90 days</strong> to produce a reliable forecast.</p>
                                    </div>
                                </div>
                                <table style="width:100%;border-collapse:collapse;font-size:0.84rem;">
                                    <thead>
                                        <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                                            <th style="text-align:left;padding:0.5rem 0.75rem;color:var(--text-muted);font-weight:600;">Historical Data Provided</th>
                                            <th style="text-align:left;padding:0.5rem 0.75rem;color:var(--text-muted);font-weight:600;">Forecast Window Unlocked</th>
                                            <th style="text-align:left;padding:0.5rem 0.75rem;color:var(--text-muted);font-weight:600;">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                                            <td style="padding:0.5rem 0.75rem;color:var(--text-secondary);">90 – 179 days</td>
                                            <td style="padding:0.5rem 0.75rem;color:var(--text-primary);font-weight:500;">7-Day Forecast</td>
                                            <td style="padding:0.5rem 0.75rem;">${days >= 90 ? '<span style="color:var(--status-success);"><i class="fa-solid fa-check"></i> Unlocked</span>' : '<span style="color:var(--status-danger);"><i class="fa-solid fa-lock"></i> Locked</span>'}</td>
                                        </tr>
                                        <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                                            <td style="padding:0.5rem 0.75rem;color:var(--text-secondary);">180 – 359 days</td>
                                            <td style="padding:0.5rem 0.75rem;color:var(--text-primary);font-weight:500;">14-Day Forecast</td>
                                            <td style="padding:0.5rem 0.75rem;">${days >= 180 ? '<span style="color:var(--status-success);"><i class="fa-solid fa-check"></i> Unlocked</span>' : '<span style="color:var(--status-danger);"><i class="fa-solid fa-lock"></i> Locked</span>'}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding:0.5rem 0.75rem;color:var(--text-secondary);">360+ days</td>
                                            <td style="padding:0.5rem 0.75rem;color:var(--text-primary);font-weight:500;">30-Day Forecast</td>
                                            <td style="padding:0.5rem 0.75rem;">${days >= 360 ? '<span style="color:var(--status-success);"><i class="fa-solid fa-check"></i> Unlocked</span>' : '<span style="color:var(--status-danger);"><i class="fa-solid fa-lock"></i> Locked</span>'}</td>
                                        </tr>
                                    </tbody>
                                </table>
                                <p style="font-size:0.8rem;color:var(--text-muted);margin:0;"><i class="fa-solid fa-circle-info" style="color:var(--accent-primary);"></i> Please upload a CSV with at least 90 days of daily sales data to enable AI forecasting.</p>
                            </div>`;
                    }
                    return; // Don't throw — we handled it
                }

                throw new Error(typeof detail === 'string' ? detail : (errData.detail?.message || 'Prediction failed'));
            }
            const data = await response.json();
            
            if (data.status === 'success') {
                if (fileIndicator && fileNameDisplay) {
                    fileNameDisplay.textContent = file.name;
                    fileIndicator.style.display = 'flex';
                    localStorage.setItem('stockSense_uploadedFile', file.name);
                }

                // Update chart title with actual forecast horizon from server
                const chartTitle = document.getElementById('forecastChartTitle');
                if (chartTitle && data.forecast_label) {
                    chartTitle.textContent =
                        `Demand Forecast — ${data.forecast_label} (${data.data_span_days} days of data)`;
                }

                // Update footer CSV status indicator
                updateFooterCsvStatus(file.name);

                // Cache the full result so it survives page refreshes
                localStorage.setItem('stockSense_lastResult', JSON.stringify({
                    historical:  data.historical,
                    forecast:    data.forecast,
                    insight:     data.insight,
                    drivers:     data.drivers,
                    kpis:        data.kpis,
                    bi_metrics:  data.bi_metrics,
                    promo_suggestions: data.promo_suggestions
                }));

                // Update main chart
                updateChartWithData(data.historical, data.forecast);
                
                // Update AI insight panel
                if (data.insight && data.drivers) {
                    renderInsight(data.insight);
                    renderDrivers(data.drivers);
                }

                // Update promotional planner
                if (data.promo_suggestions) {
                    renderPromoSuggestions(data.promo_suggestions);
                }
                
                // Update dashboard KPIs
                if (data.kpis)        updateKPIs(data.kpis);
                if (data.bi_metrics)  updateBIMetrics(data.bi_metrics);

                // Auto-refresh the inventory table from the DB (now populated from CSV)
                loadInventoryData();
                
                const productCount = data.products ? data.products.length : 0;
                const atRisk = data.kpis ? (data.kpis.at_risk_products || 0) : 0;
                
                addNotification(
                    'Multi-Product Forecast Complete',
                    `Successfully analysed ${productCount} SKUs. ${atRisk > 0 ? `⚠ ${atRisk} products need attention.` : 'All products look healthy.'}`,
                    atRisk > 0 ? 'warning' : 'success'
                );

                // If any products are at risk, fire individual alerts
                if (data.products) {
                    data.products
                        .filter(p => p.status === 'Out of Stock')
                        .forEach(p => addNotification(
                            '🚨 Out of Stock',
                            `${p.product_name} (${p.product_id}) has zero inventory.`,
                            'error'
                        ));
                    data.products
                        .filter(p => p.status === 'Low Stock')
                        .slice(0, 3) // Limit to 3 alerts max
                        .forEach(p => addNotification(
                            '⚠ Low Stock Alert',
                            `${p.product_name}: Only ${p.current_stock} units left (reorder at ${p.reorder_point}).`,
                            'warning'
                        ));
                }
            }
        } catch (error) {
            console.error("Upload error:", error);
            addNotification('Upload Failed', error.message || 'Could not process CSV file. Check the column format.', 'error');
        } finally {
            uploadBtn.innerHTML = originalText;
            uploadBtn.disabled = false;
            fileInput.value = '';
        }
    });
}

function updateKPIs(kpis) {
    // Total SKUs (new multi-product field)
    const skuElem = document.getElementById('kpi-stock');
    if (skuElem) {
        if (kpis.total_skus !== undefined) {
            skuElem.innerText = kpis.total_skus.toLocaleString();
        } else {
            skuElem.innerText = '0';
        }
    }

    // Total Units
    const unitsElem = document.getElementById('kpi-total-units');
    if (unitsElem) {
        unitsElem.innerText = (kpis.current_stock || 0).toLocaleString();
    }

    // Forecasted demand
    const demandElem = document.getElementById('kpi-demand');
    if (demandElem) demandElem.innerText = (kpis.forecasted_demand || 0).toLocaleString();
    
    const changeElem = document.getElementById('kpi-demand-change');
    if (changeElem && kpis.percent_change) {
        const isPositive = kpis.percent_change.startsWith('+');
        changeElem.innerHTML = `${isPositive ? '<i class="fa-solid fa-arrow-up"></i>' : '<i class="fa-solid fa-arrow-down"></i>'} ${kpis.percent_change}`;
        changeElem.className = `trend ${isPositive ? 'positive' : 'negative'}`;
    }
    
    // Recommended order or at-risk products
    const orderElem = document.getElementById('kpi-order');
    if (orderElem) {
        orderElem.innerText = kpis.at_risk_products !== undefined
            ? kpis.at_risk_products + ' Items'
            : (kpis.recommended_order || 0).toLocaleString();
    }
    
    // Stockout KPI
    const stockoutElem = document.getElementById('kpi-stockout');
    if (stockoutElem) {
        const atRisk = kpis.at_risk_products || 0;
        stockoutElem.innerText = atRisk > 0 ? `${atRisk} at Risk` : 'Healthy';
    }
    const stockoutSub = document.getElementById('kpi-stockout-sub');
    if (stockoutSub) {
        const atRisk = kpis.at_risk_products || 0;
        if (atRisk === 0) {
            stockoutSub.innerText = "All SKUs Stocked";
            stockoutSub.className = "trend positive";
        } else {
            stockoutSub.innerText = "Reorder Required";
            stockoutSub.className = "trend negative";
            addNotification('Inventory Alert', `${atRisk} products need restocking.`, 'warning');
        }
    }
}

function updateBIMetrics(metrics) {
    if (!metrics) return;
    
    const setElemText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = text;
    };

    setElemText('metric-daily-sales', formatCurrency(metrics.daily_sales));
    // Assuming we want to show forecast too, we can adjust the sub-text.
    const salesCard = document.getElementById('metric-daily-sales');
    if (salesCard && salesCard.parentElement && salesCard.parentElement.nextElementSibling) {
        salesCard.parentElement.nextElementSibling.innerHTML = `vs ${formatCurrency(metrics.daily_forecast)} forecasted`;
    }

    setElemText('metric-cash-flow', `+${formatCurrency(metrics.cash_flow)}`);
    
    setElemText('metric-demand-trend', metrics.demand_trend);
    const trendCard = document.getElementById('metric-demand-trend');
    if (trendCard && trendCard.parentElement && trendCard.parentElement.nextElementSibling) {
        const trendSpan = trendCard.parentElement.nextElementSibling;
        const isRising = metrics.demand_trend === "Rising";
        trendSpan.className = `trend ${isRising ? 'positive' : 'negative'}`;
        trendSpan.innerHTML = `<i class="fa-solid fa-caret-${isRising ? 'up' : 'down'}"></i> ${metrics.demand_trend_pct}`;
    }

    // Show event name + date (in small text) inside the value element
    const eventEl = document.getElementById('metric-event');
    if (eventEl) {
        eventEl.innerHTML = metrics.upcoming_event +
            (metrics.upcoming_event_date
                ? `<span style="display:block;font-size:0.65rem;font-weight:400;color:var(--text-muted);margin-top:0.2rem;letter-spacing:0.02em;">${metrics.upcoming_event_date}</span>`
                : '');
    }
    const eventCard = document.getElementById('metric-event');
    if (eventCard && eventCard.parentElement && eventCard.parentElement.nextElementSibling) {
        eventCard.parentElement.nextElementSibling.innerHTML = metrics.event_impact;
    }

    setElemText('metric-margin', metrics.avg_margin);
    
    // Priority Next Step
    const nextStepEl = document.getElementById('metric-next-step');
    if (nextStepEl) {
        // Find if it mentions a product and bold it if so
        const text = metrics.next_step;
        const bolded = text.replace(/'([^']+)'/g, '<strong>$1</strong>');
        nextStepEl.innerHTML = bolded;
    }
    
    // Timeline
    const timelineEl = document.getElementById('metric-timeline');
    if (timelineEl && metrics.timeline) {
        let html = '';
        metrics.timeline.forEach(item => {
            let colorVar = 'var(--status-success)';
            let badgeHtml = '';
            let textHtml = `<span style="font-size: 0.8rem; color: ${colorVar};">${item.text}</span>`;
            
            if (item.urgency === 'Critical') {
                colorVar = 'var(--status-danger)';
                badgeHtml = `<span class="badge warning-badge" style="background: var(--status-danger-bg); color: var(--status-danger); border-color: rgba(239, 68, 68, 0.3);">Critical</span>`;
                textHtml = `<span style="font-size: 0.8rem; color: ${colorVar};">${item.text}</span>`;
            } else if (item.urgency === 'Plan') {
                colorVar = 'var(--status-warning)';
                badgeHtml = `<span class="badge warning-badge">Plan</span>`;
                textHtml = `<span style="font-size: 0.8rem; color: ${colorVar};">${item.text}</span>`;
            }
            
            html += `
                <li style="display: flex; align-items: center; gap: 1rem; position: relative;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: ${colorVar}; box-shadow: 0 0 10px ${colorVar};"></div>
                    <div style="flex: 1; display: flex; flex-direction: column;">
                        <strong style="color: var(--text-primary);">${item.name} <span style="font-weight: normal; color: var(--text-muted); font-size: 0.85rem;">(${item.stock} left)</span></strong>
                        ${textHtml}
                    </div>
                    ${badgeHtml}
                </li>
            `;
        });
        timelineEl.innerHTML = html || '<p style="color: var(--text-muted);">No timeline alerts.</p>';
    }

    // Top Products
    const topProductsEl = document.getElementById('metric-top-products');
    if (topProductsEl && metrics.top_products) {
        let html = '';
        metrics.top_products.forEach((prod, idx) => {
            let borderColor = 'rgba(255,255,255,0.1)';
            if (idx === 0) borderColor = 'var(--accent-primary)';
            else if (idx === 1) borderColor = 'var(--accent-secondary)';
            
            html += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: rgba(255,255,255,0.02); border-radius: 8px; border-left: 3px solid ${borderColor};">
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <span style="font-weight: bold; color: var(--text-secondary); width: 20px;">${idx + 1}</span>
                        <span style="color: var(--text-primary); font-weight: 500;">${prod.name}</span>
                    </div>
                    <span style="color: var(--status-success); font-weight: 600; font-size: 0.9rem;">${prod.margin}</span>
                </div>
            `;
        });
        topProductsEl.innerHTML = html || '<p style="color: var(--text-muted);">No products found.</p>';
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

    // Cache full data for filtering
    _chartDataCache.historical = historical;
    _chartDataCache.forecast = forecast;

    // Apply current filter state
    _applyChartFilter();
}

/**
 * Internal: build chart arrays from cached data, applying date-range and forecastOnly filters.
 */
function _applyChartFilter() {
    if (!forecastChartInstance) return;

    const historical = _chartDataCache.historical;
    const forecast   = _chartDataCache.forecast;

    // --- Date range filter ---
    let filteredHist = historical;
    if (_chartFilter.range !== 'all' && _chartFilter.range > 0) {
        // Anchor to the LAST date in the dataset (not today).
        // This ensures "Last 1yr" shows 365 days before the data ends,
        // even if the CSV was uploaded months ago.
        const lastHistDate = historical.length > 0
            ? new Date(historical[historical.length - 1].date)
            : new Date();
        const cutoff = new Date(lastHistDate);
        cutoff.setDate(cutoff.getDate() - _chartFilter.range);
        filteredHist = historical.filter(d => new Date(d.date) >= cutoff);
        // Fallback: if filter is too aggressive, show at least the last 30 points
        if (filteredHist.length === 0) filteredHist = historical.slice(-30);
    }

    // --- Process filtered historical ---
    const histDates = filteredHist.map(d => d.date);
    const histSales = filteredHist.map(d => Math.round(d.sales));

    // --- Forecast always included (it's the future) ---
    const foreDates      = forecast.map(d => d.date);
    const predictedSales = forecast.map(d => Math.round(d.predicted_sales));
    const upper          = forecast.map(d => Math.round(d.upper_bound));
    const lower          = forecast.map(d => Math.round(d.lower_bound));

    // --- Forecast-only: hide historical ---
    const showHistorical = !_chartFilter.forecastOnly;

    const labels = showHistorical ? [...histDates, ...foreDates] : [...foreDates];

    const historicalData   = new Array(labels.length).fill(null);
    const forecastData     = new Array(labels.length).fill(null);
    const confidenceUpper  = new Array(labels.length).fill(null);
    const confidenceLower  = new Array(labels.length).fill(null);

    if (showHistorical) {
        // Fill historical portion
        for (let i = 0; i < histDates.length; i++) {
            historicalData[i] = histSales[i];
        }
        // Connect lines at the seam
        const connectIndex = histDates.length - 1;
        if (connectIndex >= 0) {
            forecastData[connectIndex]    = histSales[connectIndex];
            confidenceUpper[connectIndex] = histSales[connectIndex];
            confidenceLower[connectIndex] = histSales[connectIndex];
        }
        // Fill forecast portion
        for (let i = 0; i < foreDates.length; i++) {
            const idx = histDates.length + i;
            forecastData[idx]    = predictedSales[i];
            confidenceUpper[idx] = upper[i];
            confidenceLower[idx] = lower[i];
        }
    } else {
        // Forecast-only mode: fill from index 0
        for (let i = 0; i < foreDates.length; i++) {
            forecastData[i]    = predictedSales[i];
            confidenceUpper[i] = upper[i];
            confidenceLower[i] = lower[i];
        }
    }

    // --- Compute dynamic canvas width based on data density ---
    const PX_PER_POINT  = 22; // px per label — enough to keep x-axis labels readable
    const CHART_HEIGHT  = 300;
    const wrapperWidth  = document.getElementById('chartScrollWrapper')?.clientWidth || 600;
    const totalPoints   = labels.length;
    const dynamicWidth  = Math.max(wrapperWidth, totalPoints * PX_PER_POINT);

    // Size the inner container so the wrapper knows it can scroll
    const chartInner = document.getElementById('chartInner');
    if (chartInner) chartInner.style.width = dynamicWidth + 'px';

    // Show/hide scroll hint
    const scrollHint = document.getElementById('chartScrollHint');
    if (scrollHint) scrollHint.style.display = dynamicWidth > wrapperWidth ? 'block' : 'none';

    // --- Update chart data ---
    forecastChartInstance.data.labels                  = labels;
    forecastChartInstance.data.datasets[0].data        = historicalData;
    forecastChartInstance.data.datasets[1].data        = forecastData;
    forecastChartInstance.data.datasets[2].data        = confidenceUpper;
    forecastChartInstance.data.datasets[3].data        = confidenceLower;
    forecastChartInstance.data.datasets[0].borderColor = showHistorical ? '#64748b' : 'transparent';

    // Resize the canvas BEFORE update() so Chart.js draws into the correct pixel dimensions.
    // This is required when responsive:false — it replaces the auto-resize behavior.
    forecastChartInstance.resize(dynamicWidth, CHART_HEIGHT);
    forecastChartInstance.update('none'); // 'none' = skip animation on filter changes for snappiness
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
        if (response.status === 401) {
            localStorage.removeItem('stockSense_storeName');
            localStorage.removeItem('stockSense_jwt');
            localStorage.removeItem('stockSense_industry');
            localStorage.removeItem('stockSense_avatarUrl');
            window.location.reload();
            return;
        }
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

function renderPromoSuggestions(suggestions) {
    const container = document.getElementById('promo-suggestions-container');
    if (!container) return;
    
    if (!suggestions || suggestions.length === 0) {
        container.innerHTML = `
            <p class="empty-state" style="color: var(--text-muted); font-size: 0.9rem; padding: 1rem 0; width: 100%;">
                <i class="fa-solid fa-circle-info" style="color: var(--accent-primary); margin-right: 0.5rem;"></i>
                No promotional recommendations generated for this timeframe.
            </p>`;
        return;
    }
    
    let html = '';
    suggestions.forEach(promo => {
        const badgeClass = promo.type.toLowerCase();
        let typeIcon = 'fa-tags';
        if (promo.type === 'Holiday') typeIcon = 'fa-calendar-star';
        else if (promo.type === 'Clearance') typeIcon = 'fa-fire-flame-curved';
        else if (promo.type === 'Seasonality') typeIcon = 'fa-chart-line';
        
        // Format dates beautifully
        const startStr = formatDateString(promo.start_date);
        const endStr = formatDateString(promo.end_date);
        
        html += `
            <div class="promo-card ${badgeClass}">
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 0.5rem;">
                    <span class="promo-badge-tag ${badgeClass}">
                        <i class="fa-solid ${typeIcon}"></i> ${promo.type}
                    </span>
                    <span class="badge ${promo.urgency === 'High' ? 'warning-badge' : 'neutral'}" style="${promo.urgency === 'High' ? 'background: var(--status-danger-bg); color: var(--status-danger); border-color: rgba(239, 68, 68, 0.2); margin: 0;' : 'margin: 0;'}">
                        ${promo.urgency} Urgency
                    </span>
                </div>
                
                <h3 style="font-size: 1.1rem; color: var(--text-primary); margin-top: 0.25rem; font-weight: 600; line-height: 1.3;">${promo.title}</h3>
                
                <div class="promo-meta" style="margin-top: -0.25rem;">
                    <span class="promo-dates" style="font-size: 0.75rem;"><i class="fa-regular fa-calendar"></i> ${startStr} - ${endStr}</span>
                    <span class="promo-lift" style="font-size: 0.8rem; font-weight: 700; color: var(--status-success);">${promo.expected_impact}</span>
                </div>
                
                <p class="promo-card-reason" style="margin-top: -0.25rem; font-size: 0.8rem; color: var(--text-secondary); line-height: 1.5; flex-grow: 1;">${promo.reason}</p>
                
                <div class="promo-card-footer" style="margin-top: 0.25rem;">
                    <div class="promo-target-label">
                        <span>Target Item</span>
                        <span title="${promo.target_product}">${promo.target_product}</span>
                    </div>
                    <button class="primary-btn" style="padding: 0 0.75rem; font-size: 0.75rem; height: 32px; border-radius: var(--radius-md); box-shadow: none;" onclick="schedulePromotion('${promo.id}', '${promo.title.replace(/'/g, "\\'")}', '${promo.discount_pct}')">
                        <i class="fa-solid fa-calendar-plus"></i> Schedule
                    </button>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function formatDateString(dateStr) {
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
        return dateStr;
    }
}

function schedulePromotion(promoId, title, discount) {
    addNotification(
        '📅 Promotion Scheduled',
        `Successfully scheduled '${title}' with a ${discount} recommendation.`,
        'success'
    );
}

// Bind to window for global onclick scope
window.schedulePromotion = schedulePromotion;


function initChart() {
    const ctx = document.getElementById('forecastChart').getContext('2d');
    
    // Gradient for the line area
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(139, 92, 246, 0.4)');
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0.0)');

    // Empty initial state
    const labels = [];
    
    const historicalData = [];
    const forecastData = [];
    const confidenceUpper = [];
    const confidenceLower = [];

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
            responsive: false,
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
// Chart Controls: Drag-to-Scroll + Filter Panel
// ==========================================
function initChartControls() {
    const wrapper    = document.getElementById('chartScrollWrapper');
    const filterBtn  = document.getElementById('chartFilterBtn');
    const filterPanel= document.getElementById('chartFilterPanel');
    const resetBtn   = document.getElementById('chartFilterReset');
    const applyBtn   = document.getElementById('chartFilterApply');
    const rangeGroup = document.getElementById('filterRangeGroup');
    const forecastOnlyChk = document.getElementById('filterForecastOnly');
    const badge      = document.getElementById('chartFilterBadge');

    if (!wrapper || !filterBtn) return;

    // --- Click-and-drag to scroll (mouse) ---
    let isDragging  = false;
    let dragStartX  = 0;
    let scrollStart = 0;

    wrapper.addEventListener('mousedown', (e) => {
        // Ignore clicks on the canvas tooltip area — let Chart.js handle those
        isDragging  = true;
        dragStartX  = e.clientX;
        scrollStart = wrapper.scrollLeft;
        wrapper.classList.add('is-dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const delta = e.clientX - dragStartX;
        wrapper.scrollLeft = scrollStart - delta;
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        wrapper.classList.remove('is-dragging');
    });

    // --- Touch drag (mobile/trackpad tap-drag) ---
    let touchStartX  = 0;
    let touchScrollStart = 0;

    wrapper.addEventListener('touchstart', (e) => {
        touchStartX      = e.touches[0].clientX;
        touchScrollStart = wrapper.scrollLeft;
    }, { passive: true });

    wrapper.addEventListener('touchmove', (e) => {
        const delta = e.touches[0].clientX - touchStartX;
        wrapper.scrollLeft = touchScrollStart - delta;
    }, { passive: true });

    // --- Filter panel toggle ---
    filterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = filterPanel.style.display !== 'none';
        filterPanel.style.display = isOpen ? 'none' : 'flex';
        filterBtn.classList.toggle('is-active', !isOpen);
    });

    // Close panel on outside click
    document.addEventListener('click', (e) => {
        if (!document.getElementById('chartFilterWrapper')?.contains(e.target)) {
            filterPanel.style.display = 'none';
            filterBtn.classList.remove('is-active');
        }
    });

    // --- Range pill selection ---
    rangeGroup?.querySelectorAll('.filter-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            rangeGroup.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
        });
    });

    // --- Reset ---
    resetBtn?.addEventListener('click', () => {
        rangeGroup?.querySelectorAll('.filter-pill').forEach(p => {
            p.classList.toggle('active', p.dataset.range === 'all');
        });
        if (forecastOnlyChk) forecastOnlyChk.checked = false;

        _chartFilter.range = 'all';
        _chartFilter.forecastOnly = false;
        _applyChartFilter();

        if (badge) badge.style.display = 'none';
        filterBtn.classList.remove('is-active');
        filterPanel.style.display = 'none';
    });

    // --- Apply ---
    applyBtn?.addEventListener('click', () => {
        const activePill = rangeGroup?.querySelector('.filter-pill.active');
        const rangeVal   = activePill?.dataset.range || 'all';
        _chartFilter.range        = rangeVal === 'all' ? 'all' : parseInt(rangeVal, 10);
        _chartFilter.forecastOnly = forecastOnlyChk?.checked ?? false;

        const isFiltered = _chartFilter.range !== 'all' || _chartFilter.forecastOnly;
        if (badge) badge.style.display = isFiltered ? 'block' : 'none';

        _applyChartFilter();

        filterPanel.style.display = 'none';
        filterBtn.classList.remove('is-active');
    });

    // When the browser window resizes, recalculate chart width
    // (needed since responsive:false disables Chart.js's own resize listener)
    let _resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => {
            if (_chartDataCache.historical.length > 0 || _chartDataCache.forecast.length > 0) {
                _applyChartFilter();
            }
        }, 150);
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
                fetchDefaultInsight(); // Load initial insights
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
    const regionInput = document.getElementById('settingRegion');
    const currencyInput = document.getElementById('settingCurrency');

    if (storeNameInput && savedName) storeNameInput.value = savedName;
    if (industryInput && savedRole) industryInput.value = savedRole;
    if (avatarInput) avatarInput.value = savedAvatar;

    if (strategyInput) strategyInput.value = localStorage.getItem('stockSense_cfgStrategy') || 'balanced';
    if (dlInput) dlInput.checked = localStorage.getItem('stockSense_cfgDL') !== 'false'; // default true
    if (stockoutInput) stockoutInput.checked = localStorage.getItem('stockSense_cfgStockout') !== 'false';
    if (regionInput) regionInput.value = localStorage.getItem('stockSense_cfgRegion') || 'BD';
    if (currencyInput) currencyInput.value = localStorage.getItem('stockSense_cfgCurrency') || 'BDT';
    
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
                if (regionInput) localStorage.setItem('stockSense_cfgRegion', regionInput.value);
                if (currencyInput) localStorage.setItem('stockSense_cfgCurrency', currencyInput.value);
                
                // Update pricing currency based on saved settings
                updatePricingCurrency();
                
                if (typeof currentFilteredData !== 'undefined' && currentFilteredData.length > 0) {
                    renderInventoryTable(currentFilteredData, currentInventoryPage);
                }
                
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
    const DEFAULT_AVATAR = '/default_avatar.png';
    const effectiveAvatar = (avatarUrl && avatarUrl.trim() !== '') ? avatarUrl : DEFAULT_AVATAR;

    // Sidebar
    const sidebarName = document.getElementById('sidebarUserName');
    const sidebarRole = document.getElementById('sidebarUserRole');
    if (sidebarName) sidebarName.textContent = name;
    if (sidebarRole) sidebarRole.textContent = role;

    // Sidebar Avatar
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    const sidebarAvatarIcon = document.getElementById('sidebarAvatarIcon');
    if (sidebarAvatar) {
        sidebarAvatar.style.backgroundImage = `url('${effectiveAvatar}')`;
        sidebarAvatar.style.backgroundSize = 'cover';
        sidebarAvatar.style.backgroundPosition = 'center';
    }
    if (sidebarAvatarIcon) sidebarAvatarIcon.style.display = 'none';

    // Settings Preview
    const settingsPreview = document.getElementById('settingsAvatarPreview');
    const settingsIcon = document.getElementById('settingsAvatarIcon');
    if (settingsPreview) {
        settingsPreview.style.backgroundImage = `url('${effectiveAvatar}')`;
        settingsPreview.style.backgroundSize = 'cover';
        settingsPreview.style.backgroundPosition = 'center';
    }
    if (settingsIcon) settingsIcon.style.display = 'none';

    // Dropdown Header
    const dropdownName = document.getElementById('dropdownUserName');
    const dropdownRole = document.getElementById('dropdownUserRole');
    if (dropdownName) dropdownName.textContent = name;
    if (dropdownRole) dropdownRole.textContent = role;

    // Dropdown Avatar
    const dropdownAvatar = document.getElementById('dropdownAvatar');
    const dropdownAvatarIcon = document.getElementById('dropdownAvatarIcon');
    if (dropdownAvatar) {
        dropdownAvatar.style.backgroundImage = `url('${effectiveAvatar}')`;
        dropdownAvatar.style.backgroundSize = 'cover';
        dropdownAvatar.style.backgroundPosition = 'center';
    }
    if (dropdownAvatarIcon) dropdownAvatarIcon.style.display = 'none';

    // Update main header dashboard text
    const aiInsightTitle = document.querySelector('.insight-section .section-header h2.gradient-text');
    if (aiInsightTitle) {
        aiInsightTitle.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> AI Insight for ${name} — ${role}`;
    }
}

// ==========================================
// Footer
// ==========================================
function initFooter() {
    // Set copyright year dynamically
    const yearEl = document.getElementById('footerYear');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // Wire up footer nav links to trigger the matching top-nav link
    const footerNavMap = {
        'footerNavDashboard': 'navDashboard',
        'footerNavInventory':  'navInventory',
        'footerNavInsights':   'navInsights',
        'footerNavSettings':   'navSettings',
    };
    Object.entries(footerNavMap).forEach(([footerId, navId]) => {
        const footerBtn = document.getElementById(footerId);
        const navBtn    = document.getElementById(navId);
        if (footerBtn && navBtn) {
            footerBtn.addEventListener('click', (e) => {
                e.preventDefault();
                navBtn.click();
            });
        }
    });

    // Set initial CSV status
    updateFooterCsvStatus();
}

function updateFooterCsvStatus(csvFileName = null) {
    const dot   = document.getElementById('footerCsvStatus');
    const label = document.getElementById('footerCsvLabel');
    if (!dot || !label) return;

    const fileName = csvFileName || localStorage.getItem('stockSense_uploadedFile');
    if (fileName) {
        dot.className   = 'status-dot success-dot';
        label.textContent = fileName.length > 22 ? fileName.substring(0, 20) + '…' : fileName;
    } else {
        dot.className   = 'status-dot warning-dot';
        label.textContent = 'No CSV Uploaded';
    }
}

// Table of Contents Scroll-Spy for Privacy Policy and Terms of Service views
function initLegalScrollSpy() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    // Build a combined map: viewId -> { sections, tocLinks }
    const legalPages = [
        {
            viewId: 'privacyView',
            sectionSelector: '.privacy-doc-section',
            tocSelector: '#privacyView .toc-link'
        },
        {
            viewId: 'termsView',
            sectionSelector: '.legal-doc-section',
            tocSelector: '#termsView .toc-link'
        }
    ];

    // Attach smooth-scroll click handlers for every TOC link on both pages
    legalPages.forEach(({ tocSelector }) => {
        const tocLinks = document.querySelectorAll(tocSelector);
        tocLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = link.getAttribute('href');
                const targetSection = document.querySelector(targetId);
                if (targetSection) {
                    const containerScrollTop = mainContent.scrollTop;
                    const sectionTop = targetSection.getBoundingClientRect().top
                                     - mainContent.getBoundingClientRect().top;
                    mainContent.scrollTo({
                        top: containerScrollTop + sectionTop - 20,
                        behavior: 'smooth'
                    });
                    // Highlight clicked link immediately
                    tocLinks.forEach(l => l.classList.remove('active'));
                    link.classList.add('active');
                }
            });
        });
    });

    // Attach a single scroll listener; only the active legal view is processed
    mainContent.addEventListener('scroll', () => {
        legalPages.forEach(({ viewId, sectionSelector, tocSelector }) => {
            const view = document.getElementById(viewId);
            if (!view || view.style.display === 'none') return;

            const sections = document.querySelectorAll(sectionSelector);
            const tocLinks = document.querySelectorAll(tocSelector);
            if (sections.length === 0 || tocLinks.length === 0) return;

            const scrollContainerTop = mainContent.getBoundingClientRect().top;
            let currentSectionId = '';

            sections.forEach(section => {
                const rect = section.getBoundingClientRect();
                if (rect.top - scrollContainerTop <= 150) {
                    currentSectionId = section.getAttribute('id');
                }
            });

            if (currentSectionId) {
                tocLinks.forEach(link => {
                    if (link.getAttribute('href') === `#${currentSectionId}`) {
                        link.classList.add('active');
                    } else {
                        link.classList.remove('active');
                    }
                });
            }
        });
    });
}

// ==========================================
// How It Works — FAQ Accordion
// ==========================================
function toggleFaq(btn) {
    const item = btn.closest('.hiw-faq-item');
    const answer = item.querySelector('.hiw-faq-answer');
    const chevron = btn.querySelector('.hiw-faq-chevron');
    const isOpen = item.classList.contains('hiw-faq-open');

    // Close all other open items
    document.querySelectorAll('.hiw-faq-item.hiw-faq-open').forEach(openItem => {
        if (openItem !== item) {
            openItem.classList.remove('hiw-faq-open');
            openItem.querySelector('.hiw-faq-answer').style.maxHeight = '0';
            openItem.querySelector('.hiw-faq-chevron').style.transform = 'rotate(0deg)';
        }
    });

    if (isOpen) {
        item.classList.remove('hiw-faq-open');
        answer.style.maxHeight = '0';
        chevron.style.transform = 'rotate(0deg)';
    } else {
        item.classList.add('hiw-faq-open');
        answer.style.maxHeight = answer.scrollHeight + 'px';
        chevron.style.transform = 'rotate(180deg)';
    }
}

// ==========================================
// Total SKUs Interactive Dialog
// ==========================================
function setupKpiSkuTrigger() {
    const kpiCard = document.getElementById('kpiSKUsCard');
    if (kpiCard) {
        kpiCard.addEventListener('click', () => {
            showModalSKUList();
        });
    }
}

async function showModalSKUList() {
    // 1. Remove old modal if it exists
    const old = document.getElementById('skuListModal');
    if (old) old.remove();

    // 2. Load latest product/SKU data if available
    let skus = [];
    if (fullInventoryData && fullInventoryData.length > 0) {
        skus = fullInventoryData;
    } else {
        // Fetch on-the-fly from database
        try {
            const token = localStorage.getItem('stockSense_jwt');
            const res = await fetch('/api/inventory', {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });
            if (res.ok) {
                const json = await res.json();
                if (json.status === 'success' && json.data) {
                    fullInventoryData = json.data;
                    skus = json.data;
                }
            }
        } catch (e) {
            console.error("Failed to fetch SKU data on-the-fly:", e);
        }
    }

    // 3. Create modal overlay and container
    const overlay = document.createElement('div');
    overlay.className = 'sku-modal-overlay';
    overlay.id = 'skuListModal';

    // Construct glassmorphic contents
    overlay.innerHTML = `
        <div class="sku-modal-container">
            <div class="sku-modal-header">
                <div>
                    <h3 style="margin:0; font-size:1.3rem; display:flex; align-items:center; gap:0.6rem; color:var(--text-primary);">
                        <i class="fa-solid fa-list-check" style="color:var(--accent-primary);"></i> Unique Products (SKUs)
                    </h3>
                    <p style="margin:0.25rem 0 0; font-size:0.8rem; color:var(--text-secondary);" id="skuModalSub">
                        Tracked total of ${skus.length} active unique products in inventory.
                    </p>
                </div>
                <button class="sku-modal-close" id="closeSkuModal" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            
            <div class="sku-modal-search">
                <i class="fa-solid fa-search"></i>
                <input type="text" id="skuModalSearchInput" placeholder="Search by SKU / Product ID or Name..." autocomplete="off">
            </div>

            <div class="sku-table-wrapper">
                <table class="sku-table">
                    <thead>
                        <tr>
                            <th style="width: 25%;">Product ID / SKU</th>
                            <th style="width: 50%;">Product Details</th>
                            <th style="width: 25%;">Price per Unit</th>
                        </tr>
                    </thead>
                    <tbody id="skuModalTableBody">
                        ${renderSkuModalRows(skus)}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Force reflow and add 'open' class for CSS transition scale-in and fade-in
    setTimeout(() => {
        overlay.classList.add('open');
    }, 10);

    // Focus search input automatically
    const searchInput = document.getElementById('skuModalSearchInput');
    if (searchInput) searchInput.focus();

    // 4. Modal Close Logic
    const closeModal = () => {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 250);
    };

    document.getElementById('closeSkuModal').addEventListener('click', closeModal);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);

    // 5. Search Filtering Logic
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            const filtered = skus.filter(item => {
                return (item.sku && item.sku.toLowerCase().includes(query)) ||
                       (item.name && item.name.toLowerCase().includes(query)) ||
                       (item.category && item.category.toLowerCase().includes(query));
            });
            
            const tbody = document.getElementById('skuModalTableBody');
            if (tbody) {
                tbody.innerHTML = renderSkuModalRows(filtered);
            }

            const sub = document.getElementById('skuModalSub');
            if (sub) {
                if (query.length > 0) {
                    sub.textContent = `Showing ${filtered.length} of ${skus.length} matched products.`;
                } else {
                    sub.textContent = `Tracked total of ${skus.length} active unique products in inventory.`;
                }
            }
        });
    }
}

function renderSkuModalRows(items) {
    if (!items || items.length === 0) {
        return `
            <tr>
                <td colspan="3" style="text-align: center; color: var(--text-muted); padding: 2rem; font-size: 0.9rem;">
                    <i class="fa-solid fa-box-open" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem; color: var(--text-muted);"></i>
                    No matching products found.
                </td>
            </tr>
        `;
    }

    return items.map(item => {
        const price = (item.price && item.price > 0) ? formatCurrency(item.price) : '—';
        return `
            <tr>
                <td>
                    <code style="font-family: monospace; font-size: 0.85rem; color: var(--text-primary); background: rgba(255,255,255,0.06); padding: 3px 7px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.04);">${item.sku}</code>
                </td>
                <td>
                    <div style="display:flex; flex-direction:column; gap:0.15rem;">
                        <span style="font-weight: 500; color: var(--text-primary);">${item.name}</span>
                        <span style="font-size: 0.78rem; color: var(--text-muted);">${item.category || 'N/A'}</span>
                    </div>
                </td>
                <td style="font-weight: 600; color: var(--accent-primary); font-size: 0.95rem;">
                    ${price}
                </td>
            </tr>
        `;
    }).join('');
}


// ==========================================
// Total Units Interactive Dialog
// ==========================================
function setupKpiTotalUnitsTrigger() {
    const kpiCard = document.getElementById('kpiTotalUnitsCard');
    if (kpiCard) {
        kpiCard.addEventListener('click', () => {
            showModalTotalUnitsList();
        });
    }
}

async function showModalTotalUnitsList() {
    // 1. Remove old modal if it exists
    const old = document.getElementById('unitsListModal');
    if (old) old.remove();

    // 2. Load latest product/SKU data if available
    let items = [];
    if (fullInventoryData && fullInventoryData.length > 0) {
        items = fullInventoryData;
    } else {
        // Fetch on-the-fly from database
        try {
            const token = localStorage.getItem('stockSense_jwt');
            const res = await fetch('/api/inventory', {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });
            if (res.ok) {
                const json = await res.json();
                if (json && json.status === 'success' && json.data) {
                    fullInventoryData = json.data;
                    items = json.data;
                }
            }
        } catch (e) {
            console.error("Failed to fetch Inventory data on-the-fly:", e);
        }
    }

    // 3. Create modal overlay and container
    const overlay = document.createElement('div');
    overlay.className = 'sku-modal-overlay';
    overlay.id = 'unitsListModal';

    // Construct glassmorphic contents
    overlay.innerHTML = `
        <div class="sku-modal-container">
            <div class="sku-modal-header">
                <div>
                    <h3 style="margin:0; font-size:1.3rem; display:flex; align-items:center; gap:0.6rem; color:var(--text-primary);">
                        <i class="fa-solid fa-box-open" style="color:var(--accent-primary);"></i> Total Inventory Units
                    </h3>
                    <p style="margin:0.25rem 0 0; font-size:0.8rem; color:var(--text-secondary);" id="unitsModalSub">
                        Breakdown of units sold and stock remaining across all ${items.length} products.
                    </p>
                </div>
                <button class="sku-modal-close" id="closeUnitsModal" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            
            <div class="sku-modal-search">
                <i class="fa-solid fa-search"></i>
                <input type="text" id="unitsModalSearchInput" placeholder="Search by SKU, Name, or Category..." autocomplete="off">
            </div>

            <div class="sku-table-wrapper">
                <table class="sku-table">
                    <thead>
                        <tr>
                            <th style="width: 12%;">SKU / ID</th>
                            <th style="width: 33%;">Product Details</th>
                            <th style="width: 13%; text-align: center;">Total Units</th>
                            <th style="width: 13%; text-align: center;">Units Sold</th>
                            <th style="width: 13%; text-align: center;">Remaining</th>
                            <th style="width: 16%; text-align: center;">Status</th>
                        </tr>
                    </thead>
                    <tbody id="unitsModalTableBody">
                        ${renderUnitsModalRows(items)}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Force reflow and add 'open' class for CSS transition scale-in and fade-in
    setTimeout(() => {
        overlay.classList.add('open');
    }, 10);

    // Focus search input automatically
    const searchInput = document.getElementById('unitsModalSearchInput');
    if (searchInput) searchInput.focus();

    // 4. Modal Close Logic
    const closeModal = () => {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 250);
    };

    document.getElementById('closeUnitsModal').addEventListener('click', closeModal);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);

    // 5. Search Filtering Logic
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            const filtered = items.filter(item => {
                return (item.sku && item.sku.toLowerCase().includes(query)) ||
                       (item.name && item.name.toLowerCase().includes(query)) ||
                       (item.category && item.category.toLowerCase().includes(query));
            });
            
            const tbody = document.getElementById('unitsModalTableBody');
            if (tbody) {
                tbody.innerHTML = renderUnitsModalRows(filtered);
            }

            const sub = document.getElementById('unitsModalSub');
            if (sub) {
                if (query.length > 0) {
                    sub.textContent = `Showing ${filtered.length} of ${items.length} matched products.`;
                } else {
                    sub.textContent = `Breakdown of units sold and stock remaining across all ${items.length} products.`;
                }
            }
        });
    }
}

function renderUnitsModalRows(items) {
    if (!items || items.length === 0) {
        return `
            <tr>
                <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem; font-size: 0.9rem;">
                    <i class="fa-solid fa-box-open" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem; color: var(--text-muted);"></i>
                    No matching products found.
                </td>
            </tr>
        `;
    }

    return items.map(item => {
        const sold = item.units_sold || 0;
        const left = item.stock || 0;
        const total = sold + left;
        const reorderPoint = item.reorder_point || 50;

        // Determine stock status beautifully
        let statusText = 'Healthy';
        let badgeStyle = 'background: rgba(16, 185, 129, 0.15); color: var(--status-success); border: 1px solid rgba(16, 185, 129, 0.25);';
        let remainingColor = 'var(--text-primary)';

        if (left === 0) {
            statusText = 'Out of Stock';
            badgeStyle = 'background: rgba(239, 68, 68, 0.15); color: var(--status-danger); border: 1px solid rgba(239, 68, 68, 0.25);';
            remainingColor = 'var(--status-danger)';
        } else if (left <= reorderPoint) {
            statusText = 'Low Stock';
            badgeStyle = 'background: rgba(245, 158, 11, 0.15); color: var(--status-warning); border: 1px solid rgba(245, 158, 11, 0.25);';
            remainingColor = 'var(--status-warning)';
        } else if (left >= reorderPoint * 3) {
            statusText = 'Overstocked';
            badgeStyle = 'background: rgba(139, 92, 246, 0.15); color: var(--accent-primary); border: 1px solid rgba(139, 92, 246, 0.25);';
            remainingColor = 'var(--accent-primary)';
        }

        const statusBadge = `<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; display: inline-block; ${badgeStyle}">${statusText}</span>`;

        return `
            <tr>
                <td>
                    <code style="font-family: monospace; font-size: 0.85rem; color: var(--text-primary); background: rgba(255,255,255,0.06); padding: 3px 7px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.04);">${item.sku}</code>
                </td>
                <td>
                    <div style="display:flex; flex-direction:column; gap:0.15rem;">
                        <span style="font-weight: 500; color: var(--text-primary);">${item.name}</span>
                        <span style="font-size: 0.78rem; color: var(--text-muted);">${item.category || 'N/A'}</span>
                    </div>
                </td>
                <td style="font-weight: 600; color: var(--text-primary); text-align: center;">
                    ${total.toLocaleString()}
                </td>
                <td style="color: var(--text-secondary); text-align: center;">
                    ${sold.toLocaleString()}
                </td>
                <td style="text-align: center; font-weight: 600; color: ${remainingColor};">
                    ${left.toLocaleString()}
                </td>
                <td style="text-align: center; vertical-align: middle;">
                    ${statusBadge}
                </td>
            </tr>
        `;
    }).join('');
}


// ==========================================
// At-Risk Products Interactive Dialog
// ==========================================
function setupKpiAtRiskTrigger() {
    const kpiCard = document.getElementById('kpiAtRiskCard');
    if (kpiCard) {
        kpiCard.addEventListener('click', () => {
            showModalAtRiskList();
        });
    }
}

async function showModalAtRiskList() {
    // 1. Remove old modal if it exists
    const old = document.getElementById('atRiskListModal');
    if (old) old.remove();

    // 2. Load latest product/SKU data if available
    let items = [];
    if (fullInventoryData && fullInventoryData.length > 0) {
        items = fullInventoryData;
    } else {
        // Fetch on-the-fly from database
        try {
            const token = localStorage.getItem('stockSense_jwt');
            const res = await fetch('/api/inventory', {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });
            if (res.ok) {
                const json = await res.json();
                if (json && json.status === 'success' && json.data) {
                    fullInventoryData = json.data;
                    items = json.data;
                }
            }
        } catch (e) {
            console.error("Failed to fetch Inventory data for At-Risk list:", e);
        }
    }

    // Filter to only get At-Risk products: stock <= reorder_point
    const atRiskItems = items.filter(item => {
        const left = item.stock || 0;
        const reorderPoint = item.reorder_point || 50;
        return left <= reorderPoint;
    });

    // 3. Create modal overlay and container
    const overlay = document.createElement('div');
    overlay.className = 'sku-modal-overlay';
    overlay.id = 'atRiskListModal';

    // Construct glassmorphic contents
    overlay.innerHTML = `
        <div class="sku-modal-container">
            <div class="sku-modal-header">
                <div>
                    <h3 style="margin:0; font-size:1.3rem; display:flex; align-items:center; gap:0.6rem; color:var(--text-primary);">
                        <i class="fa-solid fa-triangle-exclamation" style="color:var(--status-danger);"></i> At-Risk Products
                    </h3>
                    <p style="margin:0.25rem 0 0; font-size:0.8rem; color:var(--text-secondary);" id="atRiskModalSub">
                        Tracked total of ${atRiskItems.length} products with critical or low stock levels.
                    </p>
                </div>
                <button class="sku-modal-close" id="closeAtRiskModal" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            
            <div class="sku-modal-search">
                <i class="fa-solid fa-search"></i>
                <input type="text" id="atRiskModalSearchInput" placeholder="Search by SKU, Name, or Category..." autocomplete="off">
            </div>

            <div class="sku-table-wrapper">
                <table class="sku-table">
                    <thead>
                        <tr>
                            <th style="width: 12%;">SKU / ID</th>
                            <th style="width: 38%;">Product Details</th>
                            <th style="width: 14%; text-align: center;">Unit Price</th>
                            <th style="width: 11%; text-align: center;">Total Units</th>
                            <th style="width: 11%; text-align: center;">Units Left</th>
                            <th style="width: 14%; text-align: center;">Status</th>
                        </tr>
                    </thead>
                    <tbody id="atRiskModalTableBody">
                        ${renderAtRiskModalRows(atRiskItems)}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Force reflow and add 'open' class for CSS transition scale-in and fade-in
    setTimeout(() => {
        overlay.classList.add('open');
    }, 10);

    // Focus search input automatically
    const searchInput = document.getElementById('atRiskModalSearchInput');
    if (searchInput) searchInput.focus();

    // 4. Modal Close Logic
    const closeModal = () => {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 250);
    };

    document.getElementById('closeAtRiskModal').addEventListener('click', closeModal);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);

    // 5. Search Filtering Logic
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            const filtered = atRiskItems.filter(item => {
                return (item.sku && item.sku.toLowerCase().includes(query)) ||
                       (item.name && item.name.toLowerCase().includes(query)) ||
                       (item.category && item.category.toLowerCase().includes(query));
            });
            
            const tbody = document.getElementById('atRiskModalTableBody');
            if (tbody) {
                tbody.innerHTML = renderAtRiskModalRows(filtered);
            }

            const sub = document.getElementById('atRiskModalSub');
            if (sub) {
                if (query.length > 0) {
                    sub.textContent = `Showing ${filtered.length} of ${atRiskItems.length} matched at-risk products.`;
                } else {
                    sub.textContent = `Tracked total of ${atRiskItems.length} products with critical or low stock levels.`;
                }
            }
        });
    }
}

function renderAtRiskModalRows(items) {
    if (!items || items.length === 0) {
        return `
            <tr>
                <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem; font-size: 0.9rem;">
                    <i class="fa-solid fa-box-open" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem; color: var(--text-muted);"></i>
                    No matching at-risk products found.
                </td>
            </tr>
        `;
    }

    return items.map(item => {
        const sold = item.units_sold || 0;
        const left = item.stock || 0;
        const total = sold + left;
        const reorderPoint = item.reorder_point || 50;
        const price = (item.price && item.price > 0) ? formatCurrency(item.price) : '—';

        // Determine stock status beautifully
        let statusText = 'Healthy';
        let badgeStyle = 'background: rgba(16, 185, 129, 0.15); color: var(--status-success); border: 1px solid rgba(16, 185, 129, 0.25);';
        let remainingColor = 'var(--text-primary)';
        let whyText = '';
        let whyColor = 'var(--text-muted)';

        if (left === 0) {
            statusText = 'Out of Stock';
            badgeStyle = 'background: rgba(239, 68, 68, 0.15); color: var(--status-danger); border: 1px solid rgba(239, 68, 68, 0.25);';
            remainingColor = 'var(--status-danger)';
            whyText = 'Critical: Product is completely out of stock.';
            whyColor = 'var(--status-danger)';
        } else if (left <= reorderPoint) {
            statusText = 'Low Stock';
            badgeStyle = 'background: rgba(245, 158, 11, 0.15); color: var(--status-warning); border: 1px solid rgba(245, 158, 11, 0.25);';
            remainingColor = 'var(--status-warning)';
            whyText = `Warning: Stock level (${left}) has dropped below the reorder point of ${reorderPoint}.`;
            whyColor = 'var(--status-warning)';
        } else if (left >= reorderPoint * 3) {
            statusText = 'Overstocked';
            badgeStyle = 'background: rgba(139, 92, 246, 0.15); color: var(--accent-primary); border: 1px solid rgba(139, 92, 246, 0.25);';
            remainingColor = 'var(--accent-primary)';
            whyText = 'Stock is high; demand forecast does not require immediate replenishment.';
        } else {
            whyText = 'Normal healthy stock status.';
        }

        const statusBadge = `<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; display: inline-block; ${badgeStyle}">${statusText}</span>`;

        return `
            <tr>
                <td>
                    <code style="font-family: monospace; font-size: 0.85rem; color: var(--text-primary); background: rgba(255,255,255,0.06); padding: 3px 7px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.04);">${item.sku}</code>
                </td>
                <td>
                    <div style="display:flex; flex-direction:column; gap:0.25rem;">
                        <span style="font-weight: 500; color: var(--text-primary);">${item.name}</span>
                        <span style="font-size: 0.78rem; color: var(--text-muted);">${item.category || 'N/A'}</span>
                        <span style="font-size: 0.75rem; color: ${whyColor}; font-weight: 500; display: flex; align-items: center; gap: 0.3rem;">
                            <i class="fa-solid fa-circle-exclamation"></i> ${whyText}
                        </span>
                    </div>
                </td>
                <td style="font-weight: 600; color: var(--accent-primary); text-align: center;">
                    ${price}
                </td>
                <td style="font-weight: 600; color: var(--text-primary); text-align: center;">
                    ${total.toLocaleString()}
                </td>
                <td style="text-align: center; font-weight: 600; color: ${remainingColor};">
                    ${left.toLocaleString()}
                </td>
                <td style="text-align: center; vertical-align: middle;">
                    ${statusBadge}
                </td>
            </tr>
        `;
    }).join('');
}

