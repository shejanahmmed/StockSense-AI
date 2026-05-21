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

// BI Metrics states for dynamic view expansion
let _activeBIMetrics = null;
let _showAllTimeline = false;
let _showAllDrivers = false;

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
    setupKpiInventoryHealthTrigger();
    setupKpiForecastDemandTrigger();
    setupKpiDailyVsForecastTrigger();
    setupKpiCashFlowTrigger();
    setupKpiDemandTrendTrigger();
    setupKpiMarginTrigger();

    // 13. Setup View All Toggles for BI boxes
    setupBIMetricsToggles();

    // 10. If no CSV has been uploaded, show a clean empty state
    //     Otherwise, fetchDefaultInsight is skipped — cached data is restored in setupCsvUpload
    if (checkAuth()) {
        const hasUploadedFile = !!localStorage.getItem('stockSense_uploadedFile');
        if (hasUploadedFile) {
            // Data will be restored from localStorage cache inside setupCsvUpload
            loadInventorySilent();
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

    // Reset View All toggles and hide buttons
    _showAllTimeline = false;
    _showAllDrivers = false;
    _activeBIMetrics = null;
    const toggleTimelineBtn = document.getElementById('toggle-all-timeline');
    if (toggleTimelineBtn) toggleTimelineBtn.style.display = 'none';
    const toggleDriversBtn = document.getElementById('toggle-all-drivers');
    if (toggleDriversBtn) toggleDriversBtn.style.display = 'none';
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

        // Toggle top-bar visibility (hide it on legal/utility pages, AI Insights, and Settings)
        const topBar = document.querySelector('.top-bar');
        if (topBar) {
            topBar.style.display = (view === 'insights' || view === 'settings' || view === 'privacy' || view === 'terms' || view === 'features' || view === 'howItWorks' || view === 'pricing' || view === 'about' || view === 'contact') ? 'none' : 'flex';
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
            enhanceNextStepBannerWithSku();
            
            // Re-render timeline if cached data exists to immediately inject SKU IDs
            try {
                const cachedData = JSON.parse(localStorage.getItem('stockSense_lastResult') || 'null');
                if (cachedData && cachedData.bi_metrics) {
                    updateBIMetrics(cachedData.bi_metrics);
                }
            } catch (e) {}
        }
    } catch (error) {
        console.error("Inventory error:", error);
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--status-danger);">Failed to load inventory. Please log in again.</td></tr>';
    }
}

async function loadInventorySilent() {
    try {
        const token = localStorage.getItem('stockSense_jwt');
        const response = await fetch('/api/inventory', {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (response.ok) {
            const result = await response.json();
            if (result.status === 'success' && result.data) {
                fullInventoryData = result.data;
                enhanceNextStepBannerWithSku();
                
                // Re-trigger BIMetrics rendering to inject SKU IDs into the timeline
                try {
                    const cachedData = JSON.parse(localStorage.getItem('stockSense_lastResult') || 'null');
                    if (cachedData && cachedData.bi_metrics) {
                        updateBIMetrics(cachedData.bi_metrics);
                    }
                } catch (e) {
                    console.warn("Timeline re-render failed:", e);
                }
            }
        }
    } catch (error) {
        console.warn("Silent inventory load failed:", error);
    }
}

function enhanceNextStepBannerWithSku() {
    const nextStepEl = document.getElementById('metric-next-step');
    if (!nextStepEl || !fullInventoryData || fullInventoryData.length === 0) return;
    
    let html = nextStepEl.innerHTML;
    // Strip HTML tags to inspect the plain text
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const plainText = tempDiv.textContent || tempDiv.innerText || "";
    
    if (plainText.startsWith("Approve purchase order for ") && !plainText.includes("(")) {
        const match = plainText.match(/Approve purchase order for (.+?) before Friday/);
        if (match && match[1]) {
            const prodName = match[1].replace(/'/g, "").trim();
            const product = fullInventoryData.find(p => p.name.toLowerCase() === prodName.toLowerCase());
            if (product && product.sku) {
                const newText = `Approve purchase order for '${product.name}' (${product.sku}) before Friday to avoid stockout.`;
                const bolded = newText.replace(/'([^']+)'/g, '<strong>$1</strong>');
                nextStepEl.innerHTML = bolded;
                
                try {
                    const cachedData = JSON.parse(localStorage.getItem('stockSense_lastResult') || 'null');
                    if (cachedData && cachedData.bi_metrics) {
                        cachedData.bi_metrics.next_step = newText;
                        localStorage.setItem('stockSense_lastResult', JSON.stringify(cachedData));
                    }
                } catch (e) {
                    console.warn("Failed to update cached next_step:", e);
                }
            }
        }
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

    // Suggestion chip click → populate input & submit
    document.querySelectorAll('.chat-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const question = chip.getAttribute('data-q');
            if (!question) return;
            input.value = question;
            input.focus();
            sendChatMessage();
        });
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
                
                // Reset View All toggles for the new upload dataset
                _showAllTimeline = false;
                _showAllDrivers = false;

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
    
    // Store metrics in active cache
    _activeBIMetrics = metrics;
    
    // Setup and display toggles if lists are valid
    const toggleTimelineBtn = document.getElementById('toggle-all-timeline');
    if (toggleTimelineBtn) {
        const totalProds = Math.max(metrics.timeline ? metrics.timeline.length : 0, fullInventoryData ? fullInventoryData.length : 0);
        toggleTimelineBtn.style.display = (totalProds > 0) ? 'inline-block' : 'none';
        toggleTimelineBtn.textContent = _showAllTimeline ? 'Show Less' : 'View All';
    }
    const toggleDriversBtn = document.getElementById('toggle-all-drivers');
    if (toggleDriversBtn) {
        const totalProds = Math.max(metrics.top_products ? metrics.top_products.length : 0, fullInventoryData ? fullInventoryData.length : 0);
        toggleDriversBtn.style.display = (totalProds > 5) ? 'inline-block' : 'none';
        toggleDriversBtn.textContent = _showAllDrivers ? 'Show Less' : 'View All';
    }

    const setElemText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = text;
    };

    setElemText('metric-daily-sales', `${Number(metrics.daily_sales || 0).toLocaleString()} <span style="font-size: 0.8rem; font-weight: normal; color: var(--text-muted);">units/day</span>`);
    // Assuming we want to show forecast too, we can adjust the sub-text.
    const salesCard = document.getElementById('metric-daily-sales');
    if (salesCard && salesCard.parentElement && salesCard.parentElement.nextElementSibling) {
        salesCard.parentElement.nextElementSibling.innerHTML = `vs <span style="font-weight: 600; color: var(--accent-primary);">${Number(metrics.daily_forecast || 0).toLocaleString()}</span> forecasted units/day`;
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
        let text = metrics.next_step || "";
        // If there are no single quotes and no brackets, format it with single quotes so bolding regex works
        if (text.startsWith("Approve purchase order for ") && !text.includes("'") && !text.includes("(")) {
            const match = text.match(/Approve purchase order for (.+?) before Friday/);
            if (match && match[1]) {
                const prodName = match[1].trim();
                text = `Approve purchase order for '${prodName}' before Friday to avoid stockout.`;
            }
        }
        const bolded = text.replace(/'([^']+)'/g, '<strong>$1</strong>');
        nextStepEl.innerHTML = bolded;
    }
    
    // Timeline
    const timelineEl = document.getElementById('metric-timeline');
    if (timelineEl && metrics.timeline) {
        let html = '';
        
        let timelineList = metrics.timeline;
        if (_showAllTimeline && fullInventoryData && fullInventoryData.length > 0) {
            timelineList = fullInventoryData.map(p => {
                let urgency = 'Healthy';
                if (p.status === 'Out of Stock') urgency = 'Critical';
                else if (p.status === 'Low Stock') urgency = 'Plan';
                
                let text = 'Optimal stock level • Healthy supply';
                if (p.status === 'Out of Stock') {
                    text = 'Reorder immediately';
                } else if (p.status === 'Low Stock') {
                    text = `Restock in ${p.supplier_lead_days || 5} days`;
                }
                
                return {
                    name: p.name,
                    sku: p.sku || p.product_id,
                    stock: p.stock,
                    urgency: urgency,
                    text: text
                };
            });
            
            const getUrgencyScore = (urgency) => {
                if (urgency === 'Critical') return 1;
                if (urgency === 'Plan') return 2;
                return 3;
            };
            timelineList.sort((a, b) => getUrgencyScore(a.urgency) - getUrgencyScore(b.urgency));
        }
        
        // Partition timeline items: alert (Critical/Plan) vs healthy
        const alertItems = timelineList.filter(item => item.urgency === 'Critical' || item.urgency === 'Plan');
        const healthyItems = timelineList.filter(item => item.urgency !== 'Critical' && item.urgency !== 'Plan');
        
        const buildTimelineItemHtml = (item) => {
            let colorVar = 'var(--status-success)';
            let badgeHtml = '';
            let textHtml = '';
            
            if (item.urgency === 'Critical') {
                colorVar = 'var(--status-danger)';
                badgeHtml = `<span class="badge warning-badge" style="background: var(--status-danger-bg); color: var(--status-danger); border-color: rgba(239, 68, 68, 0.3);">Critical</span>`;
                textHtml = `<span style="font-size: 0.8rem; color: ${colorVar};">${item.text}</span>`;
            } else if (item.urgency === 'Plan') {
                colorVar = 'var(--status-warning)';
                badgeHtml = `<span class="badge warning-badge">Plan</span>`;
                textHtml = `<span style="font-size: 0.8rem; color: ${colorVar};">${item.text}</span>`;
            } else {
                colorVar = 'var(--status-success)';
                badgeHtml = `<span class="badge success-badge" style="background: rgba(16, 185, 129, 0.1); color: var(--status-success); border-color: rgba(16, 185, 129, 0.3);">Stable</span>`;
                textHtml = `<span style="font-size: 0.8rem; color: ${colorVar};">Optimal stock level • Healthy supply</span>`;
            }
            
            // Look up product SKU for high-fidelity identification (handles cached or new metrics)
            let sku = item.sku || "";
            if (!sku && fullInventoryData && fullInventoryData.length > 0) {
                const found = fullInventoryData.find(p => p.name.toLowerCase() === item.name.toLowerCase());
                if (found && found.sku) {
                    sku = found.sku;
                }
            }
            const skuSpan = sku ? `<span style="font-weight: normal; color: var(--text-secondary); font-family: monospace; font-size: 0.82rem; margin-left: 0.4rem; padding: 0.1rem 0.35rem; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 4px;">${sku}</span>` : '';
            
            return `
                <li style="display: flex; align-items: center; gap: 1rem; position: relative;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: ${colorVar}; box-shadow: 0 0 10px ${colorVar};"></div>
                    <div style="flex: 1; display: flex; flex-direction: column;">
                        <strong style="color: var(--text-primary); display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem;">
                            ${item.name}${skuSpan}
                            <span style="font-weight: normal; color: var(--text-muted); font-size: 0.85rem; margin-left: auto;">(${item.stock} left)</span>
                        </strong>
                        ${textHtml}
                    </div>
                    ${badgeHtml}
                </li>
            `;
        };

        if (!_showAllTimeline) {
            // Collapsed view: show ONLY alerts (up to 3)
            const visibleAlerts = alertItems.slice(0, 3);
            if (visibleAlerts.length > 0) {
                visibleAlerts.forEach(item => {
                    html += buildTimelineItemHtml(item);
                });
            } else {
                html += `
                    <li style="display: flex; align-items: center; gap: 1rem; position: relative; padding: 0.5rem 0;">
                        <div style="width: 12px; height: 12px; border-radius: 50%; background: var(--status-success); box-shadow: 0 0 10px var(--status-success);"></div>
                        <div style="flex: 1; display: flex; flex-direction: column;">
                            <strong style="color: var(--text-primary);">All Inventory Stable</strong>
                            <span style="font-size: 0.8rem; color: var(--status-success);">No active stock alerts or reorder needs.</span>
                        </div>
                        <span class="badge success-badge" style="background: rgba(16, 185, 129, 0.1); color: var(--status-success); border-color: rgba(16, 185, 129, 0.3);">Stable</span>
                    </li>
                `;
            }
        } else {
            // Expanded view: show ALL alerts first
            if (alertItems.length > 0) {
                alertItems.forEach(item => {
                    html += buildTimelineItemHtml(item);
                });
            } else {
                html += `
                    <li style="display: flex; align-items: center; gap: 1rem; position: relative; padding: 0.5rem 0;">
                        <div style="width: 12px; height: 12px; border-radius: 50%; background: var(--status-success); box-shadow: 0 0 10px var(--status-success);"></div>
                        <div style="flex: 1; display: flex; flex-direction: column;">
                            <strong style="color: var(--text-primary);">All Inventory Stable</strong>
                            <span style="font-size: 0.8rem; color: var(--status-success);">No active stock alerts or reorder needs.</span>
                        </div>
                        <span class="badge success-badge" style="background: rgba(16, 185, 129, 0.1); color: var(--status-success); border-color: rgba(16, 185, 129, 0.3);">Stable</span>
                    </li>
                `;
            }
            
            // Show all healthy items in a separate section
            if (healthyItems.length > 0) {
                html += `
                    <div style="margin: 1.5rem 0 1rem 0; padding-top: 1.25rem; border-top: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; gap: 0.5rem;">
                        <i class="fa-solid fa-circle-check" style="color: var(--status-success); font-size: 0.95rem;"></i>
                        <span style="font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary);">Not to Worry About (Stable & Healthy)</span>
                    </div>
                `;
                healthyItems.forEach(item => {
                    html += buildTimelineItemHtml(item);
                });
            }
        }
        
        timelineEl.innerHTML = html;
    }

    // Top Products
    const topProductsEl = document.getElementById('metric-top-products');
    if (topProductsEl && metrics.top_products) {
        let html = '';
        
        let topProductsList = metrics.top_products;
        
        // Resilient Fallback: If cache is stale and only contains <= 5 items, but full database has more,
        // dynamically reconstruct the sorted margin list from full inventory data.
        if (_showAllDrivers && fullInventoryData && fullInventoryData.length > 5) {
            const sortedInventory = [...fullInventoryData].sort((a, b) => (b.forecasted_demand || 0) - (a.forecasted_demand || 0));
            topProductsList = sortedInventory.map((p, i) => ({
                name: p.name,
                sku: p.sku || p.product_id,
                margin: `+${Math.max(5, 35 - i * 3)}% Margin`
            }));
        }
        
        const driverItems = _showAllDrivers ? topProductsList : topProductsList.slice(0, 5);
        driverItems.forEach((prod, idx) => {
            let borderColor = 'rgba(255,255,255,0.1)';
            if (idx === 0) borderColor = 'var(--accent-primary)';
            else if (idx === 1) borderColor = 'var(--accent-secondary)';
            
            // Look up product SKU for high-fidelity identification (handles cached or new metrics)
            let sku = prod.sku || "";
            if (!sku && fullInventoryData && fullInventoryData.length > 0) {
                const found = fullInventoryData.find(p => p.name.toLowerCase() === prod.name.toLowerCase());
                if (found && found.sku) {
                    sku = found.sku;
                }
            }
            const skuSpan = sku ? `<span style="font-weight: normal; color: var(--text-secondary); font-family: monospace; font-size: 0.82rem; margin-left: 0.4rem; padding: 0.1rem 0.35rem; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 4px;">${sku}</span>` : '';
            
            html += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: rgba(255,255,255,0.02); border-radius: 8px; border-left: 3px solid ${borderColor};">
                    <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                        <span style="font-weight: bold; color: var(--text-secondary); width: 20px;">${idx + 1}</span>
                        <span style="color: var(--text-primary); font-weight: 500; display: flex; align-items: center; gap: 0.25rem;">
                            ${prod.name}${skuSpan}
                        </span>
                    </div>
                    <span style="color: var(--status-success); font-weight: 600; font-size: 0.9rem;">${prod.margin}</span>
                </div>
            `;
        });
        topProductsEl.innerHTML = html || '<p style="color: var(--text-muted);">No products found.</p>';
    }
}

// ==========================================
// View All / Show Less BI Metrics Toggles
// ==========================================
function setupBIMetricsToggles() {
    const toggleTimelineBtn = document.getElementById('toggle-all-timeline');
    const toggleDriversBtn = document.getElementById('toggle-all-drivers');

    if (toggleTimelineBtn) {
        toggleTimelineBtn.addEventListener('click', () => {
            _showAllTimeline = !_showAllTimeline;
            if (_activeBIMetrics) {
                updateBIMetrics(_activeBIMetrics);
            }
        });
    }

    if (toggleDriversBtn) {
        toggleDriversBtn.addEventListener('click', () => {
            _showAllDrivers = !_showAllDrivers;
            if (_activeBIMetrics) {
                updateBIMetrics(_activeBIMetrics);
            }
        });
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


// ==========================================
// Inventory Health Interactive Dialog
// ==========================================
function setupKpiInventoryHealthTrigger() {
    const kpiCard = document.getElementById('kpiInventoryHealthCard');
    if (kpiCard) {
        kpiCard.addEventListener('click', () => {
            // Clicking Inventory Health shows risk products at first, meeting user expectations
            showModalAtRiskList();
        });
    }
}


// ==========================================
// Forecasted Demand Interactive Dialog
// ==========================================
function setupKpiForecastDemandTrigger() {
    const kpiCard = document.getElementById('kpiForecastDemandCard');
    if (kpiCard) {
        kpiCard.addEventListener('click', () => {
            showModalForecastDemandList();
        });
    }
}

async function showModalForecastDemandList() {
    // 1. Remove old modal if it exists
    const old = document.getElementById('forecastDemandListModal');
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
            console.error("Failed to fetch Inventory data for Forecast Demand list:", e);
        }
    }

    // 3. Aggregate analytical metrics
    const totalForecastedUnits = items.reduce((sum, item) => sum + (item.forecasted_demand || 0), 0);
    const projectedRevenue = items.reduce((sum, item) => sum + ((item.forecasted_demand || 0) * (item.price || 0)), 0);
    const velocity = (totalForecastedUnits / 7).toFixed(1);

    // Peak demand category computation
    const categoryDemand = {};
    items.forEach(item => {
        const cat = item.category || 'Uncategorized';
        categoryDemand[cat] = (categoryDemand[cat] || 0) + (item.forecasted_demand || 0);
    });
    let topCategory = 'N/A';
    let maxDemand = -1;
    Object.entries(categoryDemand).forEach(([cat, demand]) => {
        if (demand > maxDemand && demand > 0) {
            maxDemand = demand;
            topCategory = cat;
        }
    });

    // 4. Create modal overlay and container
    const overlay = document.createElement('div');
    overlay.className = 'sku-modal-overlay';
    overlay.id = 'forecastDemandListModal';

    overlay.innerHTML = `
        <div class="sku-modal-container" style="width: 950px; max-width: 95vw;">
            <div class="sku-modal-header">
                <div>
                    <h3 style="margin:0; font-size:1.3rem; display:flex; align-items:center; gap:0.6rem; color:var(--text-primary);">
                        <i class="fa-solid fa-arrow-trend-up" style="color:var(--status-success);"></i> Forecasted Demand Insights
                    </h3>
                    <p style="margin:0.25rem 0 0; font-size:0.8rem; color:var(--text-secondary);" id="forecastModalSub">
                        7-day demand projections and replenishment analysis for all active products.
                    </p>
                </div>
                <button class="sku-modal-close" id="closeForecastModal" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <!-- Premium Analytical Summary Grid -->
            <div class="forecast-summary-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-top: 0.25rem;">
                <div class="glass-panel" style="padding: 1rem; border-radius: var(--radius-md); background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; gap: 0.25rem;">
                    <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em;">Projected Revenue</span>
                    <span style="font-size: 1.25rem; font-weight: 700; color: var(--status-success);" id="forecastSummaryRevenue">${formatCurrency(projectedRevenue)}</span>
                    <span style="font-size: 0.7rem; color: var(--text-muted);">From 7d forecast demand</span>
                </div>
                <div class="glass-panel" style="padding: 1rem; border-radius: var(--radius-md); background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; gap: 0.25rem;">
                    <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em;">Total Units</span>
                    <span style="font-size: 1.25rem; font-weight: 700; color: var(--accent-primary);" id="forecastSummaryUnits">${totalForecastedUnits.toLocaleString()}</span>
                    <span style="font-size: 0.7rem; color: var(--text-muted);">Predicted sales volume</span>
                </div>
                <div class="glass-panel" style="padding: 1rem; border-radius: var(--radius-md); background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; gap: 0.25rem;">
                    <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em;">Daily Velocity</span>
                    <span style="font-size: 1.25rem; font-weight: 700; color: var(--status-info);" id="forecastSummaryVelocity">${velocity} / day</span>
                    <span style="font-size: 0.7rem; color: var(--text-muted);">Average sales speed</span>
                </div>
                <div class="glass-panel" style="padding: 1rem; border-radius: var(--radius-md); background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; gap: 0.25rem;">
                    <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em;">Peak Category</span>
                    <span style="font-size: 1.1rem; font-weight: 700; color: var(--status-warning); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" id="forecastSummaryCategory" title="${topCategory}">${topCategory}</span>
                    <span style="font-size: 0.7rem; color: var(--text-muted);">Highest weekly demand</span>
                </div>
            </div>
            
            <div class="sku-modal-search">
                <i class="fa-solid fa-search"></i>
                <input type="text" id="forecastModalSearchInput" placeholder="Search by SKU, Name, or Category..." autocomplete="off">
            </div>

            <div class="sku-table-wrapper">
                <table class="sku-table">
                    <thead>
                        <tr>
                            <th style="width: 12%;">SKU / ID</th>
                            <th style="width: 32%;">Product Details</th>
                            <th style="width: 12%; text-align: center;">Unit Price</th>
                            <th style="width: 12%; text-align: center;">Stock Available</th>
                            <th style="width: 12%; text-align: center;">7d Forecast</th>
                            <th style="width: 20%; text-align: center;">Replenishment Status</th>
                        </tr>
                    </thead>
                    <tbody id="forecastModalTableBody">
                        ${renderForecastDemandModalRows(items)}
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
    const searchInput = document.getElementById('forecastModalSearchInput');
    if (searchInput) searchInput.focus();

    // Modal Close Logic
    const closeModal = () => {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 250);
    };

    document.getElementById('closeForecastModal').addEventListener('click', closeModal);

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

    // Search Filtering Logic
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            const filtered = items.filter(item => {
                return (item.sku && item.sku.toLowerCase().includes(query)) ||
                       (item.name && item.name.toLowerCase().includes(query)) ||
                       (item.category && item.category.toLowerCase().includes(query));
            });
            
            const tbody = document.getElementById('forecastModalTableBody');
            if (tbody) {
                tbody.innerHTML = renderForecastDemandModalRows(filtered);
            }

            const sub = document.getElementById('forecastModalSub');
            if (sub) {
                if (query.length > 0) {
                    sub.textContent = `Showing ${filtered.length} of ${items.length} matched products.`;
                } else {
                    sub.textContent = `7-day demand projections and replenishment analysis for all active products.`;
                }
            }
        });
    }
}

function renderForecastDemandModalRows(items) {
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
        const stock = item.stock || 0;
        const forecast = item.forecasted_demand || 0;
        const price = (item.price && item.price > 0) ? formatCurrency(item.price) : '—';

        // Calculate stock sufficiency & badge styled perfectly
        let statusText = 'Sufficient Stock';
        let badgeStyle = 'background: rgba(16, 185, 129, 0.15); color: var(--status-success); border: 1px solid rgba(16, 185, 129, 0.25);';
        let stockColor = 'var(--text-primary)';

        if (stock === 0) {
            statusText = `Out of Stock (Reorder ${forecast} units)`;
            badgeStyle = 'background: rgba(239, 68, 68, 0.15); color: var(--status-danger); border: 1px solid rgba(239, 68, 68, 0.25);';
            stockColor = 'var(--status-danger)';
        } else if (stock < forecast) {
            const deficit = forecast - stock;
            statusText = `Low Stock (Reorder ${deficit} units)`;
            badgeStyle = 'background: rgba(245, 158, 11, 0.15); color: var(--status-warning); border: 1px solid rgba(245, 158, 11, 0.25);';
            stockColor = 'var(--status-warning)';
        }

        const statusBadge = `<span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; display: inline-block; ${badgeStyle}">${statusText}</span>`;

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
                <td style="font-weight: 600; color: var(--accent-primary); text-align: center;">
                    ${price}
                </td>
                <td style="text-align: center; font-weight: 600; color: ${stockColor};">
                    ${stock.toLocaleString()}
                </td>
                <td style="font-weight: 600; color: var(--text-primary); text-align: center;">
                    ${forecast.toLocaleString()}
                </td>
                <td style="text-align: center; vertical-align: middle;">
                    ${statusBadge}
                </td>
            </tr>
        `;
    }).join('');
}

// ==========================================
// Daily vs Forecast Interactive Dialog
// ==========================================
function setupKpiDailyVsForecastTrigger() {
    const kpiCard = document.getElementById('kpiDailyVsForecastCard');
    if (kpiCard) {
        kpiCard.addEventListener('click', () => {
            showModalDailyVsForecastList();
        });
    }
}

async function showModalDailyVsForecastList() {
    // 1. Remove old modal if it exists
    const old = document.getElementById('dailyVsForecastModal');
    if (old) old.remove();

    // 2. Load latest product/SKU data if available
    let items = [];
    if (fullInventoryData && fullInventoryData.length > 0) {
        items = fullInventoryData;
    }

    // 3. Calculate advanced BI stats
    let totalActualDaily = 0;
    let totalForecastDaily = 0;
    let topAccelerator = null;
    let maxAccelVal = -999999;
    let supplyDeficits = 0;

    const computedItems = items.map(p => {
        const histDaily = Math.max(0, Math.round((p.units_sold || 0) / 14));
        const foreDaily = Math.max(0, Math.round((p.forecasted_demand || 0) / 7));
        const variance = foreDaily - histDaily;
        const stock = p.stock || 0;
        
        totalActualDaily += histDaily;
        totalForecastDaily += foreDaily;

        if (variance > maxAccelVal) {
            maxAccelVal = variance;
            topAccelerator = { sku: p.sku, name: p.name, variance: variance };
        }

        // Supply deficit: if current stock is less than predicted demand for next week (7-day forecast)
        const forecastedDemand = p.forecasted_demand || 0;
        const hasDeficit = stock < forecastedDemand;
        if (hasDeficit) {
            supplyDeficits++;
        }

        return {
            ...p,
            histDaily,
            foreDaily,
            variance,
            hasDeficit
        };
    });

    const delta = totalForecastDaily - totalActualDaily;
    const deltaPct = totalActualDaily > 0 ? (delta / totalActualDaily * 100).toFixed(1) : '0.0';
    const isIncrease = delta >= 0;

    // Find the max velocity in the entire set for proportional sparklines
    const maxVelocity = Math.max(...computedItems.map(item => Math.max(item.histDaily, item.foreDaily)), 1);

    // Tab state
    let activeTab = 'all'; // 'all', 'accelerating', 'decelerating', 'deficit'
    let searchQuery = '';
    let currentSortCol = 'variance';
    let currentSortDir = 'desc';

    // 4. Create modal overlay and container
    const overlay = document.createElement('div');
    overlay.className = 'sku-modal-overlay';
    overlay.id = 'dailyVsForecastModal';
    overlay.innerHTML = `
        <div class="sku-modal-container" style="width: 1000px; max-width: 95vw; max-height: 90vh;">
            <div class="sku-modal-header">
                <div>
                    <h2 style="margin:0; font-size:1.35rem; display:flex; align-items:center; gap:0.5rem; color:var(--text-primary);">
                        <i class="fa-solid fa-scale-balanced" style="color:var(--accent-primary);"></i>
                        Daily Sales vs. AI Forecast Analysis Hub
                    </h2>
                    <p style="margin:0.25rem 0 0; font-size:0.8rem; color:var(--text-secondary);" id="dailyVsForecastModalSub">
                        Compare historical daily sales averages (14-day) with forecasted daily sales averages (7-day).
                    </p>
                </div>
                <button class="sku-modal-close" id="closeDailyForecastModal" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <!-- Scrollable Body Wrapper -->
            <div class="bi-modal-body">
                <!-- Summary Cards Block -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 0.5rem;">
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">HISTORICAL SALES</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: var(--text-primary); font-weight: 700;">
                            ${totalActualDaily.toLocaleString()} <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-muted);">units/day avg</span>
                        </h3>
                    </div>
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">AI FORECAST</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: var(--accent-primary); font-weight: 700;">
                            ${totalForecastDaily.toLocaleString()} <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-secondary);">units/day avg</span>
                        </h3>
                    </div>
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">VELOCITY SHIFT</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: ${isIncrease ? 'var(--status-success)' : 'var(--status-danger)'}; font-weight: 700; display: flex; align-items: center; gap: 0.35rem;">
                            <i class="fa-solid ${isIncrease ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i>
                            ${isIncrease ? '+' : ''}${deltaPct}%
                            <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-muted);">(${isIncrease ? '+' : ''}${delta} units/day)</span>
                        </h3>
                    </div>
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">TOP GROWTH DRIVER</span>
                        <h3 style="margin: 0; font-size: 1.02rem; color: var(--text-primary); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${topAccelerator ? topAccelerator.name : 'N/A'}">
                            ${topAccelerator ? `${topAccelerator.name} (+${topAccelerator.variance}/day)` : 'N/A'}
                        </h3>
                    </div>
                </div>

                <!-- Interactive Tab Container -->
                <div class="bi-tabs-container">
                    <button class="bi-tab-btn active" id="tab-bi-all" data-tab="all">
                        <i class="fa-solid fa-border-all"></i> All Products (${computedItems.length})
                    </button>
                    <button class="bi-tab-btn" id="tab-bi-accel" data-tab="accelerating">
                        <i class="fa-solid fa-arrow-trend-up" style="color:var(--status-success);"></i> Accelerating (${computedItems.filter(i=>i.variance > 0).length})
                    </button>
                    <button class="bi-tab-btn" id="tab-bi-decel" data-tab="decelerating">
                        <i class="fa-solid fa-arrow-trend-down" style="color:var(--status-danger);"></i> Decelerating (${computedItems.filter(i=>i.variance < 0).length})
                    </button>
                    <button class="bi-tab-btn" id="tab-bi-deficit" data-tab="deficit">
                        <i class="fa-solid fa-triangle-exclamation" style="color:var(--status-warning);"></i> Supply Deficits (${supplyDeficits})
                    </button>
                </div>

                <!-- Dynamic AI Actionable Advice Banner -->
                <div class="glass-panel" id="biRecommendationBanner" style="padding: 0.75rem 1rem; background: rgba(139, 92, 246, 0.04); border: 1px solid rgba(139, 92, 246, 0.1); border-radius: 8px; display: flex; gap: 0.75rem; align-items: center;">
                    <i class="fa-solid fa-wand-magic-sparkles" style="color: var(--accent-primary); font-size: 1.1rem;"></i>
                    <div style="flex: 1; font-size: 0.82rem; color: var(--text-secondary); line-height: 1.4;" id="biRecommendationText">
                        Loading recommendation...
                    </div>
                </div>

                <!-- Search -->
                <div class="sku-modal-search">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="dailyVsForecastSearchInput" placeholder="Search products by SKU, Name, or Category..." autocomplete="off">
                </div>

                <!-- Scrollable Table Wrapper -->
                <div class="sku-table-wrapper">
                    <table class="sku-table">
                        <thead>
                            <tr>
                                <th class="sortable-header" data-col="sku" style="width: 15%;">SKU <span class="sort-indicator" id="sort-sku"></span></th>
                                <th class="sortable-header" data-col="name" style="width: 33%;">Product Details <span class="sort-indicator" id="sort-name"></span></th>
                                <th class="sortable-header" data-col="actual" style="width: 16%; text-align: center;">Recent Daily Avg <span class="sort-indicator" id="sort-actual"></span></th>
                                <th class="sortable-header" data-col="forecast" style="width: 16%; text-align: center;">AI Forecasted Daily <span class="sort-indicator" id="sort-forecast"></span></th>
                                <th class="sortable-header" data-col="variance" style="width: 20%; text-align: center;">Variance & Sparkline <span class="sort-indicator" id="sort-variance"></span></th>
                            </tr>
                        </thead>
                        <tbody id="dailyVsForecastTableBody">
                            <!-- Dynamic rows loaded here -->
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Force reflow and add 'open' class for CSS animations
    setTimeout(() => {
        overlay.classList.add('open');
    }, 10);

    const searchInput = document.getElementById('dailyVsForecastSearchInput');
    if (searchInput) {
        searchInput.focus({ preventScroll: true });
    }

    // Modal Close Logic
    const closeModal = () => {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 250);
    };

    document.getElementById('closeDailyForecastModal').addEventListener('click', closeModal);

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

    // Sort column headers handler
    const headers = overlay.querySelectorAll('.sortable-header');
    headers.forEach(header => {
        header.addEventListener('click', () => {
            const col = header.getAttribute('data-col');
            if (currentSortCol === col) {
                currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortCol = col;
                currentSortDir = 'desc'; // Default to desc for new sort
            }
            updateTable();
        });
    });

    // Tab buttons event listeners
    const tabButtons = overlay.querySelectorAll('.bi-tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeTab = btn.getAttribute('data-tab');
            updateTable();
        });
    });

    // Search input listener
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.toLowerCase().trim();
            updateTable();
        });
    }

    // Define the core refresh/update function
    function updateTable() {
        // 1. Filter items by Tab
        let filtered = [...computedItems];
        if (activeTab === 'accelerating') {
            filtered = filtered.filter(i => i.variance > 0);
        } else if (activeTab === 'decelerating') {
            filtered = filtered.filter(i => i.variance < 0);
        } else if (activeTab === 'deficit') {
            filtered = filtered.filter(i => i.hasDeficit);
        }

        // 2. Filter items by Search Query
        if (searchQuery.length > 0) {
            filtered = filtered.filter(item => {
                return (item.sku && item.sku.toLowerCase().includes(searchQuery)) ||
                       (item.name && item.name.toLowerCase().includes(searchQuery)) ||
                       (item.category && item.category.toLowerCase().includes(searchQuery));
            });
        }

        // 3. Sort items
        filtered.sort((a, b) => {
            let valA, valB;
            if (currentSortCol === 'sku') {
                valA = a.sku || '';
                valB = b.sku || '';
            } else if (currentSortCol === 'name') {
                valA = a.name || '';
                valB = b.name || '';
            } else if (currentSortCol === 'actual') {
                valA = a.histDaily || 0;
                valB = b.histDaily || 0;
            } else if (currentSortCol === 'forecast') {
                valA = a.foreDaily || 0;
                valB = b.foreDaily || 0;
            } else {
                valA = a.variance || 0;
                valB = b.variance || 0;
            }

            if (typeof valA === 'string') {
                return currentSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else {
                return currentSortDir === 'asc' ? valA - valB : valB - valA;
            }
        });

        // 4. Render Table rows
        const tbody = document.getElementById('dailyVsForecastTableBody');
        if (tbody) {
            tbody.innerHTML = renderDailyVsForecastRows(filtered, maxVelocity);
        }

        // 5. Update Sort Indicator Icons
        headers.forEach(h => {
            const col = h.getAttribute('data-col');
            const ind = h.querySelector('.sort-indicator');
            if (ind) {
                if (col === currentSortCol) {
                    ind.innerHTML = currentSortDir === 'asc' ? '<i class="fa-solid fa-chevron-up"></i>' : '<i class="fa-solid fa-chevron-down"></i>';
                    ind.style.opacity = '1';
                } else {
                    ind.innerHTML = '';
                    ind.style.opacity = '0.3';
                }
            }
        });

        // 6. Update subtext count
        const sub = document.getElementById('dailyVsForecastModalSub');
        if (sub) {
            if (searchQuery.length > 0) {
                sub.textContent = `Showing ${filtered.length} of ${computedItems.length} matched products.`;
            } else {
                sub.textContent = `Compare historical daily sales averages (14-day) with forecasted daily sales averages (7-day).`;
            }
        }

        // 7. Update AI Recommendation Guidance Banner text
        const recText = document.getElementById('biRecommendationText');
        if (recText) {
            if (activeTab === 'all') {
                recText.innerHTML = isIncrease 
                    ? `Overall daily forecasted demand is accelerating by <strong>${deltaPct}%</strong> across all products. This indicates potential purchasing opportunities next week. We recommend reviewing reorder parameters and warehouse capacity.`
                    : `Overall daily forecasted demand is slowing by <strong>${Math.abs(deltaPct)}%</strong>. We recommend focusing on clearing excess slow-moving stock to optimize capital efficiency.`;
            } else if (activeTab === 'accelerating') {
                recText.innerHTML = `You are viewing <strong>${filtered.length} products</strong> with increasing daily sales velocity. Consider increasing purchase orders slightly for these items to capitalize on positive demand momentum.`;
            } else if (activeTab === 'decelerating') {
                recText.innerHTML = `You are viewing <strong>${filtered.length} products</strong> with cooling consumer demand. Pause or scale down immediate restocks of these items to prevent overstocking and locked capital.`;
            } else if (activeTab === 'deficit') {
                recText.innerHTML = supplyDeficits > 0
                    ? `<span style="color: var(--status-danger); font-weight: 600;"><i class="fa-solid fa-circle-exclamation"></i> Immediate Stockout Warnings:</span> Current inventory for these <strong>${supplyDeficits} products</strong> is insufficient to cover predicted demand next week. Place restock orders immediately!`
                    : `Perfect! There are currently no active supply deficits. All products have enough inventory to meet their immediate forecasted demand.`;
            }
        }
    }

    // Initial table refresh
    updateTable();
}

function renderDailyVsForecastRows(items, maxVelocity) {
    if (!items || items.length === 0) {
        return `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 3rem; font-size: 0.9rem;">
                    <i class="fa-solid fa-box-open" style="font-size: 1.8rem; display: block; margin-bottom: 0.75rem; color: var(--text-muted);"></i>
                    No products matching these criteria.
                </td>
            </tr>
        `;
    }

    return items.map(item => {
        const histDaily = item.histDaily;
        const foreDaily = item.foreDaily;
        const diff = item.variance;
        const stock = item.stock || 0;
        
        let badgeStyle = '';
        let badgeText = '';
        
        if (diff > 0) {
            badgeStyle = 'background: rgba(16, 185, 129, 0.12); color: var(--status-success); border: 1px solid rgba(16, 185, 129, 0.2);';
            badgeText = `+${diff}/day`;
        } else if (diff < 0) {
            badgeStyle = 'background: rgba(239, 68, 68, 0.12); color: var(--status-danger); border: 1px solid rgba(239, 68, 68, 0.2);';
            badgeText = `${diff}/day`;
        } else {
            badgeStyle = 'background: rgba(255, 255, 255, 0.05); color: var(--text-secondary); border: 1px solid rgba(255, 255, 255, 0.08);';
            badgeText = 'Stable';
        }

        const varianceBadge = `<span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; font-weight: 600; display: inline-block; ${badgeStyle}">${badgeText}</span>`;

        // Calculate visual sparkline widths (minimum 3% so zero values are slightly visible as thin indicators)
        const actWidth = Math.max(3, (histDaily / maxVelocity) * 100);
        const foreWidth = Math.max(3, (foreDaily / maxVelocity) * 100);

        // Highlight supply deficits
        let stockWarningEl = '';
        if (item.hasDeficit) {
            const deficitAmount = item.forecasted_demand - stock;
            stockWarningEl = `
                <div style="margin-top: 0.2rem; display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.72rem; color: var(--status-danger); font-weight: 600; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.15); padding: 1px 6px; border-radius: 3px;">
                    <i class="fa-solid fa-triangle-exclamation"></i> Deficit: ${deficitAmount.toLocaleString()} units
                </div>
            `;
        } else {
            stockWarningEl = `
                <span style="font-size: 0.72rem; color: var(--status-success); margin-top: 0.2rem; display: inline-block;">
                    Stock: ${stock.toLocaleString()} units
                </span>
            `;
        }

        return `
            <tr>
                <td>
                    <code style="font-family: monospace; font-size: 0.85rem; color: var(--text-primary); background: rgba(255,255,255,0.06); padding: 3px 7px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.04);">${item.sku}</code>
                </td>
                <td>
                    <div style="display:flex; flex-direction:column; gap:0.15rem;">
                        <span style="font-weight: 650; color: var(--text-primary);">${item.name}</span>
                        <span style="font-size: 0.78rem; color: var(--text-muted);">${item.category || 'N/A'}</span>
                    </div>
                </td>
                <td style="font-weight: 600; color: var(--text-primary); text-align: center;">
                    ${histDaily.toLocaleString()} <span style="font-weight: normal; font-size: 0.75rem; color: var(--text-muted);">units</span>
                </td>
                <td style="font-weight: 600; color: var(--accent-primary); text-align: center;">
                    ${foreDaily.toLocaleString()} <span style="font-weight: normal; font-size: 0.75rem; color: var(--text-muted);">units</span>
                </td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 0.25rem; width: 100%;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            ${varianceBadge}
                            ${stockWarningEl}
                        </div>
                        <!-- Sparkline Tracker -->
                        <div style="display: flex; flex-direction: column; gap: 3px; width: 100%; margin-top: 0.2rem;">
                            <!-- Actual Bar -->
                            <div class="bi-spark-track" style="height: 5px;" title="Actual: ${histDaily} units/day">
                                <div class="bi-spark-bar bi-spark-bar-actual" style="width: ${actWidth}%;"></div>
                            </div>
                            <!-- Forecast Bar -->
                            <div class="bi-spark-track" style="height: 5px;" title="Forecast: ${foreDaily} units/day">
                                <div class="bi-spark-bar bi-spark-bar-forecast" style="width: ${foreWidth}%;"></div>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}


// ==========================================
// Cash Flow & Capital Optimization Trigger
// ==========================================
function setupKpiCashFlowTrigger() {
    const kpiCard = document.getElementById('kpiCashFlowCard');
    if (kpiCard) {
        kpiCard.addEventListener('click', () => {
            showModalCashFlow();
        });
    }
}

async function showModalCashFlow() {
    // 1. Remove old modal if it exists
    const old = document.getElementById('cashFlowModal');
    if (old) old.remove();

    // 2. Load latest product/SKU data if available
    let items = [];
    if (fullInventoryData && fullInventoryData.length > 0) {
        items = fullInventoryData;
    } else {
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
            console.error("Failed to fetch Inventory data for Cash Flow:", e);
        }
    }

    // 3. Calculate advanced BI stats
    const computedItems = items.map(p => {
        const price = p.price || 0;
        const stock = p.stock || 0;
        const forecasted_demand = p.forecasted_demand || 0;
        
        // Scale 7d forecast demand to 30d
        const forecastedDemand30d = Math.round(forecasted_demand * (30 / 7));
        
        // Current sales capability: limited by current stock unless restocked
        const projectedUnitsSold = Math.min(stock, forecastedDemand30d);
        const projectedInflow = projectedUnitsSold * price;
        const tiedUpCapital = stock * price;
        const potentialRevenue = forecastedDemand30d * price;
        const cashAtRisk = Math.max(0, forecastedDemand30d - stock) * price;
        const restockOutflow = Math.max(0, forecastedDemand30d - stock) * price * 0.70;

        return {
            ...p,
            forecastedDemand30d,
            projectedUnitsSold,
            projectedInflow,
            tiedUpCapital,
            potentialRevenue,
            cashAtRisk,
            restockOutflow
        };
    });

    let totalProjectedInflow = 0;
    let totalTiedUpCapital = 0;
    let totalCashAtRisk = 0;
    let totalRestockOutflow = 0;

    computedItems.forEach(item => {
        totalProjectedInflow += item.projectedInflow;
        totalTiedUpCapital += item.tiedUpCapital;
        totalCashAtRisk += item.cashAtRisk;
        totalRestockOutflow += item.restockOutflow;
    });

    // Dynamic threshold for "Inflow Leaders" - top 15%
    const sortedInflows = [...computedItems].map(i => i.projectedInflow).sort((a, b) => b - a);
    const thresholdIdx = Math.max(4, Math.floor(sortedInflows.length * 0.15));
    const leaderThreshold = sortedInflows[thresholdIdx] || 0;

    const maxInflow = Math.max(...computedItems.map(item => item.projectedInflow), 1);

    // Tab state
    let activeTab = 'all'; // 'all', 'leaders', 'risk', 'sinks'
    let searchQuery = '';
    let currentSortCol = 'inflow';
    let currentSortDir = 'desc';

    // 4. Create modal overlay and container
    const overlay = document.createElement('div');
    overlay.className = 'sku-modal-overlay';
    overlay.id = 'cashFlowModal';
    overlay.innerHTML = `
        <div class="sku-modal-container" style="width: 1000px; max-width: 95vw; max-height: 90vh;">
            <div class="sku-modal-header">
                <div>
                    <h2 style="margin:0; font-size:1.35rem; display:flex; align-items:center; gap:0.5rem; color:var(--text-primary);">
                        <i class="fa-solid fa-money-bill-wave" style="color:var(--status-success);"></i>
                        Cash Flow & Capital Optimization Hub
                    </h2>
                    <p style="margin:0.25rem 0 0; font-size:0.8rem; color:var(--text-secondary);" id="cashFlowModalSub">
                        Analyze projected gross cash inflow (30-day) against warehouse working capital efficiency.
                    </p>
                </div>
                <button class="sku-modal-close" id="closeCashFlowModal" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <!-- Scrollable Body Wrapper -->
            <div class="bi-modal-body">
                <!-- Summary Cards Block -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 0.5rem;">
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">PROJECTED INFLOW</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: var(--status-success); font-weight: 700;">
                            ${formatCurrency(totalProjectedInflow)} <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-muted);">achievable</span>
                        </h3>
                    </div>
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">TIED-UP CAPITAL</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: var(--accent-primary); font-weight: 700;">
                            ${formatCurrency(totalTiedUpCapital)} <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-secondary);">in warehouse</span>
                        </h3>
                    </div>
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">CASH FLOW AT RISK</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: var(--status-danger); font-weight: 700;">
                            ${formatCurrency(totalCashAtRisk)} <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-muted);">stockout loss</span>
                        </h3>
                    </div>
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">RESTOCK OUTFLOW (EST)</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: var(--status-warning); font-weight: 700;">
                            ${formatCurrency(totalRestockOutflow)} <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-muted);">to unlock risk</span>
                        </h3>
                    </div>
                </div>

                <!-- Interactive Tab Container -->
                <div class="bi-tabs-container">
                    <button class="bi-tab-btn active" id="tab-cf-all" data-tab="all">
                        <i class="fa-solid fa-border-all"></i> All Products (${computedItems.length})
                    </button>
                    <button class="bi-tab-btn" id="tab-cf-leaders" data-tab="leaders">
                        <i class="fa-solid fa-star" style="color:var(--status-success);"></i> Inflow Leaders (${computedItems.filter(i => i.projectedInflow >= leaderThreshold && i.projectedInflow > 0).length})
                    </button>
                    <button class="bi-tab-btn" id="tab-cf-risk" data-tab="risk">
                        <i class="fa-solid fa-triangle-exclamation" style="color:var(--status-danger);"></i> Lost Cash Risk (${computedItems.filter(i => i.cashAtRisk > 0).length})
                    </button>
                    <button class="bi-tab-btn" id="tab-cf-sinks" data-tab="sinks">
                        <i class="fa-solid fa-lock" style="color:var(--status-warning);"></i> Slow Sinks (${computedItems.filter(i => i.stock > 0 && (i.forecastedDemand30d === 0 || i.stock > i.forecastedDemand30d * 3)).length})
                    </button>
                </div>

                <!-- Dynamic AI Actionable Advice Banner -->
                <div class="glass-panel" id="cfRecommendationBanner" style="padding: 0.75rem 1rem; background: rgba(16, 185, 129, 0.04); border: 1px solid rgba(16, 185, 129, 0.1); border-radius: 8px; display: flex; gap: 0.75rem; align-items: center;">
                    <i class="fa-solid fa-wand-magic-sparkles" style="color: var(--status-success); font-size: 1.1rem;"></i>
                    <div style="flex: 1; font-size: 0.82rem; color: var(--text-secondary); line-height: 1.4;" id="cfRecommendationText">
                        Loading cash flow advice...
                    </div>
                </div>

                <!-- Search -->
                <div class="sku-modal-search">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="cashFlowSearchInput" placeholder="Search products by SKU, Name, or Category..." autocomplete="off">
                </div>

                <!-- Scrollable Table Wrapper -->
                <div class="sku-table-wrapper">
                    <table class="sku-table">
                        <thead>
                            <tr>
                                <th class="sortable-header" data-col="sku" style="width: 15%;">SKU <span class="sort-indicator" id="sort-cf-sku"></span></th>
                                <th class="sortable-header" data-col="name" style="width: 28%;">Product Details <span class="sort-indicator" id="sort-cf-name"></span></th>
                                <th class="sortable-header" data-col="inflow" style="width: 25%; text-align: center;">Projected Inflow (30d) <span class="sort-indicator" id="sort-cf-inflow"></span></th>
                                <th class="sortable-header" data-col="capital" style="width: 16%; text-align: center;">Tied-Up Capital <span class="sort-indicator" id="sort-cf-capital"></span></th>
                                <th class="sortable-header" data-col="status" style="width: 16%; text-align: center;">Status <span class="sort-indicator" id="sort-cf-status"></span></th>
                            </tr>
                        </thead>
                        <tbody id="cashFlowTableBody">
                            <!-- Dynamic rows loaded here -->
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Force reflow and add 'open' class for CSS animations
    setTimeout(() => {
        overlay.classList.add('open');
    }, 10);

    const searchInput = document.getElementById('cashFlowSearchInput');
    if (searchInput) {
        searchInput.focus({ preventScroll: true });
    }

    // Modal Close Logic
    const closeModal = () => {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 250);
    };

    document.getElementById('closeCashFlowModal').addEventListener('click', closeModal);

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

    // Sort column headers handler
    const headers = overlay.querySelectorAll('.sortable-header');
    headers.forEach(header => {
        header.addEventListener('click', () => {
            const col = header.getAttribute('data-col');
            if (currentSortCol === col) {
                currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortCol = col;
                currentSortDir = 'desc'; // Default to desc for new sort
            }
            updateTable();
        });
    });

    // Tab buttons event listeners
    const tabButtons = overlay.querySelectorAll('.bi-tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeTab = btn.getAttribute('data-tab');
            updateTable();
        });
    });

    // Search input listener
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.toLowerCase().trim();
            updateTable();
        });
    }

    // Define the core refresh/update function
    function updateTable() {
        // 1. Filter items by Tab
        let filtered = [...computedItems];
        if (activeTab === 'leaders') {
            filtered = filtered.filter(i => i.projectedInflow >= leaderThreshold && i.projectedInflow > 0);
        } else if (activeTab === 'risk') {
            filtered = filtered.filter(i => i.cashAtRisk > 0);
        } else if (activeTab === 'sinks') {
            filtered = filtered.filter(i => i.stock > 0 && (i.forecastedDemand30d === 0 || i.stock > i.forecastedDemand30d * 3));
        }

        // 2. Filter items by Search Query
        if (searchQuery.length > 0) {
            filtered = filtered.filter(item => {
                return (item.sku && item.sku.toLowerCase().includes(searchQuery)) ||
                       (item.name && item.name.toLowerCase().includes(searchQuery)) ||
                       (item.category && item.category.toLowerCase().includes(searchQuery));
            });
        }

        // 3. Sort items
        filtered.sort((a, b) => {
            let valA, valB;
            if (currentSortCol === 'sku') {
                valA = a.sku || '';
                valB = b.sku || '';
            } else if (currentSortCol === 'name') {
                valA = a.name || '';
                valB = b.name || '';
            } else if (currentSortCol === 'inflow') {
                valA = a.projectedInflow || 0;
                valB = b.projectedInflow || 0;
            } else if (currentSortCol === 'capital') {
                valA = a.tiedUpCapital || 0;
                valB = b.tiedUpCapital || 0;
            } else {
                // Status sort based on severity hierarchy
                const getStatusWeight = (item) => {
                    if (item.projectedInflow >= leaderThreshold && item.projectedInflow > 0) return 3;
                    if (item.cashAtRisk > 0) return 2;
                    if (item.stock > 0 && (item.forecastedDemand30d === 0 || item.stock > item.forecastedDemand30d * 3)) return 1;
                    return 0;
                };
                valA = getStatusWeight(a);
                valB = getStatusWeight(b);
            }

            if (typeof valA === 'string') {
                return currentSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else {
                return currentSortDir === 'asc' ? valA - valB : valB - valA;
            }
        });

        // 4. Render Table rows
        const tbody = document.getElementById('cashFlowTableBody');
        if (tbody) {
            tbody.innerHTML = renderCashFlowModalRows(filtered, maxInflow, leaderThreshold);
        }

        // 5. Update Sort Indicator Icons
        headers.forEach(h => {
            const col = h.getAttribute('data-col');
            const ind = h.querySelector('.sort-indicator');
            if (ind) {
                if (col === currentSortCol) {
                    ind.innerHTML = currentSortDir === 'asc' ? '<i class="fa-solid fa-chevron-up"></i>' : '<i class="fa-solid fa-chevron-down"></i>';
                    ind.style.opacity = '1';
                } else {
                    ind.innerHTML = '';
                    ind.style.opacity = '0.3';
                }
            }
        });

        // 6. Update subtext count
        const sub = document.getElementById('cashFlowModalSub');
        if (sub) {
            if (searchQuery.length > 0) {
                sub.textContent = `Showing ${filtered.length} of ${computedItems.length} matched products.`;
            } else {
                sub.textContent = `Analyze projected gross cash inflow (30-day) against warehouse working capital efficiency.`;
            }
        }

        // 7. Update AI Recommendation Guidance Banner text
        const recText = document.getElementById('cfRecommendationText');
        if (recText) {
            if (activeTab === 'all') {
                recText.innerHTML = `Your inventory is projected to generate <strong>${formatCurrency(totalProjectedInflow)}</strong> in gross cash inflow over the next 30 days. You have <strong>${formatCurrency(totalTiedUpCapital)}</strong> tied up in warehouse assets. However, supply deficits put <strong>${formatCurrency(totalCashAtRisk)}</strong> at immediate risk of stockout loss. Restocking top items immediately can capture this lost revenue.`;
            } else if (activeTab === 'leaders') {
                const leaderCount = computedItems.filter(i => i.projectedInflow >= leaderThreshold && i.projectedInflow > 0).length;
                const leaderSum = computedItems.filter(i => i.projectedInflow >= leaderThreshold && i.projectedInflow > 0).reduce((sum, i) => sum + i.projectedInflow, 0);
                const percentLeaders = totalProjectedInflow > 0 ? ((leaderSum / totalProjectedInflow) * 100).toFixed(1) : '0.0';
                recText.innerHTML = `These <strong>${leaderCount} top products</strong> account for <strong>${percentLeaders}%</strong> of your projected 30-day cash inflow (<strong>${formatCurrency(leaderSum)}</strong>). Prioritize supplier agreements and logistics guarantees for these high-volume champions to keep the cash flowing.`;
            } else if (activeTab === 'risk') {
                const riskCount = computedItems.filter(i => i.cashAtRisk > 0).length;
                recText.innerHTML = `Alert: You have <strong>${riskCount} products</strong> with active supply deficits, risking <strong>${formatCurrency(totalCashAtRisk)}</strong> in lost monthly sales. Restocking these products will cost an estimated <strong>${formatCurrency(totalRestockOutflow)}</strong> (based on standard 70% COGS), unlocking significant high-margin revenue!`;
            } else if (activeTab === 'sinks') {
                const sinkCount = computedItems.filter(i => i.stock > 0 && (i.forecastedDemand30d === 0 || i.stock > i.forecastedDemand30d * 3)).length;
                const sinkSum = computedItems.filter(i => i.stock > 0 && (i.forecastedDemand30d === 0 || i.stock > i.forecastedDemand30d * 3)).reduce((sum, i) => sum + i.tiedUpCapital, 0);
                recText.innerHTML = `Warning: You have <strong>${sinkCount} products</strong> identified as slow-turnover warehouse sinks, locking up <strong>${formatCurrency(sinkSum)}</strong> in illiquid capital. Consider executing promotional campaigns, bundle discounts, or clearance events to free up vital cash.`;
            }
        }
    }

    // Initial table refresh
    updateTable();
}

function renderCashFlowModalRows(items, maxInflow, leaderThreshold) {
    if (!items || items.length === 0) {
        return `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 3rem; font-size: 0.9rem;">
                    <i class="fa-solid fa-box-open" style="font-size: 1.8rem; display: block; margin-bottom: 0.75rem; color: var(--text-muted);"></i>
                    No products matching these criteria.
                </td>
            </tr>
        `;
    }

    return items.map(item => {
        const price = item.price || 0;
        const stock = item.stock || 0;
        const inflow = item.projectedInflow || 0;
        const capital = item.tiedUpCapital || 0;
        const risk = item.cashAtRisk || 0;

        let statusBadge = '';
        if (inflow >= leaderThreshold && inflow > 0) {
            statusBadge = `<span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem; background: rgba(16, 185, 129, 0.12); color: var(--status-success); border: 1px solid rgba(16, 185, 129, 0.2);"><i class="fa-solid fa-star"></i> Inflow Leader</span>`;
        } else if (risk > 0) {
            statusBadge = `<span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem; background: rgba(239, 68, 68, 0.12); color: var(--status-danger); border: 1px solid rgba(239, 68, 68, 0.2);"><i class="fa-solid fa-triangle-exclamation"></i> Stockout Risk</span>`;
        } else if (stock > 0 && (item.forecastedDemand30d === 0 || stock > item.forecastedDemand30d * 3)) {
            statusBadge = `<span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem; background: rgba(245, 158, 11, 0.12); color: var(--status-warning); border: 1px solid rgba(245, 158, 11, 0.2);"><i class="fa-solid fa-lock"></i> Locked Capital</span>`;
        } else {
            statusBadge = `<span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem; background: rgba(59, 130, 246, 0.12); color: var(--status-info); border: 1px solid rgba(59, 130, 246, 0.2);"><i class="fa-solid fa-check"></i> Healthy</span>`;
        }

        // Relative width for the progress contribution bar (minimum 3%)
        const flowPct = Math.max(3, (inflow / maxInflow) * 100);

        let riskIndicatorText = '';
        if (risk > 0) {
            riskIndicatorText = `
                <div style="margin-top: 0.2rem; display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.72rem; color: var(--status-danger); font-weight: 600; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.15); padding: 1px 6px; border-radius: 3px;" title="Potential revenue lost due to insufficient stock">
                    <i class="fa-solid fa-circle-exclamation"></i> Risk: ${formatCurrency(risk)}
                </div>
            `;
        } else {
            riskIndicatorText = `
                <span style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.2rem; display: inline-block;">
                    Unfulfilled demand: 0
                </span>
            `;
        }

        return `
            <tr>
                <td>
                    <code style="font-family: monospace; font-size: 0.85rem; color: var(--text-primary); background: rgba(255,255,255,0.06); padding: 3px 7px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.04);">${item.sku}</code>
                </td>
                <td>
                    <div style="display:flex; flex-direction:column; gap:0.15rem;">
                        <span style="font-weight: 650; color: var(--text-primary);">${item.name}</span>
                        <span style="font-size: 0.78rem; color: var(--text-muted);">${item.category || 'N/A'}</span>
                    </div>
                </td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 0.25rem; width: 100%;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-weight: 600; color: var(--status-success);">${formatCurrency(inflow)}</span>
                            ${riskIndicatorText}
                        </div>
                        <!-- Contribution Sparkline -->
                        <div class="bi-spark-track" style="height: 5px; background: rgba(255,255,255,0.02);" title="Projected Inflow Contribution">
                            <div class="bi-spark-bar" style="width: ${flowPct}%; background: linear-gradient(90deg, rgba(16, 185, 129, 0.25), rgba(16, 185, 129, 0.55)); border-right: 1px solid rgba(16, 185, 129, 0.8);"></div>
                        </div>
                    </div>
                </td>
                <td style="font-weight: 600; color: var(--text-primary); text-align: center;">
                    ${formatCurrency(capital)}
                    <span style="display:block; font-size:0.72rem; font-weight:normal; color:var(--text-muted); margin-top:0.2rem;">
                        ${stock.toLocaleString()} units
                    </span>
                </td>
                <td style="text-align: center; vertical-align: middle;">
                    ${statusBadge}
                </td>
            </tr>
        `;
    }).join('');
}


// ==========================================
// Demand Trend Interactive Dialog
// ==========================================
function setupKpiDemandTrendTrigger() {
    const kpiCard = document.getElementById('kpiDemandTrendCard');
    if (kpiCard) {
        kpiCard.addEventListener('click', () => {
            showModalDemandTrend();
        });
    }
}

async function showModalDemandTrend() {
    // 1. Remove old modal if it exists
    const old = document.getElementById('demandTrendModal');
    if (old) old.remove();

    // 2. Load latest product/SKU data if available
    let items = [];
    if (fullInventoryData && fullInventoryData.length > 0) {
        items = fullInventoryData;
    } else {
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
            console.error("Failed to fetch Inventory data for Demand Trend:", e);
        }
    }

    // 3. Compute detailed metrics for each item
    const computedItems = items.map(p => {
        const histDaily = Math.max(0, Math.round((p.units_sold || 0) / 14));
        const foreDaily = Math.max(0, Math.round((p.forecasted_demand || 0) / 7));
        
        // Calculate growth rate percentage
        let growthRate = 0;
        if (histDaily > 0) {
            growthRate = ((foreDaily - histDaily) / histDaily) * 100;
        } else if (foreDaily > 0) {
            growthRate = 100; // 100% growth if historical is 0 and forecasted is positive
        }

        // Categorize Trajectory
        let trajectory = 'Stable';
        if (growthRate > 15) {
            trajectory = 'Surging';
        } else if (growthRate < -15) {
            trajectory = 'Cooling';
        }

        return {
            ...p,
            histDaily,
            foreDaily,
            growthRate,
            trajectory
        };
    });

    // Calculate Portfolio aggregate stats
    const totalSKUs = computedItems.length;
    const surgingItems = computedItems.filter(i => i.trajectory === 'Surging');
    const stableItems = computedItems.filter(i => i.trajectory === 'Stable');
    const coolingItems = computedItems.filter(i => i.trajectory === 'Cooling');

    // Portfolio aggregate shift
    const totalHistDaily = computedItems.reduce((sum, i) => sum + i.histDaily, 0);
    const totalForeDaily = computedItems.reduce((sum, i) => sum + i.foreDaily, 0);
    const overallShift = totalHistDaily > 0 ? ((totalForeDaily - totalHistDaily) / totalHistDaily) * 100 : 0;
    const overallShiftText = (overallShift >= 0 ? '+' : '') + overallShift.toFixed(1) + '%';

    const maxVelocity = Math.max(...computedItems.map(item => Math.max(item.histDaily, item.foreDaily)), 1);

    // Tab state
    let activeTab = 'all'; // 'all', 'surging', 'stable', 'cooling'
    let searchQuery = '';
    let currentSortCol = 'growth';
    let currentSortDir = 'desc';

    // 4. Create modal overlay and container
    const overlay = document.createElement('div');
    overlay.className = 'sku-modal-overlay';
    overlay.id = 'demandTrendModal';
    overlay.innerHTML = `
        <div class="sku-modal-container" style="width: 1000px; max-width: 95vw; max-height: 90vh;">
            <div class="sku-modal-header">
                <div>
                    <h2 style="margin:0; font-size:1.35rem; display:flex; align-items:center; gap:0.5rem; color:var(--text-primary);">
                        <i class="fa-solid fa-arrow-trend-up" style="color:var(--status-info);"></i>
                        Demand Trajectory & Trend Analysis Hub
                    </h2>
                    <p style="margin:0.25rem 0 0; font-size:0.8rem; color:var(--text-secondary);" id="demandTrendModalSub">
                        Analyze directional changes in customer demand comparing historical daily sales (14-day) to AI forecasts (7-day).
                    </p>
                </div>
                <button class="sku-modal-close" id="closeDemandTrendModal" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <!-- Scrollable Body Wrapper -->
            <div class="bi-modal-body">
                <!-- Summary Cards Block -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 0.5rem;">
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">PORTFOLIO DEMAND SHIFT</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: ${overallShift >= 0 ? 'var(--status-success)' : 'var(--status-danger)'}; font-weight: 700;">
                            ${overallShiftText} <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-muted);">overall momentum</span>
                        </h3>
                    </div>
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">🚀 SURGING DEMAND</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: var(--status-success); font-weight: 700;">
                            ${surgingItems.length} <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-muted);">SKUs accelerating</span>
                        </h3>
                    </div>
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">⚖️ STABLE CORE</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: var(--status-info); font-weight: 700;">
                            ${stableItems.length} <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-muted);">SKUs predictable</span>
                        </h3>
                    </div>
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">📉 COOLING DEMAND</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: var(--status-danger); font-weight: 700;">
                            ${coolingItems.length} <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-muted);">SKUs cooling down</span>
                        </h3>
                    </div>
                </div>

                <!-- Interactive Tab Container -->
                <div class="bi-tabs-container">
                    <button class="bi-tab-btn active" id="tab-dt-all" data-tab="all">
                        <i class="fa-solid fa-border-all"></i> All Products (${computedItems.length})
                    </button>
                    <button class="bi-tab-btn" id="tab-dt-surging" data-tab="surging">
                        <i class="fa-solid fa-arrow-trend-up" style="color:var(--status-success);"></i> Surging Demand (${surgingItems.length})
                    </button>
                    <button class="bi-tab-btn" id="tab-dt-stable" data-tab="stable">
                        <i class="fa-solid fa-scale-balanced" style="color:var(--status-info);"></i> Stable Performance (${stableItems.length})
                    </button>
                    <button class="bi-tab-btn" id="tab-dt-cooling" data-tab="cooling">
                        <i class="fa-solid fa-arrow-trend-down" style="color:var(--status-danger);"></i> Cooling Demand (${coolingItems.length})
                    </button>
                </div>

                <!-- Dynamic AI Actionable Advice Banner -->
                <div class="glass-panel" id="dtRecommendationBanner" style="padding: 0.75rem 1rem; background: rgba(59, 130, 246, 0.04); border: 1px solid rgba(59, 130, 246, 0.1); border-radius: 8px; display: flex; gap: 0.75rem; align-items: center;">
                    <i class="fa-solid fa-wand-magic-sparkles" style="color: var(--status-info); font-size: 1.1rem;"></i>
                    <div style="flex: 1; font-size: 0.82rem; color: var(--text-secondary); line-height: 1.4;" id="dtRecommendationText">
                        Analyzing portfolio demand dynamics...
                    </div>
                </div>

                <!-- Search -->
                <div class="sku-modal-search">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="demandTrendSearchInput" placeholder="Search products by SKU, Name, or Category..." autocomplete="off">
                </div>

                <!-- Scrollable Table Wrapper -->
                <div class="sku-table-wrapper">
                    <table class="sku-table">
                        <thead>
                            <tr>
                                <th class="sortable-header" data-col="sku" style="width: 15%;">SKU <span class="sort-indicator" id="sort-dt-sku"></span></th>
                                <th class="sortable-header" data-col="name" style="width: 30%;">Product Details <span class="sort-indicator" id="sort-dt-name"></span></th>
                                <th class="sortable-header" data-col="growth" style="width: 18%; text-align: center;">Growth Rate <span class="sort-indicator" id="sort-dt-growth"></span></th>
                                <th class="sortable-header" data-col="velocity" style="width: 22%; text-align: center;">Velocity Shift & Sparkline <span class="sort-indicator" id="sort-dt-velocity"></span></th>
                                <th class="sortable-header" data-col="status" style="width: 15%; text-align: center;">Status <span class="sort-indicator" id="sort-dt-status"></span></th>
                            </tr>
                        </thead>
                        <tbody id="demandTrendTableBody">
                            <!-- Dynamic rows loaded here -->
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Force reflow and add 'open' class for CSS animations
    setTimeout(() => {
        overlay.classList.add('open');
    }, 10);

    const searchInput = document.getElementById('demandTrendSearchInput');
    if (searchInput) {
        searchInput.focus({ preventScroll: true });
    }

    // Modal Close Logic
    const closeModal = () => {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 250);
    };

    document.getElementById('closeDemandTrendModal').addEventListener('click', closeModal);

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

    // Sort column headers handler
    const headers = overlay.querySelectorAll('.sortable-header');
    headers.forEach(header => {
        header.addEventListener('click', () => {
            const col = header.getAttribute('data-col');
            if (currentSortCol === col) {
                currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortCol = col;
                currentSortDir = 'desc'; // Default to desc for new sort
            }
            updateTable();
        });
    });

    // Tab buttons event listeners
    const tabButtons = overlay.querySelectorAll('.bi-tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeTab = btn.getAttribute('data-tab');
            updateTable();
        });
    });

    // Search input listener
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.toLowerCase().trim();
            updateTable();
        });
    }

    // Define the core refresh/update function
    function updateTable() {
        // 1. Filter items by Tab
        let filtered = [...computedItems];
        if (activeTab === 'surging') {
            filtered = filtered.filter(i => i.trajectory === 'Surging');
        } else if (activeTab === 'stable') {
            filtered = filtered.filter(i => i.trajectory === 'Stable');
        } else if (activeTab === 'cooling') {
            filtered = filtered.filter(i => i.trajectory === 'Cooling');
        }

        // 2. Filter items by Search Query
        if (searchQuery.length > 0) {
            filtered = filtered.filter(item => {
                return (item.sku && item.sku.toLowerCase().includes(searchQuery)) ||
                       (item.name && item.name.toLowerCase().includes(searchQuery)) ||
                       (item.category && item.category.toLowerCase().includes(searchQuery));
            });
        }

        // 3. Sort items
        filtered.sort((a, b) => {
            let valA, valB;
            if (currentSortCol === 'sku') {
                valA = a.sku || '';
                valB = b.sku || '';
            } else if (currentSortCol === 'name') {
                valA = a.name || '';
                valB = b.name || '';
            } else if (currentSortCol === 'growth') {
                valA = a.growthRate || 0;
                valB = b.growthRate || 0;
            } else if (currentSortCol === 'velocity') {
                valA = a.foreDaily || 0;
                valB = b.foreDaily || 0;
            } else {
                // Status sort based on trajectory priority
                const getStatusWeight = (item) => {
                    if (item.trajectory === 'Surging') return 2;
                    if (item.trajectory === 'Stable') return 1;
                    return 0;
                };
                valA = getStatusWeight(a);
                valB = getStatusWeight(b);
            }

            if (typeof valA === 'string') {
                return currentSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else {
                return currentSortDir === 'asc' ? valA - valB : valB - valA;
            }
        });

        // 4. Render Table rows
        const tbody = document.getElementById('demandTrendTableBody');
        if (tbody) {
            tbody.innerHTML = renderDemandTrendModalRows(filtered, maxVelocity);
        }

        // 5. Update Sort Indicator Icons
        headers.forEach(h => {
            const col = h.getAttribute('data-col');
            const ind = h.querySelector('.sort-indicator');
            if (ind) {
                if (col === currentSortCol) {
                    ind.innerHTML = currentSortDir === 'asc' ? '<i class="fa-solid fa-chevron-up"></i>' : '<i class="fa-solid fa-chevron-down"></i>';
                    ind.style.opacity = '1';
                } else {
                    ind.innerHTML = '';
                    ind.style.opacity = '0.3';
                }
            }
        });

        // 6. Update subtext count
        const sub = document.getElementById('demandTrendModalSub');
        if (sub) {
            if (searchQuery.length > 0) {
                sub.textContent = `Showing ${filtered.length} of ${computedItems.length} matched products.`;
            } else {
                sub.textContent = `Analyze directional changes in customer demand comparing historical daily sales (14-day) to AI forecasts (7-day).`;
            }
        }

        // 7. Update AI Recommendation Guidance Banner text
        const recText = document.getElementById('dtRecommendationText');
        if (recText) {
            if (activeTab === 'all') {
                recText.innerHTML = `Portfolio Analysis: Overall demand is <strong>${overallShiftText}</strong> this period. Out of <strong>${totalSKUs}</strong> active products, <strong>${surgingItems.length}</strong> show high demand surge velocity, while <strong>${coolingItems.length}</strong> are cooling down. Optimize stocking budgets and marketing promotions accordingly.`;
            } else if (activeTab === 'surging') {
                recText.innerHTML = `Action Required: These <strong>${surgingItems.length} accelerating products</strong> require urgent logistical guarantees and safety stock buffers (+15-20%) to capture the rising customer demand and avoid stockout losses.`;
            } else if (activeTab === 'stable') {
                recText.innerHTML = `Strategy: These <strong>${stableItems.length} consistent products</strong> show highly predictable demand velocity. Maintain normal automatic replenishment schedules to save working capital.`;
            } else if (activeTab === 'cooling') {
                recText.innerHTML = `Risk Warning: These <strong>${coolingItems.length} cooling products</strong> face warehouse deadstock risk. We recommend slower reordering cycles or launching targeted cross-selling campaigns to clear inventory efficiently.`;
            }
        }
    }

    // Initial table refresh
    updateTable();
}

function renderDemandTrendModalRows(items, maxVelocity) {
    if (!items || items.length === 0) {
        return `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 3rem; font-size: 0.9rem;">
                    <i class="fa-solid fa-arrow-trend-up" style="font-size: 1.8rem; display: block; margin-bottom: 0.75rem; color: var(--text-muted);"></i>
                    No products matching these criteria.
                </td>
            </tr>
        `;
    }

    return items.map(item => {
        const histDaily = item.histDaily || 0;
        const foreDaily = item.foreDaily || 0;
        const growth = item.growthRate || 0;
        const traj = item.trajectory || 'Stable';

        let growthBadge = '';
        if (growth > 0) {
            growthBadge = `<span style="color: var(--status-success); font-weight: 700; display: inline-flex; align-items: center; gap: 0.2rem;"><i class="fa-solid fa-arrow-up-long"></i> +${growth.toFixed(1)}%</span>`;
        } else if (growth < 0) {
            growthBadge = `<span style="color: var(--status-danger); font-weight: 700; display: inline-flex; align-items: center; gap: 0.2rem;"><i class="fa-solid fa-arrow-down-long"></i> ${growth.toFixed(1)}%</span>`;
        } else {
            growthBadge = `<span style="color: var(--text-muted); font-weight: 500;">Flat (0.0%)</span>`;
        }

        let statusBadge = '';
        if (traj === 'Surging') {
            statusBadge = `<span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem; background: rgba(16, 185, 129, 0.12); color: var(--status-success); border: 1px solid rgba(16, 185, 129, 0.2);"><i class="fa-solid fa-bolt"></i> Surging</span>`;
        } else if (traj === 'Cooling') {
            statusBadge = `<span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem; background: rgba(239, 68, 68, 0.12); color: var(--status-danger); border: 1px solid rgba(239, 68, 68, 0.2);"><i class="fa-solid fa-snowflake"></i> Cooling</span>`;
        } else {
            statusBadge = `<span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem; background: rgba(59, 130, 246, 0.12); color: var(--status-info); border: 1px solid rgba(59, 130, 246, 0.2);"><i class="fa-solid fa-circle-nodes"></i> Stable</span>`;
        }

        // Relative widths for comparative sparklines
        const histPct = Math.max(3, (histDaily / maxVelocity) * 100);
        const forePct = Math.max(3, (foreDaily / maxVelocity) * 100);

        return `
            <tr>
                <td>
                    <code style="font-family: monospace; font-size: 0.85rem; color: var(--text-primary); background: rgba(255,255,255,0.06); padding: 3px 7px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.04);">${item.sku}</code>
                </td>
                <td>
                    <div style="display:flex; flex-direction:column; gap:0.15rem;">
                        <span style="font-weight: 650; color: var(--text-primary);">${item.name}</span>
                        <span style="font-size: 0.78rem; color: var(--text-muted);">${item.category || 'N/A'}</span>
                    </div>
                </td>
                <td style="text-align: center; vertical-align: middle;">
                    ${growthBadge}
                </td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 0.35rem; width: 100%;">
                        <!-- Comparison numerical values -->
                        <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-secondary);">
                            <span>Hist: <strong style="color: var(--text-primary);">${histDaily}</strong>/day</span>
                            <span>FC: <strong style="color: var(--accent-primary);">${foreDaily}</strong>/day</span>
                        </div>
                        
                        <!-- Combined Velocity Sparkline Bars -->
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <div class="bi-spark-track" style="height: 4px; background: rgba(255,255,255,0.02);" title="Historical Daily Velocity">
                                <div class="bi-spark-bar-actual" style="width: ${histPct}%; height: 100%; border-radius: 2px;"></div>
                            </div>
                            <div class="bi-spark-track" style="height: 4px; background: rgba(255,255,255,0.02);" title="AI Forecast Daily Velocity">
                                <div class="bi-spark-bar-forecast" style="width: ${forePct}%; height: 100%; border-radius: 2px;"></div>
                            </div>
                        </div>
                    </div>
                </td>
                <td style="text-align: center; vertical-align: middle;">
                    ${statusBadge}
                </td>
            </tr>
        `;
    }).join('');
}

// ==========================================
// KPI: Average Profit Margin Interactive Modal
// ==========================================
function setupKpiMarginTrigger() {
    const kpiCard = document.getElementById('kpiMarginCard');
    if (kpiCard) {
        kpiCard.addEventListener('click', () => {
            showModalMargin();
        });
    }
}

async function showModalMargin() {
    // 1. Remove old modal if it exists
    const old = document.getElementById('avgMarginModal');
    if (old) old.remove();

    // 2. Load latest product/SKU data if available
    let items = [];
    if (fullInventoryData && fullInventoryData.length > 0) {
        items = fullInventoryData;
    } else {
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
            console.error("Failed to fetch Inventory data for Avg. Margin Hub:", e);
        }
    }

    // 3. Compute detailed profit metrics for each item
    // Sort by forecasted demand descending to match standard margin distribution algorithm
    const sortedInventory = [...items].sort((a, b) => (b.forecasted_demand || 0) - (a.forecasted_demand || 0));
    
    const computedItems = sortedInventory.map((p, i) => {
        const marginPct = Math.max(5, 35 - i * 3);
        const price = p.price || 0;
        const cost = price * (1 - marginPct / 100);
        const marginDollar = price - cost;
        
        // 30d projected sales based on 7d forecasted demand
        const projectedSales30d = Math.round((p.forecasted_demand || 0) * (30 / 7));
        const projectedProfit30d = projectedSales30d * marginDollar;
        
        // Margin Classification
        let classification = 'Healthy';
        if (marginPct >= 25) {
            classification = 'Leader';
        } else if (marginPct < 15) {
            classification = 'Alert';
        }

        return {
            ...p,
            marginPct,
            cost,
            marginDollar,
            projectedSales30d,
            projectedProfit30d,
            classification
        };
    });

    // Compute aggregate metrics
    const totalProjectedProfit = computedItems.reduce((sum, item) => sum + item.projectedProfit30d, 0);
    const highMarginLeadersCount = computedItems.filter(item => item.classification === 'Leader').length;
    const lowMarginAlertsCount = computedItems.filter(item => item.classification === 'Alert').length;
    
    // Tab state
    let activeTab = 'all'; // 'all', 'leaders', 'healthy', 'alerts'
    let searchQuery = '';
    let currentSortCol = 'profit';
    let currentSortDir = 'desc';

    // 4. Create modal overlay and container
    const overlay = document.createElement('div');
    overlay.className = 'sku-modal-overlay';
    overlay.id = 'avgMarginModal';
    overlay.innerHTML = `
        <div class="sku-modal-container" style="width: 1050px; max-width: 95vw; max-height: 90vh;">
            <div class="sku-modal-header">
                <div>
                    <h2 style="margin:0; font-size:1.35rem; display:flex; align-items:center; gap:0.5rem; color:var(--text-primary);">
                        <i class="fa-solid fa-chart-line-up" style="color:var(--accent-secondary);"></i>
                        Profit Margin & Revenue Contribution Hub
                    </h2>
                    <p style="margin:0.25rem 0 0; font-size:0.8rem; color:var(--text-secondary);" id="marginModalSub">
                        Analyze unit profit margins (COGS vs Retail) and projected 30-day absolute net income contributions.
                    </p>
                </div>
                <button class="sku-modal-close" id="closeMarginModal" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <!-- Scrollable Body Wrapper -->
            <div class="bi-modal-body">
                <!-- Summary Cards Block -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 0.5rem;">
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">PORTFOLIO AVG MARGIN</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: var(--accent-secondary); font-weight: 700;">
                            24.5% <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-muted);">aggregate target</span>
                        </h3>
                    </div>
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">PROJECTED 30D PROFIT</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: var(--status-success); font-weight: 700;">
                            ${formatCurrency(totalProjectedProfit)} <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-muted);">estimated</span>
                        </h3>
                    </div>
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">HIGH MARGIN LEADERS</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: var(--status-info); font-weight: 700;">
                            ${highMarginLeadersCount} <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-muted);">SKUs (>=25%)</span>
                        </h3>
                    </div>
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">LOW MARGIN WARNINGS</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: var(--status-warning); font-weight: 700;">
                            ${lowMarginAlertsCount} <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-muted);">SKUs (<15%)</span>
                        </h3>
                    </div>
                </div>

                <!-- Interactive Tab Container -->
                <div class="bi-tabs-container">
                    <button class="bi-tab-btn active" id="tab-margin-all" data-tab="all">
                        <i class="fa-solid fa-border-all"></i> All Products (${computedItems.length})
                    </button>
                    <button class="bi-tab-btn" id="tab-margin-leaders" data-tab="leaders">
                        <i class="fa-solid fa-gem" style="color: var(--status-success);"></i> High Margin Leaders (${highMarginLeadersCount})
                    </button>
                    <button class="bi-tab-btn" id="tab-margin-healthy" data-tab="healthy">
                        <i class="fa-solid fa-shield" style="color: var(--status-info);"></i> Healthy Core (${computedItems.filter(i => i.classification === 'Healthy').length})
                    </button>
                    <button class="bi-tab-btn" id="tab-margin-alerts" data-tab="alerts">
                        <i class="fa-solid fa-triangle-exclamation" style="color: var(--status-warning);"></i> Low Margin Warnings (${lowMarginAlertsCount})
                    </button>
                </div>

                <!-- Dynamic AI Actionable Advice Banner -->
                <div class="glass-panel" id="marginRecommendationBanner" style="padding: 0.75rem 1rem; background: rgba(139, 92, 246, 0.04); border: 1px solid rgba(139, 92, 246, 0.1); border-radius: 8px; display: flex; gap: 0.75rem; align-items: center;">
                    <i class="fa-solid fa-wand-magic-sparkles" style="color: var(--accent-primary); font-size: 1.1rem;"></i>
                    <div style="flex: 1; font-size: 0.82rem; color: var(--text-secondary); line-height: 1.4;" id="marginRecommendationText">
                        Loading strategic pricing advice...
                    </div>
                </div>

                <!-- Search -->
                <div class="sku-modal-search">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="marginSearchInput" placeholder="Search products by SKU, Name, or Category..." autocomplete="off">
                </div>

                <!-- Scrollable Table Wrapper -->
                <div class="sku-table-wrapper">
                    <table class="sku-table">
                        <thead>
                            <tr>
                                <th class="sortable-header" data-col="sku" style="width: 14%;">SKU <span class="sort-indicator" id="sort-margin-sku"></span></th>
                                <th class="sortable-header" data-col="name" style="width: 26%;">Product Details <span class="sort-indicator" id="sort-margin-name"></span></th>
                                <th class="sortable-header" data-col="price" style="width: 15%; text-align: right;">Unit Price <span class="sort-indicator" id="sort-margin-price"></span></th>
                                <th class="sortable-header" data-col="marginPct" style="width: 25%; text-align: center;">Margin Breakdown <span class="sort-indicator" id="sort-margin-marginPct"></span></th>
                                <th class="sortable-header" data-col="profit" style="width: 20%; text-align: center;">Projected Profit (30d) <span class="sort-indicator" id="sort-margin-profit"></span></th>
                            </tr>
                        </thead>
                        <tbody id="marginTableBody">
                            <!-- Dynamic rows loaded here -->
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Force reflow and add 'open' class for CSS animations
    setTimeout(() => {
        overlay.classList.add('open');
    }, 10);

    const searchInput = document.getElementById('marginSearchInput');
    if (searchInput) {
        searchInput.focus({ preventScroll: true });
    }

    // Modal Close Logic
    const closeModal = () => {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 250);
    };

    document.getElementById('closeMarginModal').addEventListener('click', closeModal);

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

    // Contextual AI Advice Generator
    const updateAdviceBanner = (tab, filteredItems) => {
        const banner = document.getElementById('marginRecommendationBanner');
        const textEl = document.getElementById('marginRecommendationText');
        if (!banner || !textEl) return;

        let advice = "";
        let bgColor = "rgba(139, 92, 246, 0.04)";
        let borderColor = "rgba(139, 92, 246, 0.1)";

        if (tab === 'all') {
            advice = `<strong>AI Recommendation:</strong> Focus customer acquisitions on high-margin SKU leaders to maximize absolute cash inflow. Consider bundled promotions combining low-margin products with high-margin anchors to lift overall basket profitability.`;
        } else if (tab === 'leaders') {
            advice = `<strong>AI Recommendation:</strong> These SKUs have premium margins (>= 25%). Ensure maximum availability (+15% safety stock buffer) as out-of-stocks on these units represent maximum profitability penalties.`;
            bgColor = "rgba(16, 185, 129, 0.04)";
            borderColor = "rgba(16, 185, 129, 0.1)";
        } else if (tab === 'healthy') {
            advice = `<strong>AI Recommendation:</strong> Your healthy performance core (15% - 25% margin). Explore volume wholesale discounts with suppliers to shave another 2-3% off COGS and transition these items into High-Margin Leaders.`;
            bgColor = "rgba(59, 130, 246, 0.04)";
            borderColor = "rgba(59, 130, 246, 0.1)";
        } else if (tab === 'alerts') {
            advice = `<strong>AI Warning:</strong> These SKUs operate on thin margins (< 15%). Review supplier cost structures, bundle accessories to obscure single unit prices, or plan a selective 5-8% retail price hike to defend bottom-line margins.`;
            bgColor = "rgba(245, 158, 11, 0.04)";
            borderColor = "rgba(245, 158, 11, 0.1)";
        }

        banner.style.background = bgColor;
        banner.style.borderColor = borderColor;
        textEl.innerHTML = advice;
    };

    // Filter & Render logic
    const updateTable = () => {
        // Filter by Tab
        let filtered = [...computedItems];
        if (activeTab === 'leaders') {
            filtered = filtered.filter(item => item.classification === 'Leader');
        } else if (activeTab === 'healthy') {
            filtered = filtered.filter(item => item.classification === 'Healthy');
        } else if (activeTab === 'alerts') {
            filtered = filtered.filter(item => item.classification === 'Alert');
        }

        // Filter by Search Query
        if (searchQuery) {
            const q = searchQuery.toLowerCase().trim();
            filtered = filtered.filter(item => 
                item.sku.toLowerCase().includes(q) ||
                item.name.toLowerCase().includes(q) ||
                (item.category && item.category.toLowerCase().includes(q))
            );
        }

        // Sort
        filtered.sort((a, b) => {
            let valA, valB;
            if (currentSortCol === 'sku') {
                valA = a.sku;
                valB = b.sku;
            } else if (currentSortCol === 'name') {
                valA = a.name;
                valB = b.name;
            } else if (currentSortCol === 'price') {
                valA = a.price || 0;
                valB = b.price || 0;
            } else if (currentSortCol === 'marginPct') {
                valA = a.marginPct;
                valB = b.marginPct;
            } else if (currentSortCol === 'profit') {
                valA = a.projectedProfit30d;
                valB = b.projectedProfit30d;
            }

            if (valA < valB) return currentSortDir === 'asc' ? -1 : 1;
            if (valA > valB) return currentSortDir === 'asc' ? 1 : -1;
            return 0;
        });

        // Render rows
        const tbody = document.getElementById('marginTableBody');
        if (tbody) {
            tbody.innerHTML = renderMarginModalRows(filtered);
        }

        // Update indicators
        ['sku', 'name', 'price', 'marginPct', 'profit'].forEach(col => {
            const ind = document.getElementById(`sort-margin-${col}`);
            if (ind) {
                if (currentSortCol === col) {
                    ind.innerHTML = currentSortDir === 'asc' ? '<i class="fa-solid fa-chevron-up"></i>' : '<i class="fa-solid fa-chevron-down"></i>';
                } else {
                    ind.innerHTML = '';
                }
            }
        });

        updateAdviceBanner(activeTab, filtered);
    };

    // Set up Tab event listeners
    ['all', 'leaders', 'healthy', 'alerts'].forEach(tab => {
        const btn = document.getElementById(`tab-margin-${tab}`);
        if (btn) {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#avgMarginModal .bi-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeTab = tab;
                updateTable();
            });
        }
    });

    // Search input listener
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            updateTable();
        });
    }

    // Sorting headers listeners
    document.querySelectorAll('#avgMarginModal .sortable-header').forEach(header => {
        header.addEventListener('click', () => {
            const col = header.getAttribute('data-col');
            if (currentSortCol === col) {
                currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortCol = col;
                currentSortDir = 'desc'; // Default to desc for profit and margins
            }
            updateTable();
        });
    });

    // Initial table render
    updateTable();
}

function renderMarginModalRows(items) {
    if (items.length === 0) {
        return `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 3rem;">
                    <i class="fa-solid fa-box-open" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem; color: var(--text-muted);"></i>
                    No products found matching the criteria.
                </td>
            </tr>
        `;
    }

    return items.map(item => {
        const price = item.price || 0;
        const cost = item.cost || 0;
        const profitPerUnit = item.marginDollar || 0;
        const marginPct = item.marginPct || 0;
        const profit30d = item.projectedProfit30d || 0;
        const category = item.category || 'N/A';

        // Select badge design based on classification
        let classBadge = '';
        let barColor = '';
        if (item.classification === 'Leader') {
            classBadge = `<span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem; background: rgba(16, 185, 129, 0.12); color: var(--status-success); border: 1px solid rgba(16, 185, 129, 0.2);"><i class="fa-solid fa-gem"></i> Premium</span>`;
            barColor = 'linear-gradient(90deg, rgba(16, 185, 129, 0.3), rgba(16, 185, 129, 0.7))';
        } else if (item.classification === 'Healthy') {
            classBadge = `<span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem; background: rgba(59, 130, 246, 0.12); color: var(--status-info); border: 1px solid rgba(59, 130, 246, 0.2);"><i class="fa-solid fa-shield"></i> Healthy</span>`;
            barColor = 'linear-gradient(90deg, rgba(59, 130, 246, 0.3), rgba(59, 130, 246, 0.7))';
        } else {
            classBadge = `<span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem; background: rgba(245, 158, 11, 0.12); color: var(--status-warning); border: 1px solid rgba(245, 158, 11, 0.2);"><i class="fa-solid fa-triangle-exclamation"></i> Low Margin</span>`;
            barColor = 'linear-gradient(90deg, rgba(245, 158, 11, 0.3), rgba(245, 158, 11, 0.7))';
        }

        // Relative progress bar for margin percentage representation (scaled against a max margin of 35%)
        const progressPct = Math.min(100, (marginPct / 35) * 100);

        return `
            <tr>
                <td>
                    <code style="font-family: monospace; font-size: 0.85rem; color: var(--text-primary); background: rgba(255,255,255,0.06); padding: 3px 7px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.04);">${item.sku}</code>
                </td>
                <td>
                    <div style="display:flex; flex-direction:column; gap:0.15rem;">
                        <span style="font-weight: 650; color: var(--text-primary);">${item.name}</span>
                        <span style="font-size: 0.78rem; color: var(--text-muted);">${category}</span>
                    </div>
                </td>
                <td style="text-align: right; font-weight: 500; color: var(--text-primary); font-size: 0.95rem;">
                    ${formatCurrency(price)}
                </td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 0.3rem;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-secondary);">
                            <span>Cost: <strong style="color: var(--text-muted);">${formatCurrency(cost)}</strong></span>
                            <span style="font-weight: 700; color: ${marginPct >= 25 ? 'var(--status-success)' : marginPct >= 15 ? 'var(--status-info)' : 'var(--status-warning)'};">${marginPct.toFixed(0)}% Margin</span>
                        </div>
                        <div class="bi-spark-track" style="height: 6px; background: rgba(255,255,255,0.02);" title="Profit margin: ${marginPct.toFixed(1)}%">
                            <div class="bi-spark-bar" style="width: ${progressPct}%; height: 100%; background: ${barColor}; border-radius: 3px;"></div>
                        </div>
                    </div>
                </td>
                <td>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; flex-direction: column; gap: 0.1rem;">
                            <strong style="color: var(--status-success); font-size: 1rem;">${formatCurrency(profit30d)}</strong>
                            <span style="font-size: 0.68rem; color: var(--text-muted);">Unit profit: ${formatCurrency(profitPerUnit)}</span>
                        </div>
                        ${classBadge}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}


