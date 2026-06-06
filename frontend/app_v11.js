
// ──────────────────────────────────────────────────────────────────────────────
// showConfirm — custom async confirm dialog (replaces native browser confirm())
// Usage: showConfirm(message, onConfirm, { title, icon, variant, confirmLabel })
// variant: 'danger' (default) | 'warn' | 'info'
// ──────────────────────────────────────────────────────────────────────────────
function showConfirm(message, onConfirm, opts) {
    opts = opts || {};
    const overlay   = document.getElementById('customConfirmOverlay');
    const iconWrap  = document.getElementById('customConfirmIconWrap');
    const iconEl    = document.getElementById('customConfirmIcon');
    const titleEl   = document.getElementById('customConfirmTitle');
    const msgEl     = document.getElementById('customConfirmMessage');
    const okBtn     = document.getElementById('customConfirmOk');
    const cancelBtn = document.getElementById('customConfirmCancel');
    if (!overlay) { if (onConfirm && confirm(message)) onConfirm(); return; }

    const variant  = opts.variant || 'danger';
    const iconMap  = { danger: 'fa-triangle-exclamation', warn: 'fa-circle-exclamation', info: 'fa-circle-question' };

    titleEl.textContent = opts.title || 'Are you sure?';
    msgEl.textContent   = message;
    okBtn.textContent   = opts.confirmLabel || 'Confirm';

    iconWrap.className  = 'custom-confirm-icon-wrap' + (variant !== 'danger' ? ' ' + variant : '');
    iconEl.className    = 'fa-solid ' + (iconMap[variant] || iconMap.danger);
    okBtn.className     = 'custom-confirm-ok' + (variant === 'warn' ? ' btn-warn' : variant === 'info' ? ' btn-info' : '');

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    function close() {
        overlay.classList.remove('open');
        document.body.style.overflow = '';
        okBtn.removeEventListener('click', handleOk);
        cancelBtn.removeEventListener('click', handleCancel);
        overlay.removeEventListener('click', handleBackdrop);
    }
    function handleOk()        { close(); if (onConfirm) onConfirm(); }
    function handleCancel()    { close(); }
    function handleBackdrop(e) { if (e.target === overlay) close(); }

    okBtn.addEventListener('click',     handleOk,       { once: true });
    cancelBtn.addEventListener('click', handleCancel,   { once: true });
    overlay.addEventListener('click',   handleBackdrop);
}

/**
 * StockSense AI Frontend Logic
 * Handles dynamic rendering of insights, SHAP drivers, and Chart.js initialization.
 */

let forecastChartInstance = null;
let forecastChartYAxisInstance = null;

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
let scheduledPromoIds = new Set();
let selectedInventorySKUs = new Set();

document.addEventListener('DOMContentLoaded', () => {
    // 0. Initialize Authentication
    initAuth();

    // 1. Initialize PO modal listeners
    initPoModal();

    // 2. Initialize the Forecast Chart
    initChart();
    initChartControls();

    // 3. Setup CSV Upload Listener (also restores cached data if CSV was uploaded before)
    setupCsvUpload();

    // 4. Initialize Search Filtering
    initSearch();

    // 5. Initialize Notifications
    initNotifications();

    // 5b. Initialize Theme Toggle
    initThemeToggle();

    // 6. Setup Navigation
    setupNavigation();

    // 7. Initialize Chat
    initChat();
    initHelpChat();

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

    // 12. Setup Unified KPI Overview Card Trigger
    setupUnifiedKpiCardTrigger();
    setupKpiDailyVsForecastTrigger();
    setupKpiCashFlowTrigger();
    setupKpiDemandTrendTrigger();
    setupKpiMarginTrigger();
    setupKpiNextEventTrigger();

    // 13. Setup View All Toggles for BI boxes
    setupBIMetricsToggles();

    // 14. Initialize Drag-to-Scroll swipe behavior for AI Promotional Planner Suggestions deck
    initPromoDragToScroll();


    // 10. If no CSV has been uploaded, show a clean empty state
    //     Otherwise, fetchDefaultInsight is skipped — cached data is restored in setupCsvUpload
    if (checkAuth()) {
        loadScheduledPromotions();
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
let inventoryChangesPending = localStorage.getItem('stockSense_inventoryChangesPending') === 'true';

function updateSyncButtonVisibility() {
    const syncBtn = document.getElementById('inventorySyncBtn');
    if (!syncBtn) return;
    syncBtn.style.display = inventoryChangesPending ? 'inline-flex' : 'none';
}

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
        if (forecastChartYAxisInstance) {
            forecastChartYAxisInstance.options.scales.y.min = undefined;
            forecastChartYAxisInstance.options.scales.y.max = undefined;
            forecastChartYAxisInstance.update();
        }
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
    const promoScrollIndicator = document.getElementById('promo-scroll-indicator');
    if (promoScrollIndicator) {
        promoScrollIndicator.style.display = 'none';
    }

    // Reset View All toggles and hide buttons
    _showAllTimeline = false;
    _showAllDrivers = false;
    _activeBIMetrics = null;
    const toggleTimelineBtn = document.getElementById('toggle-all-timeline');
    if (toggleTimelineBtn) toggleTimelineBtn.style.display = 'none';
    const toggleDriversBtn = document.getElementById('toggle-all-drivers');
    if (toggleDriversBtn) toggleDriversBtn.style.display = 'none';
    // Reset Inventory Stock Health metrics
    updateInventoryMetrics([]);
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
    const navFinancials = document.getElementById('navFinancials');
    const navInsights = document.getElementById('navInsights');
    const navSettings = document.getElementById('navSettings');

    const dashboardView = document.getElementById('dashboardView');
    const inventoryView = document.getElementById('inventoryView');
    const financialsView = document.getElementById('financialsView');
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
        if (financialsView) financialsView.style.display = 'none';
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

        // Hide floating help chatbot widget on insights view, show it otherwise
        const aiHelpContainer = document.getElementById('aiHelpContainer');
        if (aiHelpContainer) {
            aiHelpContainer.style.display = (view === 'insights') ? 'none' : 'block';
            if (view === 'insights') {
                const aiHelpPanel = document.getElementById('aiHelpPanel');
                if (aiHelpPanel) aiHelpPanel.style.display = 'none';
            }
        }

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

        // Show footer on AI Insights chat view just like other pages
        const footer = document.querySelector('.app-footer');
        if (footer) {
            footer.style.display = 'block';
        }

        if (view === 'dashboard') {
            navDashboard.classList.add('active');
            dashboardView.style.display = 'flex';
        } else if (view === 'inventory') {
            navInventory.classList.add('active');
            inventoryView.style.display = 'flex';
            const tbody = document.getElementById('inventoryTableBody');
            if (tbody.children.length === 0) loadInventoryData();
            loadPoLedger(); // Persistently sync and load PO ledger
        } else if (view === 'financials') {
            if (navFinancials) navFinancials.classList.add('active');
            if (financialsView) financialsView.style.display = 'flex';
            loadFinancialsData();
        } else if (view === 'insights') {
            navInsights.classList.add('active');
            insightsView.style.display = 'flex';
            if (typeof updateInsightsCockpitMetrics === 'function') {
                updateInsightsCockpitMetrics();
            }
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

    window.switchView = switchView;

    // Restore last active view from localStorage
    const savedView = localStorage.getItem('stockSense_activeView') || 'dashboard';
    currentView = null; // reset to null to force switchView execution
    switchView(savedView);

    navDashboard.addEventListener('click', (e) => { e.preventDefault(); switchView('dashboard'); });
    navInventory.addEventListener('click', (e) => { e.preventDefault(); switchView('inventory'); });
    if (navFinancials) navFinancials.addEventListener('click', (e) => { e.preventDefault(); switchView('financials'); });
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
    const token = localStorage.getItem('stockSense_jwt');
    if (!token) return;

    const tbody = document.getElementById('inventoryTableBody');
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading inventory...</td></tr>';
    
    try {
        const response = await fetch('/api/inventory', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.status === 401) {
            localStorage.removeItem('stockSense_storeName');
            localStorage.removeItem('stockSense_jwt');
            localStorage.removeItem('stockSense_industry');
            localStorage.removeItem('stockSense_avatarUrl');
            window.location.reload();
            return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const result = await response.json();
        if (result.status === 'success' && result.data) {
            fullInventoryData = result.data;
            currentInventoryContext = result.data;
            filterAndSortInventory();
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
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color: var(--status-danger);">Failed to load inventory. Please log in again.</td></tr>';
    }
}

async function loadInventorySilent() {
    const token = localStorage.getItem('stockSense_jwt');
    if (!token) return;

    try {
        const response = await fetch('/api/inventory', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.status === 401) {
            localStorage.removeItem('stockSense_storeName');
            localStorage.removeItem('stockSense_jwt');
            localStorage.removeItem('stockSense_industry');
            localStorage.removeItem('stockSense_avatarUrl');
            window.location.reload();
            return;
        }
        if (response.ok) {
            const result = await response.json();
            if (result.status === 'success' && result.data) {
                fullInventoryData = result.data;
                currentInventoryContext = result.data;
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

let gridSortField = null;
let gridSortOrder = 'asc';
let gridSearchQuery = '';
let gridCapsuleFilter = 'all';
let currentInventoryPage = 1;
const itemsPerPage = 15;
let currentFilteredData = [];

function highlightText(text, query) {
    if (!text) return '';
    const textStr = String(text);
    if (!query) return textStr;
    const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return textStr.replace(regex, '<mark class="highlight-match">$1</mark>');
}

function filterAndSortInventory() {
    let processed = [...fullInventoryData];

    // 1. Apply Capsule Filter (All, Low Stock, Out of Stock, High Value/Capital)
    if (gridCapsuleFilter === 'low-stock') {
        processed = processed.filter(item => item.status === 'Low Stock');
    } else if (gridCapsuleFilter === 'out-of-stock') {
        processed = processed.filter(item => item.status === 'Out of Stock');
    } else if (gridCapsuleFilter === 'high-value') {
        // High Capital value = stock * price >= 100,000 BDT or equivalent
        processed = processed.filter(item => (item.stock * item.price) >= 100000);
    }

    // 2. Apply Dropdown Filters
    const category = document.getElementById('filterCategory')?.value || 'all';
    const status = document.getElementById('filterStatus')?.value || 'all';

    if (category !== 'all') {
        processed = processed.filter(item => item.category === category);
    }
    if (status !== 'all') {
        processed = processed.filter(item => item.status === status);
    }

    // 3. Apply Text Search (Sku, Name, Category)
    if (gridSearchQuery) {
        const query = gridSearchQuery.toLowerCase().trim();
        processed = processed.filter(item => 
            (item.name && item.name.toLowerCase().includes(query)) ||
            (item.sku && item.sku.toLowerCase().includes(query)) ||
            (item.category && item.category.toLowerCase().includes(query))
        );
    }

    // 4. Apply Header Column Sorting
    if (gridSortField) {
        processed.sort((a, b) => {
            let valA = a[gridSortField];
            let valB = b[gridSortField];

            // Normalize missing or undefined values
            if (valA === undefined || valA === null) valA = '';
            if (valB === undefined || valB === null) valB = '';

            // Handle numbers vs strings
            const isNumA = typeof valA === 'number';
            const isNumB = typeof valB === 'number';

            if (isNumA && isNumB) {
                return gridSortOrder === 'asc' ? valA - valB : valB - valA;
            } else {
                // Case-insensitive string comparison
                const strA = String(valA).toLowerCase();
                const strB = String(valB).toLowerCase();
                if (strA < strB) return gridSortOrder === 'asc' ? -1 : 1;
                if (strA > strB) return gridSortOrder === 'asc' ? 1 : -1;
                return 0;
            }
        });
    }

    // 5. Update sort chevrons in the table headers (DOM manipulation)
    document.querySelectorAll('.sortable-header').forEach(th => {
        const field = th.getAttribute('data-sort');
        th.classList.remove('sorted-asc', 'sorted-desc');
        const icon = th.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-sort'; // Reset icon
        
        if (field === gridSortField) {
            th.classList.add(gridSortOrder === 'asc' ? 'sorted-asc' : 'sorted-desc');
            if (icon) {
                icon.className = gridSortOrder === 'asc' ? 'fa-solid fa-caret-up' : 'fa-solid fa-caret-down';
            }
        }
    });

    // 6. Finally, render the processed table on page 1
    renderInventoryTable(processed, 1);
}

function renderInventoryTable(data, page = 1) {
    currentFilteredData = data;
    currentInventoryPage = page;
    
    // Dynamically calculate and update stock health metrics
    updateInventoryMetrics(fullInventoryData);
    
    const tbody = document.getElementById('inventoryTableBody');
    const badge = document.getElementById('inventoryCountBadge');
    
    tbody.innerHTML = '';
    badge.innerText = data.length;

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color: var(--text-muted); padding: 2rem;">No products match your filters.</td></tr>';
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

        // Apply real-time search string highlighting
        const highlightedSku = highlightText(item.sku, gridSearchQuery);
        const highlightedName = highlightText(item.name, gridSearchQuery);

        const isChecked = selectedInventorySKUs.has(item.sku) ? 'checked' : '';

        tr.innerHTML = `
            <td style="text-align: center; vertical-align: middle;" onclick="event.stopPropagation()">
                <input type="checkbox" class="inventory-select-row" data-sku="${item.sku}" data-name="${item.name.replace(/'/g, "\\'")}" data-stock="${item.stock}" style="cursor: pointer;" ${isChecked}>
            </td>
            <td style="color: var(--text-muted); font-family: monospace; font-size: 0.8rem;">${highlightedSku}</td>
            <td>
                <div class="product-cell">
                    <div class="product-icon"><i class="fa-solid ${icon}"></i></div>
                    <div class="product-details">
                        <span class="product-name">${highlightedName}</span>
                        <span class="product-category">${item.category}</span>
                    </div>
                </div>
            </td>
            <td style="font-weight: 500;">${price}</td>
            <td>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-weight: 600; font-size: 0.92rem;">${item.stock}</span>
                    <span style="color: var(--text-muted); font-size: 0.75rem;">units</span>
                </div>
            </td>
            <td style="color: var(--text-secondary);">${reorderPt}</td>
            <td style="color: var(--text-secondary);">${leadDays}d</td>
            <td style="color: var(--accent-primary); font-weight: 600;">${forecastDemand !== '—' ? forecastDemand + ' units' : '—'}</td>
            <td style="white-space: nowrap;"><span class="status-pill ${statusClass}">${item.status}</span></td>
            <td style="white-space: nowrap;">
                ${(item.status === 'Low Stock' || item.status === 'Out of Stock') ? `
                    <button class="primary-btn action-draft-po" data-sku="${item.sku}" data-name="${item.name.replace(/'/g, "\\'")}" data-stock="${item.stock}" title="Draft Purchase Order" style="padding: 0 0.65rem; height: 32px; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 0.35rem; white-space: nowrap;">
                        <i class="fa-solid fa-file-invoice"></i> Draft PO
                    </button>
                ` : `<span style="color: var(--text-muted); font-size: 0.85rem; padding-left: 0.5rem;">—</span>`}
            </td>
            <td style="text-align: center; white-space: nowrap;">
                <button class="icon-btn action-delete" data-sku="${item.sku}" title="Delete SKU ${item.sku}" style="color: var(--status-danger); width: 32px; height: 32px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); display: inline-flex; align-items: center; justify-content: center; vertical-align: middle;">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </td>
        `;
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (e) => {
            if (e.target.closest('.action-delete') || e.target.closest('.action-draft-po') || e.target.closest('button') || e.target.closest('input[type="checkbox"]')) {
                return;
            }
            openTelemetryDrawer(item);
        });

        tbody.appendChild(tr);
    });

    // Attach row checkbox select listeners
    document.querySelectorAll('.inventory-select-row').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const sku = e.currentTarget.getAttribute('data-sku');
            if (e.currentTarget.checked) {
                selectedInventorySKUs.add(sku);
            } else {
                selectedInventorySKUs.delete(sku);
            }
            updateSelectAllCheckboxState();
            updateConsolidatedPoButtonState();
        });
    });

    // Attach draft PO listeners
    document.querySelectorAll('.action-draft-po').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const sku = e.currentTarget.getAttribute('data-sku');
            const name = e.currentTarget.getAttribute('data-name');
            const stock = parseInt(e.currentTarget.getAttribute('data-stock')) || 0;
            openDraftPO([sku], name, stock);
        });
    });

    // Attach delete listeners
    document.querySelectorAll('.action-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const sku = e.currentTarget.getAttribute('data-sku');
            showConfirm(`Are you sure you want to delete SKU ${sku}?`, async () => {
                try {
                    const token = localStorage.getItem('stockSense_jwt');
                    const res = await fetch(`/api/inventory/${encodeURIComponent(sku)}`, { 
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const data = await res.json();
                    if (data.status === 'success') {
                        addNotification('Item Deleted', `Successfully removed ${sku} from inventory.`, 'success');
                        inventoryChangesPending = true;
                        localStorage.setItem('stockSense_inventoryChangesPending', 'true');
                        updateSyncButtonVisibility();
                        loadInventoryData();
                    } else {
                        addNotification('Delete Failed', data.message || 'Could not delete item.', 'warning');
                    }
                } catch (error) {
                    console.error("Delete failed:", error);
                }
            });
        });
    });

    renderPagination(data.length, page);
    updateSelectAllCheckboxState();
    updateConsolidatedPoButtonState();
}

function updateInventoryMetrics(items) {
    const healthIndexEl = document.getElementById('inv-health-index');
    const healthSubEl = document.getElementById('inv-health-sub');
    const outOfStockEl = document.getElementById('inv-out-of-stock');
    const outOfStockSubEl = document.getElementById('inv-out-of-stock-sub');
    const deadCapitalEl = document.getElementById('inv-dead-capital');
    const deadSkusEl = document.getElementById('inv-dead-skus');
    const reorderUrgencyEl = document.getElementById('inv-reorder-urgency');
    const reorderSubEl = document.getElementById('inv-reorder-sub');

    if (!healthIndexEl || !outOfStockEl || !deadCapitalEl || !reorderUrgencyEl) return;

    const dataset = (items && items.length > 0) ? items : (fullInventoryData || []);

    if (dataset.length === 0) {
        healthIndexEl.textContent = '0%';
        healthSubEl.textContent = 'Awaiting catalog data';
        outOfStockEl.textContent = '0';
        outOfStockSubEl.textContent = 'Catalog is empty';
        deadCapitalEl.textContent = formatCurrency(0);
        deadSkusEl.textContent = '0 inactive SKUs';
        reorderUrgencyEl.textContent = '0';
        reorderSubEl.textContent = '0 SKUs require attention';
        return;
    }

    let inStockCount = 0;
    let outOfStockCount = 0;
    let deadStockCapitalWholesale = 0;
    let deadStockSkus = 0;
    let reorderUrgencyCount = 0;

    dataset.forEach(item => {
        const stock = parseInt(item.stock) || 0;
        const reorderPt = parseInt(item.reorder_point) || 0;
        const price = parseFloat(item.price) || 0;
        const forecast = parseFloat(item.forecasted_demand) || 0;
        const status = item.status;

        // 1. Stock Health Status count
        if (status === 'In Stock' || stock > reorderPt) {
            inStockCount++;
        }

        // 2. Out of Stock count
        if (stock === 0 || status === 'Out of Stock') {
            outOfStockCount++;
        }

        // 3. Dead Stock (Forecast demand is 0, but physical stock is > 0)
        if (forecast === 0 && stock > 0) {
            deadStockSkus++;
            deadStockCapitalWholesale += stock * price * 0.7; // default 30% margin
        }

        // 4. Reorder Urgency Index (Low Stock or Out of Stock)
        if (status === 'Low Stock' || status === 'Out of Stock' || stock <= reorderPt) {
            reorderUrgencyCount++;
        }
    });

    // Compute Health Index
    const healthIndex = Math.round((inStockCount / dataset.length) * 100);
    healthIndexEl.textContent = `${healthIndex}%`;
    healthSubEl.textContent = `${inStockCount} of ${dataset.length} SKUs fully stocked`;

    // Out of Stock Display
    outOfStockEl.textContent = outOfStockCount;
    outOfStockSubEl.textContent = outOfStockCount > 0 
        ? `${outOfStockCount} critical stockouts active` 
        : 'All SKUs currently active';

    // Dead Stock Display
    deadCapitalEl.textContent = formatCurrency(deadStockCapitalWholesale);
    deadSkusEl.textContent = `${deadStockSkus} inactive product${deadStockSkus === 1 ? '' : 's'}`;

    // Reorder Urgency Display
    reorderUrgencyEl.textContent = reorderUrgencyCount;
    reorderSubEl.textContent = reorderUrgencyCount > 0
        ? `${reorderUrgencyCount} product${reorderUrgencyCount === 1 ? ' requires' : 's require'} reordering`
        : 'No immediate reorders needed';
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
    const chatPane = document.querySelector('#insightsView .chat-pane');
    const isChatViewActive = chatPane && document.getElementById('insightsView').style.display !== 'none';
    const container = isChatViewActive ? chatPane : document.body;

    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'stocksense-toast';
        toast.style.cssText = [
            isChatViewActive ? 'position:absolute' : 'position:fixed', 'bottom:2rem', 'left:50%',
            'transform:translateX(-50%) translateY(20px)',
            'background:var(--glass-bg)', 'backdrop-filter:blur(20px)',
            'border:1px solid rgba(255,255,255,0.1)', 'border-radius:12px',
            'padding:0.85rem 1.5rem', 'font-size:0.9rem', 'font-weight:500',
            'color:var(--text-primary)', 'z-index:99999', 'opacity:0',
            'transition:all 0.3s ease', 'box-shadow:0 8px 32px rgba(0,0,0,0.4)',
            'display:flex', 'align-items:center', 'gap:0.75rem', 'max-width:380px'
        ].join(';');
        container.appendChild(toast);
    } else {
        if (toast.parentElement !== container) {
            toast.style.position = isChatViewActive ? 'absolute' : 'fixed';
            container.appendChild(toast);
        }
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
                inventoryChangesPending = true;
                localStorage.setItem('stockSense_inventoryChangesPending', 'true');
                updateSyncButtonVisibility();
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

async function reforecastFromInventory() {
    const syncBtn = document.getElementById('inventorySyncBtn');
    if (!syncBtn) return;

    const hasCSV = !!localStorage.getItem('stockSense_uploadedFile');
    if (!hasCSV) {
        addNotification(
            'Sync Delayed',
            'No sales history CSV uploaded yet. Please upload a CSV file on the dashboard first.',
            'warning'
        );
        return;
    }

    const originalHTML = syncBtn.innerHTML;
    syncBtn.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> Updating AI...';
    syncBtn.disabled = true;

    try {
        const token = localStorage.getItem('stockSense_jwt');
        const strategy = localStorage.getItem('stockSense_cfgStrategy') || 'balanced';
        const dl = localStorage.getItem('stockSense_cfgDL') !== 'false';
        const region = localStorage.getItem('stockSense_cfgRegion') || 'BD';

        const response = await fetch(`/api/predict?strategy=${strategy}&deep_learning=${dl}&region=${region}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const detail = errData.detail || 'Prediction failed';
            throw new Error(typeof detail === 'string' ? detail : (detail.message || 'Prediction failed'));
        }

        const data = await response.json();

        if (data.status === 'success') {
            inventoryChangesPending = false;
            localStorage.removeItem('stockSense_inventoryChangesPending');
            updateSyncButtonVisibility();

            // Update chart title with actual forecast horizon from server
            const chartTitle = document.getElementById('forecastChartTitle');
            if (chartTitle && data.forecast_label) {
                chartTitle.textContent = `Demand Forecast — ${data.forecast_label} (${data.data_span_days} days of data)`;
            }

            // Cache the full result so it survives page refreshes
            localStorage.setItem('stockSense_lastResult', JSON.stringify({
                historical:  data.historical,
                forecast:    data.forecast,
                insight:     data.insight,
                drivers:     data.drivers,
                kpis:        data.kpis,
                bi_metrics:  data.bi_metrics,
                promo_suggestions: data.promo_suggestions,
                holidays:    data.holidays
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

            // Auto-refresh the inventory table from the DB
            loadInventoryData();
            
            const productCount = data.products ? data.products.length : 0;
            
            addNotification(
                'AI Demand Forecast Updated',
                `Successfully re-calculated demand for all active SKUs in your inventory.`,
                'success'
            );
        } else {
            addNotification('Update Failed', data.message || 'Could not update forecasting.', 'warning');
        }
    } catch (error) {
        console.error("Reforecast sync failed:", error);
        addNotification(
            'Sync Error',
            error.message || 'Failed to update forecast from inventory data.',
            'error'
        );
    } finally {
        syncBtn.innerHTML = originalHTML;
        syncBtn.disabled = false;
    }
}

function initInventoryActions() {

    const filterBtn = document.getElementById('inventoryFilterBtn');
    const downloadBtn = document.getElementById('inventoryDownloadBtn');
    const dropdown = document.getElementById('inventoryFilterDropdown');
    const applyBtn = document.getElementById('applyFilters');
    const resetBtn = document.getElementById('resetFilters');
    const addBtn = document.getElementById('inventoryAddBtn');
    const syncBtn = document.getElementById('inventorySyncBtn');
    const consPoBtn = document.getElementById('createConsolidatedPoBtn');
    const selectAllCb = document.getElementById('selectAllInventory');

    if (syncBtn) {
        syncBtn.addEventListener('click', () => reforecastFromInventory());
        updateSyncButtonVisibility();
    }

    if (consPoBtn) {
        consPoBtn.addEventListener('click', () => {
            if (selectedInventorySKUs.size === 0) return;
            openDraftPO(Array.from(selectedInventorySKUs));
        });
    }

    if (selectAllCb) {
        selectAllCb.addEventListener('change', (e) => {
            const checked = e.currentTarget.checked;
            const pageCbs = document.querySelectorAll('.inventory-select-row');
            
            pageCbs.forEach(cb => {
                const sku = cb.getAttribute('data-sku');
                cb.checked = checked;
                if (checked) {
                    selectedInventorySKUs.add(sku);
                } else {
                    selectedInventorySKUs.delete(sku);
                }
            });
            updateConsolidatedPoButtonState();
        });
    }

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

    // Live Search Listening
    const searchInput = document.getElementById('inventorySearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            gridSearchQuery = e.target.value;
            filterAndSortInventory();
        });
    }

    // Capsule Filter Buttons Listening
    document.querySelectorAll('.capsule-filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.capsule-filter-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            gridCapsuleFilter = e.currentTarget.getAttribute('data-filter');
            filterAndSortInventory();
        });
    });

    // Column Header Sorting Triggers Listening
    document.querySelectorAll('.sortable-header').forEach(th => {
        th.addEventListener('click', (e) => {
            const field = e.currentTarget.getAttribute('data-sort');
            if (gridSortField === field) {
                if (gridSortOrder === 'asc') {
                    gridSortOrder = 'desc';
                } else {
                    gridSortField = null;
                    gridSortOrder = 'asc';
                }
            } else {
                gridSortField = field;
                gridSortOrder = 'asc';
            }
            filterAndSortInventory();
        });
    });

    // Apply Dropdown Filters
    applyBtn.addEventListener('click', () => {
        filterAndSortInventory();
        dropdown.style.display = 'none';
        addNotification('Filters Applied', 'Custom grid options compiled successfully.', 'info');
    });

    // Reset All Grid Filters
    resetBtn.addEventListener('click', () => {
        document.getElementById('filterCategory').value = 'all';
        document.getElementById('filterStatus').value = 'all';
        
        // Reset interactive grid states
        gridSearchQuery = '';
        if (searchInput) searchInput.value = '';
        
        gridCapsuleFilter = 'all';
        document.querySelectorAll('.capsule-filter-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-filter') === 'all') btn.classList.add('active');
        });
        
        gridSortField = null;
        gridSortOrder = 'asc';
        
        filterAndSortInventory();
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
let chatSessions = [];
let currentSessionId = null;

function initChat() {
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('sendChatBtn');
    
    if (!input || !btn) return;

    // Live check — reads localStorage every call so it always reflects current upload state
    const isFileUploaded = () => !!localStorage.getItem('stockSense_uploadedFile');

    // Apply initial UI state based on upload status
    const applyInputState = () => {
        const uploaded = isFileUploaded();
        input.disabled = !uploaded;
        input.placeholder = uploaded
            ? "Ask about sales, reorders, or type '/' for quick commands..."
            : "Upload a CSV on the dashboard to enable chat...";
        btn.disabled = !uploaded;
        btn.style.opacity = uploaded ? '1' : '0.5';
        btn.style.cursor = uploaded ? 'pointer' : 'not-allowed';
    };
    applyInputState();

    // Re-check state whenever localStorage changes (e.g. CSV uploaded in another tab)
    window.addEventListener('storage', (e) => {
        if (e.key === 'stockSense_uploadedFile') {
            applyInputState();
            loadChatHistory();
        }
    });

    btn.addEventListener('click', () => {
        if (!isFileUploaded()) return;
        sendChatMessage();
    });
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            if (!isFileUploaded()) return;
            sendChatMessage();
        }
    });

    // Suggestion chip click → populate input & submit
    document.querySelectorAll('.chat-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            if (!isFileUploaded()) {
                showToast('Please upload a CSV file to query the AI assistant', 'warning');
                return;
            }
            const question = chip.getAttribute('data-q');
            if (!question) return;
            input.value = question;
            input.focus();
            sendChatMessage();
        });
    });

    // Toggle Slash Commands Dropdown
    const slashBtn = document.getElementById('slashCommandsBtn');
    const slashDropdown = document.getElementById('slashCommandsDropdown');
    if (slashBtn && slashDropdown) {
        slashBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isFileUploaded()) {
                showToast('Please upload a CSV file to use quick commands', 'warning');
                return;
            }
            slashDropdown.style.display = slashDropdown.style.display === 'none' ? 'block' : 'none';
        });
        
        // Command item selection
        document.querySelectorAll('#slashCommandsDropdown .dropdown-item').forEach(item => {
            item.addEventListener('click', () => {
                if (!isFileUploaded()) return;
                const cmd = item.getAttribute('data-cmd');
                input.value = cmd;
                slashDropdown.style.display = 'none';
                input.focus();
                sendChatMessage();
            });
        });
        
        // Hide on click outside
        document.addEventListener('click', (e) => {
            if (!slashBtn.contains(e.target) && !slashDropdown.contains(e.target)) {
                slashDropdown.style.display = 'none';
            }
        });
    }

    // Capture slash command keystroke / in input
    input.addEventListener('input', (e) => {
        if (input.value === '/') {
            if (slashDropdown && isFileUploaded()) slashDropdown.style.display = 'block';
        }
    });

    // Wire up Clear Chat button
    const clearChatBtn = document.getElementById('clearChatBtn');
    if (clearChatBtn) {
        if (!isFileUploaded()) {
            clearChatBtn.disabled = true;
            clearChatBtn.style.opacity = '0.5';
            clearChatBtn.style.cursor = 'not-allowed';
        } else {
            clearChatBtn.disabled = false;
            clearChatBtn.style.opacity = '1';
            clearChatBtn.style.cursor = 'pointer';
            clearChatBtn.addEventListener('click', async () => {
                showConfirm('Clear your entire chat history? This cannot be undone.', async () => {
                    await clearChatHistoryFrontend();
                }, { title: 'Clear Chat History', variant: 'danger', confirmLabel: 'Clear All' });
            });
        }
    }

    // Wire up strategy selectors
    const strategyButtons = ['chatStrategyConservative', 'chatStrategyBalanced', 'chatStrategyAggressive'];
    const cachedStrategy = localStorage.getItem('stockSense_cfgStrategy') || 'balanced';
    
    strategyButtons.forEach(bId => {
        const btnEl = document.getElementById(bId);
        if (!btnEl) return;
        btnEl.classList.remove('active');
        if (btnEl.getAttribute('data-strategy') === cachedStrategy) {
            btnEl.classList.add('active');
        }
    });

    strategyButtons.forEach(id => {
        const btnEl = document.getElementById(id);
        if (!btnEl) return;
        btnEl.addEventListener('click', () => {
            strategyButtons.forEach(bId => document.getElementById(bId)?.classList.remove('active'));
            btnEl.classList.add('active');
            const strat = btnEl.getAttribute('data-strategy');
            localStorage.setItem('stockSense_cfgStrategy', strat);
            
            // Sync with Settings dropdown
            const settingsSelect = document.getElementById('settingStrategy');
            if (settingsSelect) settingsSelect.value = strat;
            
            // Toast notification
            showToast(`AI Strategy Engine updated to: ${strat.charAt(0).toUpperCase() + strat.slice(1)}`, 'success');
        });
    });
    
    // ─── Sidebar Strategy Panel (opens upward from sidebar footer) ────────
    const sidebarStrategyBtn   = document.getElementById('sidebarStrategyBtn');
    const sidebarStrategyPanel = document.getElementById('sidebarStrategyPanel');

    if (sidebarStrategyBtn && sidebarStrategyPanel) {
        sidebarStrategyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = sidebarStrategyPanel.classList.toggle('open');
            sidebarStrategyBtn.classList.toggle('active', isOpen);
        });

        // Close panel when a strategy is chosen
        sidebarStrategyPanel.querySelectorAll('.strategy-option-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                sidebarStrategyPanel.classList.remove('open');
                sidebarStrategyBtn.classList.remove('active');
            });
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!sidebarStrategyBtn.contains(e.target) && !sidebarStrategyPanel.contains(e.target)) {
                sidebarStrategyPanel.classList.remove('open');
                sidebarStrategyBtn.classList.remove('active');
            }
        });
    }

    // ─── Archive Modal ────────────────────────────────────────────────────
    const sidebarArchiveBtn    = document.getElementById('sidebarArchiveBtn');
    const archiveModalOverlay  = document.getElementById('archiveModalOverlay');
    const archiveModalClose    = document.getElementById('archiveModalClose');
    const archiveModalBody     = document.getElementById('archiveModalBody');

    function renderArchiveModal() {
        if (!archiveModalBody) return;
        const archived = JSON.parse(localStorage.getItem('stockSense_archivedChats') || '[]');
        if (archived.length === 0) {
            archiveModalBody.innerHTML = `<div class="chat-modal-empty"><i class="fa-solid fa-box-archive"></i>No archived chats yet.</div>`;
            return;
        }
        archiveModalBody.innerHTML = '';
        archived.forEach(sess => {
            const d = new Date(sess.archivedAt || sess.timestamp || Date.now());
            const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const row = document.createElement('div');
            row.className = 'chat-modal-item';
            row.innerHTML = `
                <div class="chat-modal-item-icon"><i class="fa-regular fa-comment"></i></div>
                <div class="chat-modal-item-info">
                    <div class="chat-modal-item-title">${sess.title || 'Untitled'}</div>
                    <div class="chat-modal-item-date">Archived ${dateStr}</div>
                </div>
                <div class="chat-modal-item-actions">
                    <button class="chat-modal-action-btn restore" data-id="${sess.id}"><i class="fa-solid fa-rotate-left"></i> Restore</button>
                </div>`;
            row.querySelector('.restore').addEventListener('click', () => {
                const list = JSON.parse(localStorage.getItem('stockSense_archivedChats') || '[]');
                const idx = list.findIndex(s => s.id === sess.id);
                if (idx !== -1) {
                    const [restored] = list.splice(idx, 1);
                    delete restored.archived;
                    delete restored.archivedAt;
                    chatSessions.unshift(restored);
                    localStorage.setItem('stockSense_archivedChats', JSON.stringify(list));
                    localStorage.setItem('stockSense_chatSessions', JSON.stringify(chatSessions));
                    renderSessionsList();
                    renderArchiveModal();
                    showToast('Chat restored', 'success');
                }
            });
            archiveModalBody.appendChild(row);
        });
    }

    if (sidebarArchiveBtn && archiveModalOverlay) {
        sidebarArchiveBtn.addEventListener('click', () => {
            renderArchiveModal();
            archiveModalOverlay.classList.add('open');
        });
        archiveModalClose?.addEventListener('click', () => archiveModalOverlay.classList.remove('open'));
        archiveModalOverlay.addEventListener('click', (e) => {
            if (e.target === archiveModalOverlay) archiveModalOverlay.classList.remove('open');
        });
    }

    // ─── Trash Modal ──────────────────────────────────────────────────────
    const sidebarTrashBtn    = document.getElementById('sidebarTrashBtn');
    const trashModalOverlay  = document.getElementById('trashModalOverlay');
    const trashModalClose    = document.getElementById('trashModalClose');
    const trashModalBody     = document.getElementById('trashModalBody');

    function renderTrashModal() {
        if (!trashModalBody) return;
        const deleted = JSON.parse(localStorage.getItem('stockSense_deletedChats') || '[]');
        if (deleted.length === 0) {
            trashModalBody.innerHTML = `<div class="chat-modal-empty"><i class="fa-solid fa-trash-can"></i>No deleted chats.</div>`;
            return;
        }
        trashModalBody.innerHTML = '';
        deleted.forEach(sess => {
            const d = new Date(sess.deletedAt || Date.now());
            const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const row = document.createElement('div');
            row.className = 'chat-modal-item';
            row.innerHTML = `
                <div class="chat-modal-item-icon"><i class="fa-regular fa-comment"></i></div>
                <div class="chat-modal-item-info">
                    <div class="chat-modal-item-title">${sess.title || 'Untitled'}</div>
                    <div class="chat-modal-item-date">Deleted ${dateStr}</div>
                </div>
                <div class="chat-modal-item-actions">
                    <button class="chat-modal-action-btn restore"      data-id="${sess.id}"><i class="fa-solid fa-rotate-left"></i> Restore</button>
                    <button class="chat-modal-action-btn perm-delete"  data-id="${sess.id}"><i class="fa-solid fa-trash-can"></i> Delete</button>
                </div>`;

            row.querySelector('.restore').addEventListener('click', () => {
                let list = JSON.parse(localStorage.getItem('stockSense_deletedChats') || '[]');
                const idx = list.findIndex(s => s.id === sess.id);
                if (idx !== -1) {
                    const [restored] = list.splice(idx, 1);
                    delete restored.deletedAt;
                    chatSessions.unshift(restored);
                    localStorage.setItem('stockSense_deletedChats', JSON.stringify(list));
                    localStorage.setItem('stockSense_chatSessions', JSON.stringify(chatSessions));
                    renderSessionsList();
                    renderTrashModal();
                    showToast('Chat restored', 'success');
                }
            });

            row.querySelector('.perm-delete').addEventListener('click', () => {
                showConfirm('Permanently delete this chat? This cannot be undone.', () => {
                    let list = JSON.parse(localStorage.getItem('stockSense_deletedChats') || '[]');
                    list = list.filter(s => s.id !== sess.id);
                    localStorage.setItem('stockSense_deletedChats', JSON.stringify(list));
                    renderTrashModal();
                    showToast('Chat permanently deleted', 'success');
                }, { title: 'Delete Forever', variant: 'danger', confirmLabel: 'Delete' });
            });

            trashModalBody.appendChild(row);
        });
    }

    if (sidebarTrashBtn && trashModalOverlay) {
        sidebarTrashBtn.addEventListener('click', () => {
            renderTrashModal();
            trashModalOverlay.classList.add('open');
        });
        trashModalClose?.addEventListener('click', () => trashModalOverlay.classList.remove('open'));
        trashModalOverlay.addEventListener('click', (e) => {
            if (e.target === trashModalOverlay) trashModalOverlay.classList.remove('open');
        });
    }

    // Wire up New Chat button
    const newChatBtn = document.getElementById('newChatBtn');
    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            if (!isFileUploaded()) {
                showToast('Please upload a CSV file to start a new chat', 'warning');
                return;
            }
            currentSessionId = null;
            chatHistory = [];
            renderChatHistory();
            renderSessionsList();
        });
    }

    // Wire up Search Chats input
    const searchChatsInput = document.getElementById('searchChatsInput');
    if (searchChatsInput) {
        searchChatsInput.addEventListener('input', () => {
            renderSessionsList();
        });
    }

    // ─── Sidebar: Collapse / Expand / Drag-Resize ──────────────────────────
    const mobileSidebarToggleBtn = document.getElementById('mobileSidebarToggleBtn');
    const sidebarCollapseBtn     = document.getElementById('sidebarCollapseBtn');
    const sidebarResizer         = document.getElementById('sidebarResizer');
    const chatSidebarOverlay     = document.getElementById('chatSidebarOverlay');
    const insightsLayoutGrid     = document.getElementById('insightsLayoutGrid');
    const chatSidebarEl          = insightsLayoutGrid
                                       ? insightsLayoutGrid.querySelector('.chat-sidebar')
                                       : null;

    // ── Sidebar width constants ──────────────────────────────────────────
    const SIDEBAR_MIN_W  = 160;   // px — minimum usable width
    const SIDEBAR_MAX_W  = 480;   // px — maximum width
    const SIDEBAR_DEF_W  = 260;   // px — default width

    // Restore last user-chosen width from localStorage
    const savedW = parseInt(localStorage.getItem('stockSense_sidebarWidth'), 10);
    if (chatSidebarEl && !isNaN(savedW) && savedW >= SIDEBAR_MIN_W && savedW <= SIDEBAR_MAX_W) {
        chatSidebarEl.style.width = savedW + 'px';
    }

    // ── Helpers: animated collapse / expand ─────────────────────────────
    function collapseSidebar() {
        if (!insightsLayoutGrid || !chatSidebarEl) return;
        // Cancel any in-progress expand, apply snappy ease-in collapse
        chatSidebarEl.classList.remove('sidebar-expanding');
        chatSidebarEl.classList.add('sidebar-collapsing');
        insightsLayoutGrid.classList.add('sidebar-collapsed');
        chatSidebarEl.addEventListener('transitionend', () => {
            chatSidebarEl.classList.remove('sidebar-collapsing');
        }, { once: true });
    }

    function expandSidebar() {
        if (!insightsLayoutGrid || !chatSidebarEl) return;
        // Cancel any in-progress collapse, apply smooth ease-out expand
        chatSidebarEl.classList.remove('sidebar-collapsing');
        chatSidebarEl.classList.add('sidebar-expanding');
        insightsLayoutGrid.classList.remove('sidebar-collapsed');
        chatSidebarEl.addEventListener('transitionend', () => {
            chatSidebarEl.classList.remove('sidebar-expanding');
        }, { once: true });
    }

    // ── Button: « (close icon inside the sidebar) ───────────────────────
    if (sidebarCollapseBtn && insightsLayoutGrid) {
        sidebarCollapseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.innerWidth <= 768) {
                insightsLayoutGrid.classList.remove('sidebar-open');
            } else {
                collapseSidebar();
            }
        });
    }

    // ── Button: ☰ (hamburger in chat header — re-opens on desktop) ──────
    if (mobileSidebarToggleBtn && insightsLayoutGrid) {
        mobileSidebarToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.innerWidth <= 768) {
                insightsLayoutGrid.classList.toggle('sidebar-open');
            } else {
                expandSidebar();
            }
        });
    }

    // ── Overlay backdrop (mobile) ────────────────────────────────────────
    if (chatSidebarOverlay && insightsLayoutGrid) {
        chatSidebarOverlay.addEventListener('click', () => {
            insightsLayoutGrid.classList.remove('sidebar-open');
        });
    }

    // ── Drag-to-resize ───────────────────────────────────────────────────
    if (sidebarResizer && chatSidebarEl && insightsLayoutGrid) {
        let isDragging = false;
        let startX     = 0;
        let startW     = 0;

        sidebarResizer.addEventListener('mousedown', (e) => {
            // Only on desktop and when sidebar is not collapsed
            if (window.innerWidth <= 768) return;
            if (insightsLayoutGrid.classList.contains('sidebar-collapsed')) return;

            isDragging = true;
            startX     = e.clientX;
            startW     = chatSidebarEl.getBoundingClientRect().width;

            sidebarResizer.classList.add('is-dragging');
            document.body.classList.add('sidebar-is-resizing');
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const delta  = e.clientX - startX;
            const newW   = Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, startW + delta));
            chatSidebarEl.style.width = newW + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            sidebarResizer.classList.remove('is-dragging');
            document.body.classList.remove('sidebar-is-resizing');
            // Persist chosen width
            const finalW = chatSidebarEl.getBoundingClientRect().width;
            localStorage.setItem('stockSense_sidebarWidth', Math.round(finalW));
        });

        // Touch support (tablets)
        sidebarResizer.addEventListener('touchstart', (e) => {
            if (window.innerWidth <= 768) return;
            isDragging = true;
            startX     = e.touches[0].clientX;
            startW     = chatSidebarEl.getBoundingClientRect().width;
            sidebarResizer.classList.add('is-dragging');
            document.body.classList.add('sidebar-is-resizing');
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            const delta = e.touches[0].clientX - startX;
            const newW  = Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, startW + delta));
            chatSidebarEl.style.width = newW + 'px';
        }, { passive: true });

        document.addEventListener('touchend', () => {
            if (!isDragging) return;
            isDragging = false;
            sidebarResizer.classList.remove('is-dragging');
            document.body.classList.remove('sidebar-is-resizing');
            const finalW = chatSidebarEl.getBoundingClientRect().width;
            localStorage.setItem('stockSense_sidebarWidth', Math.round(finalW));
        });
    }

    // Load existing history
    loadChatHistory();
}

async function loadChatHistory() {
    const hasUploadedFile = !!localStorage.getItem('stockSense_uploadedFile');
    if (!hasUploadedFile) {
        renderNoCsvState();
        return;
    }
    const token = localStorage.getItem('stockSense_jwt');
    if (!token) return;
    try {
        const storedSessions = localStorage.getItem('stockSense_chatSessions');
        if (storedSessions) {
            chatSessions = JSON.parse(storedSessions);
        } else {
            chatSessions = [];
        }
        
        if (chatSessions.length === 0) {
            const res = await fetch('/api/chat/history', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.status === 401) {
                localStorage.removeItem('stockSense_storeName');
                localStorage.removeItem('stockSense_jwt');
                localStorage.removeItem('stockSense_industry');
                localStorage.removeItem('stockSense_avatarUrl');
                window.location.reload();
                return;
            }
            const data = await res.json();
            if (data.status === 'success' && data.history && data.history.length > 0) {
                let initialTitle = "Restored chat";
                const firstUserMsg = data.history.find(m => m.role === 'user');
                if (firstUserMsg) {
                    initialTitle = firstUserMsg.content;
                    if (initialTitle.startsWith('/')) {
                        initialTitle = initialTitle.split(' ')[0];
                    }
                    if (initialTitle.length > 25) {
                        initialTitle = initialTitle.substring(0, 22) + '...';
                    }
                }
                const defaultSession = {
                    id: Date.now().toString(),
                    title: initialTitle,
                    messages: data.history,
                    timestamp: Date.now()
                };
                chatSessions.push(defaultSession);
                localStorage.setItem('stockSense_chatSessions', JSON.stringify(chatSessions));
                currentSessionId = defaultSession.id;
                chatHistory = defaultSession.messages;
            } else {
                currentSessionId = null;
                chatHistory = [];
            }
        } else {
            currentSessionId = chatSessions[0].id;
            chatHistory = chatSessions[0].messages;
        }
        
        renderChatHistory();
        renderSessionsList();
    } catch (e) {
        console.error("Failed to load chat history", e);
    }
}

function renderNoCsvState() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    // Hide suggestions chips
    const suggestionsEl = document.getElementById('chatSuggestions');
    if (suggestionsEl) suggestionsEl.style.display = 'none';

    // Style the parent container inline — beats ALL CSS
    Object.assign(chatMessages.style, {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        gap: '0',
        boxSizing: 'border-box'
    });

    chatMessages.innerHTML = '';

    // ── Outer wrapper ──────────────────────────────────────────
    const container = document.createElement('div');
    Object.assign(container.style, {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        maxWidth: '460px',
        animation: 'noCsvFadeIn 0.4s ease forwards'
    });

    // ── Card ───────────────────────────────────────────────────
    const card = document.createElement('div');
    Object.assign(card.style, {
        width: '100%',
        textAlign: 'center',
        boxSizing: 'border-box'
    });


    // ── Icon circle ────────────────────────────────────────────
    const iconWrap = document.createElement('div');
    Object.assign(iconWrap.style, {
        width: '72px',
        height: '72px',
        minWidth: '72px',
        borderRadius: '50%',
        background: 'linear-gradient(135deg,rgba(139,92,246,0.18),rgba(109,40,217,0.08))',
        border: '1px solid rgba(139,92,246,0.32)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 1.5rem',
        fontSize: '1.85rem',
        color: '#a78bfa',
        boxShadow: '0 8px 24px rgba(139,92,246,0.22)'
    });
    iconWrap.innerHTML = '<i class="fa-solid fa-lock"></i>';

    // ── Heading ────────────────────────────────────────────────
    const heading = document.createElement('h3');
    Object.assign(heading.style, {
        fontSize: '1.35rem',
        fontWeight: '700',
        color: '#f0f0f0',
        margin: '0 0 0.6rem 0',
        fontFamily: "'Outfit', sans-serif",
        letterSpacing: '-0.01em'
    });
    heading.textContent = 'Unlock AI Strategic Insights';

    // ── Subtitle ───────────────────────────────────────────────
    const subtitle = document.createElement('p');
    Object.assign(subtitle.style, {
        fontSize: '0.87rem',
        color: 'rgba(255,255,255,0.5)',
        lineHeight: '1.6',
        margin: '0 0 1.5rem 0'
    });
    subtitle.textContent = 'Upload your inventory CSV data on the dashboard to start chatting with StockSense AI. Our assistant can help you:';

    // ── Feature list ───────────────────────────────────────────
    const features = [
        'Identify stockout risks & replenishment needs',
        'Discover slow-moving items & dead stock',
        'Project weekly demand & optimize profit margins',
        'Create automated Purchase Orders in seconds'
    ];
    const ul = document.createElement('ul');
    Object.assign(ul.style, {
        listStyle: 'none',
        padding: '0',
        margin: '0 0 1.75rem 0',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.65rem'
    });
    features.forEach(text => {
        const li = document.createElement('li');
        Object.assign(li.style, {
            listStyle: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.55rem',
            fontSize: '0.84rem',
            color: 'rgba(255,255,255,0.55)',
            paddingLeft: '0'
        });
        li.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#34d399;font-size:0.85rem;flex-shrink:0"></i> ${text}`;
        ul.appendChild(li);
    });

    // ── Upload button ──────────────────────────────────────────
    const btn = document.createElement('button');
    Object.assign(btn.style, {
        width: '100%',
        height: '46px',
        fontSize: '0.9rem',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        cursor: 'pointer',
        background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)',
        border: 'none',
        borderRadius: '10px',
        color: '#fff',
        boxShadow: '0 4px 18px rgba(139,92,246,0.38)',
        transition: 'all 0.2s ease',
        letterSpacing: '0.01em',
        fontFamily: "'Outfit', sans-serif"
    });
    btn.innerHTML = '<i class="fa-solid fa-file-csv"></i> Upload CSV Data';
    btn.addEventListener('click', () => document.getElementById('csvFileInput').click());
    btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'translateY(-2px)';
        btn.style.boxShadow = '0 8px 24px rgba(139,92,246,0.52)';
    });
    btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'translateY(0)';
        btn.style.boxShadow = '0 4px 18px rgba(139,92,246,0.38)';
    });

    // ── Assemble ───────────────────────────────────────────────
    card.appendChild(iconWrap);
    card.appendChild(heading);
    card.appendChild(subtitle);
    card.appendChild(ul);
    card.appendChild(btn);
    container.appendChild(card);
    chatMessages.appendChild(container);

    // Clear the sessions sidebar
    const listContainer = document.getElementById('recentChatsList');
    if (listContainer) listContainer.innerHTML = '';
}

function clearNoCsvInlineStyles() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    chatMessages.style.alignItems = '';
    chatMessages.style.justifyContent = '';
    chatMessages.style.padding = '';
    chatMessages.style.gap = '';
    chatMessages.style.flexDirection = '';
}

function renderChatHistory() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    // Clear any inline styles set by renderNoCsvState
    clearNoCsvInlineStyles();

    // Hide standard suggestions chips container as we now use the welcome grid cards
    const suggestionsEl = document.getElementById('chatSuggestions');
    if (suggestionsEl) {
        suggestionsEl.style.display = 'none';
    }
    
    const hasUploadedFile = !!localStorage.getItem('stockSense_uploadedFile');
    if (!hasUploadedFile) {
        chatMessages.innerHTML = `<div class="chat-disabled-watermark"></div>`;
        return;
    }
    
    chatMessages.innerHTML = '';
    
    if (chatHistory.length <= 1) {
        // Welcome Screen Grid (ChatGPT Style)
        const welcomeDiv = document.createElement('div');
        welcomeDiv.className = 'chat-welcome-container';
        welcomeDiv.innerHTML = `
            <div class="welcome-logo">
                <img src="assets/logo/StockSense%20AI.svg" alt="StockSense Logo">
            </div>
            <h2>What can I help with?</h2>
            <div class="welcome-suggestions-grid">
                <div class="welcome-card" data-q="Which products are at risk of stockout this week?">
                    <div class="card-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
                    <div class="card-content">
                        <h4>Stockout risks</h4>
                        <p>Identify products at risk of running out of stock this week</p>
                    </div>
                </div>
                <div class="welcome-card" data-q="What are my top 5 revenue-driving products?">
                    <div class="card-icon"><i class="fa-solid fa-ranking-star"></i></div>
                    <div class="card-content">
                        <h4>Top revenue drivers</h4>
                        <p>Find your highest revenue-generating products</p>
                    </div>
                </div>
                <div class="welcome-card" data-q="Which items are slow-moving and tying up capital?">
                    <div class="card-icon"><i class="fa-solid fa-box"></i></div>
                    <div class="card-content">
                        <h4>Slow-moving stock</h4>
                        <p>Find products tying up capital in your warehouse</p>
                    </div>
                </div>
                <div class="welcome-card" data-q="What should I reorder immediately to avoid stockouts?">
                    <div class="card-icon"><i class="fa-solid fa-cart-plus"></i></div>
                    <div class="card-content">
                        <h4>Reorder now</h4>
                        <p>Determine items that need immediate replenishment</p>
                    </div>
                </div>
            </div>
        `;
        
        // Add click listeners to welcome cards
        welcomeDiv.querySelectorAll('.welcome-card').forEach(card => {
            card.addEventListener('click', () => {
                const question = card.getAttribute('data-q');
                if (!question) return;
                const input = document.getElementById('chatInput');
                if (input) {
                    input.value = question;
                    input.focus();
                    sendChatMessage();
                }
            });
        });
        
        chatMessages.appendChild(welcomeDiv);
    } else {
        // Standard chat messages
        chatHistory.forEach(msg => {
            const div = document.createElement('div');
            div.className = `message ${msg.role}`;
            const parsedContent = msg.role === 'assistant' ? parseChatMessageContent(msg.content) : msg.content.replace(/\n/g, '<br>');
            div.innerHTML = `<div class="msg-bubble">${parsedContent}</div>`;
            chatMessages.appendChild(div);
        });
    }
    
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderSessionsList() {
    const listContainer = document.getElementById('recentChatsList');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    const filterText = document.getElementById('searchChatsInput')?.value?.toLowerCase() || '';
    
    // Grouping sessions
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const sevenDaysAgoStart = todayStart - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgoStart = todayStart - 30 * 24 * 60 * 60 * 1000;
    
    const groups = {
        today: { title: 'Today', sessions: [] },
        yesterday: { title: 'Yesterday', sessions: [] },
        last7: { title: 'Previous 7 Days', sessions: [] },
        last30: { title: 'Last 30 Days', sessions: [] },
        older: { title: 'Older', sessions: [] }
    };
    
    chatSessions.forEach(session => {
        if (filterText && !session.title.toLowerCase().includes(filterText)) return;
        
        const ts = session.timestamp || Date.now();
        if (ts >= todayStart) {
            groups.today.sessions.push(session);
        } else if (ts >= yesterdayStart) {
            groups.yesterday.sessions.push(session);
        } else if (ts >= sevenDaysAgoStart) {
            groups.last7.sessions.push(session);
        } else if (ts >= thirtyDaysAgoStart) {
            groups.last30.sessions.push(session);
        } else {
            groups.older.sessions.push(session);
        }
    });
    
    const layoutGrid = document.getElementById('insightsLayoutGrid');
    
    Object.keys(groups).forEach(key => {
        const group = groups[key];
        if (group.sessions.length === 0) return;
        
        // Render group header
        const headerDiv = document.createElement('div');
        headerDiv.className = 'chat-sidebar-group-header';
        headerDiv.textContent = group.title;
        listContainer.appendChild(headerDiv);
        
        // Render sessions in group
        group.sessions.forEach(session => {
            const item = document.createElement('div');
            item.className = `recent-chat-item${session.id === currentSessionId ? ' active' : ''}${session.pinned ? ' pinned' : ''}`;

            const mainDiv = document.createElement('div');
            mainDiv.className = 'recent-chat-item-main';

            const icon = document.createElement('i');
            icon.className = session.pinned
                ? 'fa-solid fa-thumbtack recent-chat-item-icon pinned-icon'
                : 'fa-regular fa-comment recent-chat-item-icon';

            const titleSpan = document.createElement('span');
            titleSpan.className = 'recent-chat-item-title';
            titleSpan.textContent = session.title;

            mainDiv.appendChild(icon);
            mainDiv.appendChild(titleSpan);
            mainDiv.addEventListener('click', () => {
                switchSession(session.id);
                if (layoutGrid) layoutGrid.classList.remove('sidebar-open');
            });
            item.appendChild(mainDiv);

            // ⋯ Ellipsis button
            const moreBtn = document.createElement('button');
            moreBtn.type = 'button';
            moreBtn.className = 'recent-chat-item-more';
            moreBtn.title = 'More options';
            moreBtn.innerHTML = '<i class="fa-solid fa-ellipsis"></i>';

            moreBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close any other open menu
                document.querySelectorAll('.chat-item-menu.open').forEach(m => m.classList.remove('open'));

                const menu = item.querySelector('.chat-item-menu');
                if (menu) menu.classList.toggle('open');
            });

            item.appendChild(moreBtn);

            // Context dropdown menu
            const menu = document.createElement('div');
            menu.className = 'chat-item-menu';
            menu.innerHTML = `
                <button class="chat-item-menu-action" data-action="pin">
                    <i class="fa-solid fa-thumbtack"></i>
                    <span>${session.pinned ? 'Unpin chat' : 'Pin chat'}</span>
                </button>
                <button class="chat-item-menu-action" data-action="rename">
                    <i class="fa-solid fa-pen"></i>
                    <span>Rename</span>
                </button>
                <button class="chat-item-menu-action" data-action="archive">
                    <i class="fa-solid fa-box-archive"></i>
                    <span>Archive</span>
                </button>
                <div class="chat-item-menu-divider"></div>
                <button class="chat-item-menu-action danger" data-action="delete">
                    <i class="fa-solid fa-trash-can"></i>
                    <span>Delete</span>
                </button>
            `;

            menu.querySelectorAll('.chat-item-menu-action').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    menu.classList.remove('open');
                    const action = btn.getAttribute('data-action');
                    if (action === 'delete')   deleteChatSession(session.id);
                    if (action === 'rename')   renameChatSession(session.id);
                    if (action === 'archive')  archiveChatSession(session.id);
                    if (action === 'pin')      pinChatSession(session.id);
                });
            });

            item.appendChild(menu);
            listContainer.appendChild(item);
        });
    });

    // Global click → close all open menus
    document.addEventListener('click', () => {
        document.querySelectorAll('.chat-item-menu.open').forEach(m => m.classList.remove('open'));
    }, { once: false });
}

function switchSession(id) {
    currentSessionId = id;
    const activeSession = chatSessions.find(s => s.id === id);
    if (activeSession) {
        chatHistory = activeSession.messages;
        renderChatHistory();
        renderSessionsList();
    }
}

function createNewSession() {
    const newSession = {
        id: Date.now().toString(),
        title: "New chat",
        messages: [
            {
                role: "assistant",
                content: "Hello! I am StockSense AI. I've analyzed your current inventory and sales data. How can I help you optimize your business today?"
            }
        ],
        timestamp: Date.now()
    };
    chatSessions.unshift(newSession);
    currentSessionId = newSession.id;
    chatHistory = newSession.messages;
    localStorage.setItem('stockSense_chatSessions', JSON.stringify(chatSessions));
    renderChatHistory();
    renderSessionsList();
}

function deleteChatSession(id) {
    showConfirm('Are you sure you want to delete this conversation?', () => {
        _doDeleteChatSession(id);
    }, { title: 'Delete Conversation', variant: 'danger', confirmLabel: 'Delete' });
}
function _doDeleteChatSession(id) {

    // Save to deleted/trash list
    const session = chatSessions.find(s => s.id === id);
    if (session) {
        const deletedList = JSON.parse(localStorage.getItem('stockSense_deletedChats') || '[]');
        session.deletedAt = Date.now();
        deletedList.unshift(session);
        localStorage.setItem('stockSense_deletedChats', JSON.stringify(deletedList));
    }

    chatSessions = chatSessions.filter(s => s.id !== id);

    if (chatSessions.length === 0) {
        const initialSession = {
            id: Date.now().toString(),
            title: 'New chat',
            messages: [
                {
                    role: 'assistant',
                    content: "Hello! I am StockSense AI. I've analyzed your current inventory and sales data. How can I help you optimize your business today?"
                }
            ],
            timestamp: Date.now()
        };
        chatSessions.push(initialSession);
    }

    if (currentSessionId === id) {
        currentSessionId = chatSessions[0].id;
        chatHistory = chatSessions[0].messages;
    }

    localStorage.setItem('stockSense_chatSessions', JSON.stringify(chatSessions));
    renderChatHistory();
    renderSessionsList();
}

function renameChatSession(id) {
    const session = chatSessions.find(s => s.id === id);
    if (!session) return;
    const newName = prompt('Rename conversation:', session.title);
    if (!newName || !newName.trim()) return;
    session.title = newName.trim();
    localStorage.setItem('stockSense_chatSessions', JSON.stringify(chatSessions));
    renderSessionsList();
    showToast('Conversation renamed', 'success');
}

function archiveChatSession(id) {
    const session = chatSessions.find(s => s.id === id);
    if (!session) return;

    // Save to archived list
    const archivedList = JSON.parse(localStorage.getItem('stockSense_archivedChats') || '[]');
    session.archived = true;
    session.archivedAt = Date.now();
    archivedList.unshift(session);
    localStorage.setItem('stockSense_archivedChats', JSON.stringify(archivedList));

    // Remove from active sessions
    chatSessions = chatSessions.filter(s => s.id !== id);
    if (chatSessions.length === 0) {
        const newSess = { id: Date.now().toString(), title: 'New chat',
            messages: [{ role: 'assistant', content: "Hello! I am StockSense AI. How can I help you today?" }],
            timestamp: Date.now() };
        chatSessions.push(newSess);
    }
    if (currentSessionId === id) {
        currentSessionId = chatSessions[0].id;
        chatHistory = chatSessions[0].messages;
    }
    localStorage.setItem('stockSense_chatSessions', JSON.stringify(chatSessions));
    renderChatHistory();
    renderSessionsList();
    showToast('Conversation archived', 'success');
}

function pinChatSession(id) {
    const session = chatSessions.find(s => s.id === id);
    if (!session) return;
    session.pinned = !session.pinned;
    // Move pinned sessions to top
    chatSessions.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    localStorage.setItem('stockSense_chatSessions', JSON.stringify(chatSessions));
    renderSessionsList();
    showToast(session.pinned ? 'Chat pinned' : 'Chat unpinned', 'success');
}

async function clearChatHistorySilently() {
    const token = localStorage.getItem('stockSense_jwt');
    if (!token) return;
    try {
        await fetch('/api/chat/history', {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
    } catch (e) {
        console.warn("Failed to clear chat history silently on load:", e);
    }
    chatHistory = [];
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        chatMessages.innerHTML = '';
    }
}

async function clearChatHistoryFrontend() {
    const token = localStorage.getItem('stockSense_jwt');
    if (!token) return;
    try {
        const res = await fetch('/api/chat/history', {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.status === 'success') {
            chatSessions = [];
            localStorage.removeItem('stockSense_chatSessions');
            
            const initialSession = {
                id: Date.now().toString(),
                title: "New chat",
                messages: [
                    {
                        role: "assistant",
                        content: "Hello! I am StockSense AI. I've analyzed your current inventory and sales data. How can I help you optimize your business today?"
                    }
                ],
                timestamp: Date.now()
            };
            chatSessions.push(initialSession);
            currentSessionId = initialSession.id;
            chatHistory = initialSession.messages;
            localStorage.setItem('stockSense_chatSessions', JSON.stringify(chatSessions));
            
            renderChatHistory();
            renderSessionsList();
            
            addNotification('Chat Cleared', 'Your AI Strategic Assistant chat history has been successfully cleared.', 'success');
        } else {
            addNotification('Clear Failed', 'Could not clear chat history.', 'warning');
        }
    } catch (e) {
        console.error("Failed to clear chat history", e);
        addNotification('Network Error', 'Failed to connect to the server to clear chat history.', 'error');
    }
}

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    if (!currentSessionId) {
        const newSession = {
            id: Date.now().toString(),
            title: text.length > 25 ? text.substring(0, 22) + '...' : text,
            messages: [
                {
                    role: "assistant",
                    content: "Hello! I am StockSense AI. I've analyzed your current inventory and sales data. How can I help you optimize your business today?"
                }
            ],
            timestamp: Date.now()
        };
        chatSessions.unshift(newSession);
        currentSessionId = newSession.id;
        chatHistory = newSession.messages;
        localStorage.setItem('stockSense_chatSessions', JSON.stringify(chatSessions));
        renderSessionsList();
    }

    appendMessage('user', text);
    input.value = '';

    if (!currentInventoryContext) {
        currentInventoryContext = { info: "SME Electronics Store Inventory" };
    }

    try {
        const token = localStorage.getItem('stockSense_jwt');
        const currency = localStorage.getItem('stockSense_cfgCurrency') || 'BDT';
        const activeStrategy = localStorage.getItem('stockSense_cfgStrategy') || 'balanced';
        
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                message: text,
                history: chatHistory,
                inventory_context: currentInventoryContext,
                currency: currency,
                strategy: activeStrategy
            })
        });

        const result = await response.json();
        if (result.status === 'success') {
            appendMessage('assistant', result.response);
            chatHistory.push({ role: 'user', content: text });
            chatHistory.push({ role: 'assistant', content: result.response });
            
            const activeSession = chatSessions.find(s => s.id === currentSessionId);
            if (activeSession) {
                activeSession.messages = chatHistory;
                if (activeSession.title === "New chat" && chatHistory.length > 1) {
                    const firstUserMsg = chatHistory.find(m => m.role === 'user');
                    if (firstUserMsg) {
                        let cleanTitle = firstUserMsg.content;
                        if (cleanTitle.startsWith('/')) {
                            cleanTitle = cleanTitle.split(' ')[0];
                        }
                        if (cleanTitle.length > 25) {
                            cleanTitle = cleanTitle.substring(0, 22) + '...';
                        }
                        activeSession.title = cleanTitle;
                    }
                }
                activeSession.timestamp = Date.now();
                localStorage.setItem('stockSense_chatSessions', JSON.stringify(chatSessions));
                renderSessionsList();
            }
        }
    } catch (error) {
        console.error("Chat Error:", error);
        appendMessage('assistant', "I'm sorry, I encountered an error connecting to the AI server. Please try again.");
    }
}

function parseChatMessageContent(content) {
    if (!content) return '';
    
    let processed = content;
    
    // 1. Parse Markdown Tables
    const tableRegex = /\|([^\n]+)\|\r?\n\|[ :\-|\r?\n]+\|((?:\r?\n\|[^\n]+\|)+)/g;
    processed = processed.replace(tableRegex, (match) => {
        const rows = match.trim().split('\n');
        if (rows.length < 2) return match;
        
        let html = '<table><thead><tr>';
        
        // Parse Headers
        const headerParts = rows[0].split('|').map(h => h.trim()).filter((h, idx) => idx > 0 && idx < rows[0].split('|').length - 1);
        headerParts.forEach(h => {
            html += `<th>${h}</th>`;
        });
        html += '</tr></thead><tbody>';
        
        // Parse Body Rows (skip row 1 separator)
        for (let i = 2; i < rows.length; i++) {
            const cols = rows[i].split('|').map(c => c.trim()).filter((c, idx) => idx > 0 && idx < rows[i].split('|').length - 1);
            if (cols.length === 0) continue;
            html += '<tr>';
            cols.forEach(c => {
                html += `<td>${c}</td>`;
            });
            html += '</tr>';
        }
        
        html += '</tbody></table>';
        return html;
    });
    
    // 2. Parse [RESTOCK:sku|name|stock] tags into action cards
    const restockBlockRegex = /((?:\[RESTOCK:[^\]]+\]\r?\n?\s*)+)/g;
    processed = processed.replace(restockBlockRegex, (blockMatch) => {
        const restockRegex = /\[RESTOCK:([^|\]]+)\|([^|\]]+)\|([^\]]+)\]/g;
        let cardsHtml = '';
        blockMatch.replace(restockRegex, (match, sku, name, stock) => {
            const parsedStock = parseInt(stock) || 0;
            cardsHtml += `
            <div class="chat-restock-card">
                <div class="card-horizontal-content">
                    <span class="card-badge restock">Replenish Alert</span>
                    <span class="card-product-name" title="${name}">${name}</span>
                    <span class="card-sku">SKU: <code>${sku}</code></span>
                    <span class="card-separator">&bull;</span>
                    <span class="card-stock">Stock: <strong>${parsedStock.toLocaleString()}</strong></span>
                </div>
                <div class="card-action-pane">
                    <button type="button" class="primary-btn timeline-po-btn" style="padding: 0.35rem 0.75rem; font-size: 0.75rem; height: 30px; font-family: 'Outfit', sans-serif; display: flex; align-items: center; gap: 0.3rem; font-weight: 600; margin: 0;" onclick="window.openDraftPO('${sku}', '${name.replace(/'/g, "\\'")}', ${parsedStock})">
                        <i class="fa-solid fa-bolt"></i> Draft PO
                    </button>
                </div>
            </div>
            `;
            return '';
        });
        return `<div class="chat-cards-grid">${cardsHtml}</div>`;
    });
    
    // 3. Parse [PROMO:discount|sku|name|reason] tags into campaign recommendation chips
    const promoBlockRegex = /((?:\[PROMO:[^\]]+\]\r?\n?\s*)+)/g;
    processed = processed.replace(promoBlockRegex, (blockMatch) => {
        const promoRegex = /\[PROMO:([^|\]]+)\|([^|\]]+)\|([^|\]]+)\|([^\]]+)\]/g;
        let cardsHtml = '';
        blockMatch.replace(promoRegex, (match, discount, sku, name, reason) => {
            cardsHtml += `
            <div class="chat-promo-card">
                <div class="card-horizontal-content">
                    <span class="card-badge promo">${discount} Promo</span>
                    <span class="card-product-name" title="${name}">${name}</span>
                    <span class="card-sku">SKU: <code>${sku}</code></span>
                    <span class="card-separator">&bull;</span>
                    <span class="card-reason">${reason}</span>
                </div>
                <div class="card-action-pane">
                    <button type="button" class="primary-btn" style="padding: 0.35rem 0.75rem; font-size: 0.75rem; height: 30px; font-family: 'Outfit', sans-serif; display: flex; align-items: center; gap: 0.3rem; font-weight: 600; margin: 0; background: linear-gradient(135deg, var(--status-warning), #d97706); border-color: rgba(245,158,11,0.4);" onclick="switchView('dashboard'); setTimeout(() => { document.getElementById('promo-planner-section').scrollIntoView({ behavior: 'smooth' }); }, 500);">
                        <i class="fa-solid fa-calendar-plus"></i> View Planner
                    </button>
                </div>
            </div>
            `;
            return '';
        });
        return `<div class="chat-cards-grid">${cardsHtml}</div>`;
    });
    
    // Standard conversions
    processed = processed.replace(/\n/g, '<br>');
    processed = processed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    processed = processed.replace(/⚠️/g, '<i class="fa-solid fa-triangle-exclamation" style="color: var(--status-danger);"></i>');
    
    return processed;
}

function appendMessage(role, content) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    
    // If welcome screen is showing, clear it and render the default greeting bubble first
    if (chatMessages.querySelector('.chat-welcome-container')) {
        chatMessages.innerHTML = '';
        if (chatHistory.length > 0) {
            const firstMsg = chatHistory[0];
            const gDiv = document.createElement('div');
            gDiv.className = `message ${firstMsg.role}`;
            const parsedContent = firstMsg.role === 'assistant' ? parseChatMessageContent(firstMsg.content) : firstMsg.content;
            gDiv.innerHTML = `<div class="msg-bubble">${parsedContent}</div>`;
            chatMessages.appendChild(gDiv);
        }
    }
    
    const div = document.createElement('div');
    div.className = `message ${role}`;
    
    const parsedContent = role === 'assistant' ? parseChatMessageContent(content) : content.replace(/\n/g, '<br>');
    div.innerHTML = `<div class="msg-bubble">${parsedContent}</div>`;
    chatMessages.appendChild(div);
    
    if (role === 'user') {
        requestAnimationFrame(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        });
    } else if (role === 'assistant') {
        requestAnimationFrame(() => {
            const userMessages = chatMessages.querySelectorAll('.message.user');
            if (userMessages.length > 0) {
                const lastUserMsg = userMessages[userMessages.length - 1];
                chatMessages.scrollTop = lastUserMsg.offsetTop - 10;
            } else {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        });
    }
}

function updateInsightsCockpitMetrics() {
    const totalSkusEl = document.getElementById('chatMiniTotalSKUs');
    const lowStockEl = document.getElementById('chatMiniLowStock');
    const outStockEl = document.getElementById('chatMiniOutStock');
    const healthEl = document.getElementById('chatMiniHealth');
    
    if (!totalSkusEl || !currentInventoryContext || !Array.isArray(currentInventoryContext)) return;
    
    const total = currentInventoryContext.length;
    const low = currentInventoryContext.filter(i => i.status === 'Low Stock').length;
    const out = currentInventoryContext.filter(i => i.status === 'Out of Stock').length;
    const healthy = total - low - out;
    const healthPct = total > 0 ? Math.round((healthy / total) * 100) : 0;
    
    totalSkusEl.textContent = total.toLocaleString();
    lowStockEl.textContent = low.toLocaleString();
    outStockEl.textContent = out.toLocaleString();
    healthEl.textContent = `${healthPct}%`;
    
    if (healthPct >= 85) {
        healthEl.style.color = 'var(--status-success)';
    } else if (healthPct >= 60) {
        healthEl.style.color = 'var(--status-warning)';
    } else {
        healthEl.style.color = 'var(--status-danger)';
    }
}



function initSearch() {
    const searchInput = document.getElementById('dashboardSearch');
    const suggestionsPanel = document.getElementById('searchSuggestions');
    if (!searchInput || !suggestionsPanel) return;

    let activeSuggestionIndex = -1;
    let currentSuggestions = [];

    // Define dashboard searchable sections
    const dashboardKeywords = [
        { text: 'Total SKUs', elementId: 'kpiSKUsCard', category: 'Metric', icon: 'fa-layer-group', aliases: ['skus', 'sku count', 'total skus', 'products count'] },
        { text: 'Total Units', elementId: 'kpiTotalUnitsCard', category: 'Metric', icon: 'fa-box-open', aliases: ['units', 'total units', 'stock quantity', 'total stock'] },
        { text: 'Forecasted Demand', elementId: 'kpiForecastDemandCard', category: 'Metric', icon: 'fa-arrow-trend-up', aliases: ['forecasted demand', 'predictions', 'expected sales', 'future demand'] },
        { text: 'At-Risk Products', elementId: 'kpiAtRiskCard', category: 'Metric', icon: 'fa-cart-plus', aliases: ['at risk', 'stockouts', 'replenishment alert', 'low stock'] },
        { text: 'Inventory Health', elementId: 'kpiInventoryHealthCard', category: 'Metric', icon: 'fa-clock', aliases: ['inventory health', 'health score', 'reliability'] },
        { text: 'Demand Forecast Chart', elementId: 'demandForecastCard', category: 'Analytics', icon: 'fa-chart-line', aliases: ['demand forecast', 'forecast chart', 'prophet graph', 'forecast graph'] },
        { text: 'Top Demand Drivers (SHAP)', elementId: 'demandDriversCard', category: 'Analytics', icon: 'fa-brain', aliases: ['demand drivers', 'shap values', 'shap attribution', 'machine learning impact'] },
        { text: 'AI Insight Narrative', elementId: 'aiInsightCard', category: 'Co-Pilot', icon: 'fa-wand-magic-sparkles', aliases: ['ai insight', 'narrative report', 'co pilot insights', 'action items'] },
        { text: 'AI Promotional Planner', elementId: 'promo-planner-section', category: 'Optimizer', icon: 'fa-tags', aliases: ['promotional planner', 'weekly seasonality', 'holiday campaigns', 'promo recommendations'] }
    ];

    function showSuggestions(query) {
        suggestionsPanel.innerHTML = '';
        activeSuggestionIndex = -1;
        
        if (!query) {
            suggestionsPanel.style.display = 'none';
            currentSuggestions = [];
            return;
        }

        // Filter dashboard keywords
        const matchedKeywords = dashboardKeywords.filter(k => {
            return k.text.toLowerCase().includes(query) || 
                   k.aliases.some(alias => alias.toLowerCase().includes(query)) ||
                   k.category.toLowerCase().includes(query);
        });

        // Filter inventory products (max 4 suggestions to avoid list overflow)
        let matchedProducts = [];
        if (typeof fullInventoryData !== 'undefined' && fullInventoryData.length > 0) {
            matchedProducts = fullInventoryData.filter(item => {
                return (item.name && item.name.toLowerCase().includes(query)) ||
                       (item.sku && item.sku.toLowerCase().includes(query)) ||
                       (item.category && item.category.toLowerCase().includes(query));
            }).slice(0, 4).map(item => ({
                text: `${item.name} (${item.sku})`,
                elementId: 'inventoryTableContainer',
                category: 'Product',
                icon: 'fa-box',
                productName: item.name,
                sku: item.sku,
                isProduct: true
            }));
        }

        currentSuggestions = [...matchedKeywords, ...matchedProducts];

        if (currentSuggestions.length === 0) {
            suggestionsPanel.style.display = 'none';
            return;
        }

        currentSuggestions.forEach((s, idx) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'search-suggestion-item';
            if (s.isProduct) {
                itemDiv.innerHTML = `<i class="fa-solid ${s.icon}"></i> <span>${s.text}</span> <span class="suggestion-category product-badge">${s.category}</span>`;
            } else {
                itemDiv.innerHTML = `<i class="fa-solid ${s.icon}"></i> <span>${s.text}</span> <span class="suggestion-category">${s.category}</span>`;
            }

            itemDiv.addEventListener('click', () => selectSuggestion(s));
            suggestionsPanel.appendChild(itemDiv);
        });

        suggestionsPanel.style.display = 'flex';
    }

    function selectSuggestion(suggestion) {
        suggestionsPanel.style.display = 'none';
        searchInput.value = ''; // Clear search bar for clean UX after selecting suggestion

        if (suggestion.isProduct) {
            // Switch to inventory view
            const navInventory = document.getElementById('navInventory');
            if (navInventory) navInventory.click();

            // Perform filtering inside inventory table and sync search inputs
            const query = suggestion.productName;
            const searchInputEl = document.getElementById('inventorySearchInput');
            if (searchInputEl) searchInputEl.value = query;
            gridSearchQuery = query;
            filterAndSortInventory();

            // Scroll to the inventory table container
            setTimeout(() => {
                const tableContainer = document.querySelector('.inventory-table-container');
                if (tableContainer) {
                    tableContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Blink the table container twice with a premium glow
                    triggerGlowBlink(tableContainer);
                }
            }, 150);
        } else {
            // Scroll to section on the dashboard
            // Ensure we are on the dashboard
            const navDashboard = document.getElementById('navDashboard');
            if (navDashboard) navDashboard.click();

            const targetElement = document.getElementById(suggestion.elementId);
            if (targetElement) {
                setTimeout(() => {
                    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    triggerGlowBlink(targetElement);
                }, 100);
            }
        }
    }

    function triggerGlowBlink(element) {
        element.classList.remove('search-glow-blink');
        // Force reflow
        void element.offsetWidth;
        element.classList.add('search-glow-blink');

        // Clean up class after animation ends (1.8s)
        setTimeout(() => {
            element.classList.remove('search-glow-blink');
        }, 1850);
    }

    // Input listening
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        showSuggestions(query);

        // Standard filter for drivers & table as a fallback or live update
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
            gridSearchQuery = query;
            const searchInputEl = document.getElementById('inventorySearchInput');
            if (searchInputEl) searchInputEl.value = query;
            filterAndSortInventory();
        }
    });

    // Keyboard navigation
    searchInput.addEventListener('keydown', (e) => {
        const items = suggestionsPanel.querySelectorAll('.search-suggestion-item');
        
        if (suggestionsPanel.style.display === 'none' || items.length === 0) {
            // Hitting enter on query
            if (e.key === 'Enter') {
                const query = searchInput.value.toLowerCase().trim();
                // Find first keyword or product that matches
                if (query) {
                    const match = currentSuggestions[0];
                    if (match) {
                        selectSuggestion(match);
                        e.preventDefault();
                    }
                }
            }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeSuggestionIndex++;
            if (activeSuggestionIndex >= items.length) activeSuggestionIndex = 0;
            updateActiveItem(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeSuggestionIndex--;
            if (activeSuggestionIndex < 0) activeSuggestionIndex = items.length - 1;
            updateActiveItem(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeSuggestionIndex >= 0 && activeSuggestionIndex < currentSuggestions.length) {
                selectSuggestion(currentSuggestions[activeSuggestionIndex]);
            } else if (currentSuggestions.length > 0) {
                selectSuggestion(currentSuggestions[0]);
            }
        } else if (e.key === 'Escape') {
            suggestionsPanel.style.display = 'none';
            activeSuggestionIndex = -1;
        }
    });

    function updateActiveItem(items) {
        items.forEach((item, index) => {
            if (index === activeSuggestionIndex) {
                item.classList.add('active');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('active');
            }
        });
    }

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestionsPanel.contains(e.target)) {
            suggestionsPanel.style.display = 'none';
        }
    });

    // Re-trigger suggestions on focus
    searchInput.addEventListener('focus', () => {
        const query = searchInput.value.toLowerCase().trim();
        if (query) {
            showSuggestions(query);
        }
    });
}

// =========================================================
// CSV Import Staging & Validation Console State & Operations
// =========================================================
let stagedCSVRows = [];
let stagedCSVHeaders = [];
let stagedCSVFileName = '';
let columnMappingState = {};
let cellValidationErrors = {};

const REQUIRED_SCHEMA_COLUMNS = [
    { key: 'date', label: 'Transaction Date', required: true, aliases: ['date', 'transaction_date', 'sales_date'] },
    { key: 'product_id', label: 'Product SKU / ID', required: true, aliases: ['product_id', 'sku', 'product_sku', 'id', 'item_id'] },
    { key: 'product_name', label: 'Product Name', required: true, aliases: ['product_name', 'name', 'product_title', 'title', 'item_name'] },
    { key: 'category', label: 'Product Category', required: true, aliases: ['category', 'product_category', 'item_category', 'dept', 'department'] },
    { key: 'sales_qty', label: 'Daily Units Sold', required: true, aliases: ['sales_qty', 'units_sold', 'sales', 'qty', 'quantity', 'sales_volume'] },
    { key: 'stock_on_hand', label: 'Stock On Hand', required: true, aliases: ['stock_on_hand', 'stock', 'inventory', 'quantity_on_hand', 'units_in_stock'] },
    { key: 'reorder_point', label: 'Reorder Point', required: true, aliases: ['reorder_point', 'reorder', 'reorder_pt', 'safety_stock', 'trigger_point'] },
    { key: 'unit_price', label: 'Unit Price', required: false, aliases: ['unit_price', 'price', 'wholesale_price', 'cost', 'rate'] },
    { key: 'supplier_lead_days', label: 'Supplier Lead Days', required: false, aliases: ['supplier_lead_days', 'lead_days', 'lead_time', 'supplier_lead'] }
];

function parseRawCSV(text) {
    const lines = [];
    let row = [""];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i+1];
        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                row[row.length - 1] += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            row.push('');
        } else if ((char === '\r' || char === '\n') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') {
                i++;
            }
            if (row.length > 1 || row[0] !== '') {
                lines.push(row.map(c => c.trim()));
            }
            row = [''];
        } else {
            row[row.length - 1] += char;
        }
    }
    if (row.length > 1 || row[0] !== '') {
        lines.push(row.map(c => c.trim()));
    }
    return lines;
}

function initializeCSVStaging(csvText, fileName) {
    const parsed = parseRawCSV(csvText);
    if (parsed.length < 2) {
        addNotification('Invalid CSV file', 'The uploaded file is empty or malformed.', 'error');
        return;
    }
    
    stagedCSVHeaders = parsed[0];
    stagedCSVRows = parsed.slice(1);
    stagedCSVFileName = fileName;
    columnMappingState = {};
    cellValidationErrors = {};
    
    // Heuristic Mapping
    REQUIRED_SCHEMA_COLUMNS.forEach(col => {
        let matchFound = '';
        for (let i = 0; i < stagedCSVHeaders.length; i++) {
            const header = stagedCSVHeaders[i].toLowerCase().trim().replace(/[\s_-]+/g, '');
            const matchAliases = col.aliases.map(a => a.toLowerCase().trim().replace(/[\s_-]+/g, ''));
            if (matchAliases.includes(header)) {
                matchFound = stagedCSVHeaders[i];
                break;
            }
        }
        columnMappingState[col.key] = matchFound;
    });
    
    // Open Staging Modal Overlay
    const modal = document.getElementById('csvValidationModal');
    if (modal) {
        modal.style.display = 'flex';
    }
    
    // Wire up Cancel buttons
    const closeBtn = document.getElementById('closeStagingModalBtn');
    const cancelBtn = document.getElementById('cancelStagingBtn');
    const dismissModal = () => {
        modal.style.display = 'none';
        stagedCSVRows = [];
        stagedCSVHeaders = [];
        cellValidationErrors = {};
        columnMappingState = {};
        
        // Restore CSV Guide badge or file indicator if no active uploaded CSV is loaded
        const savedFile = localStorage.getItem('stockSense_uploadedFile');
        const newUserCsvGuide = document.getElementById('newUserCsvGuide');
        const fileIndicator = document.getElementById('uploadedFileIndicator');
        if (!savedFile) {
            if (newUserCsvGuide) newUserCsvGuide.style.display = 'flex';
            if (fileIndicator) fileIndicator.style.display = 'none';
        } else {
            if (newUserCsvGuide) newUserCsvGuide.style.display = 'none';
            if (fileIndicator) fileIndicator.style.display = 'flex';
        }
    };
    
    if (closeBtn) closeBtn.onclick = dismissModal;
    if (cancelBtn) cancelBtn.onclick = dismissModal;
    
    // Wire up Commit button
    const commitBtn = document.getElementById('commitStagingBtn');
    if (commitBtn) {
        commitBtn.onclick = commitStagedCSV;
    }
    
    renderColumnMappingGrid();
    validateStagedData();
}

function renderColumnMappingGrid() {
    const grid = document.getElementById('columnMappingGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    REQUIRED_SCHEMA_COLUMNS.forEach(col => {
        const card = document.createElement('div');
        const isMapped = !!columnMappingState[col.key];
        card.className = `mapping-card ${isMapped ? 'mapped' : 'unmapped'}`;
        
        card.innerHTML = `
            <span>${col.label} ${col.required ? '<b style="color:var(--status-danger);">*</b>' : ''}</span>
            <select class="mapping-select" data-colkey="${col.key}">
                <option value="">-- Unmapped --</option>
                ${stagedCSVHeaders.map(header => `
                    <option value="${header}" ${columnMappingState[col.key] === header ? 'selected' : ''}>${header}</option>
                `).join('')}
            </select>
        `;
        
        const select = card.querySelector('.mapping-select');
        select.addEventListener('change', (e) => {
            const selectedHeader = e.target.value;
            columnMappingState[col.key] = selectedHeader;
            
            // Re-evaluate mapping card color immediately
            if (selectedHeader) {
                card.className = 'mapping-card mapped';
                card.querySelector('span').style.color = '#a7f3d0';
            } else {
                card.className = col.required ? 'mapping-card unmapped' : 'mapping-card mapped';
                card.querySelector('span').style.color = col.required ? '#fca5a5' : '#94a3b8';
            }
            
            validateStagedData();
        });
        
        grid.appendChild(card);
    });
}

function validateStagedData() {
    cellValidationErrors = {};
    
    // Check if required columns are mapped
    let mappingComplete = true;
    REQUIRED_SCHEMA_COLUMNS.forEach(col => {
        if (col.required && !columnMappingState[col.key]) {
            mappingComplete = false;
        }
    });
    
    let erroneousRows = new Set();
    
    if (mappingComplete) {
        stagedCSVRows.forEach((row, rowIdx) => {
            REQUIRED_SCHEMA_COLUMNS.forEach(col => {
                const headerName = columnMappingState[col.key];
                if (!headerName) {
                    if (col.required) {
                        cellValidationErrors[`${rowIdx}-${col.key}`] = `Mapping missing for required field ${col.label}`;
                        erroneousRows.add(rowIdx);
                    }
                    return;
                }
                
                const headerIdx = stagedCSVHeaders.indexOf(headerName);
                if (headerIdx === -1) return;
                
                const val = (row[headerIdx] || '').trim();
                
                // Specific field validations
                if (col.key === 'date') {
                    const parsedDate = Date.parse(val);
                    if (isNaN(parsedDate)) {
                        cellValidationErrors[`${rowIdx}-${col.key}`] = 'Invalid Date Format (use YYYY-MM-DD)';
                        erroneousRows.add(rowIdx);
                    }
                } else if (col.key === 'product_id') {
                    if (!val) {
                        cellValidationErrors[`${rowIdx}-${col.key}`] = 'Product SKU / ID is required';
                        erroneousRows.add(rowIdx);
                    }
                } else if (col.key === 'product_name') {
                    if (!val) {
                        cellValidationErrors[`${rowIdx}-${col.key}`] = 'Product name is required';
                        erroneousRows.add(rowIdx);
                    }
                } else if (col.key === 'category') {
                    if (!val) {
                        cellValidationErrors[`${rowIdx}-${col.key}`] = 'Category is required';
                        erroneousRows.add(rowIdx);
                    }
                } else if (col.key === 'sales_qty') {
                    const parsed = parseInt(val);
                    if (isNaN(parsed) || parsed < 0) {
                        cellValidationErrors[`${rowIdx}-${col.key}`] = 'Sales Qty must be an integer >= 0';
                        erroneousRows.add(rowIdx);
                    }
                } else if (col.key === 'stock_on_hand') {
                    const parsed = parseInt(val);
                    if (isNaN(parsed) || parsed < 0) {
                        cellValidationErrors[`${rowIdx}-${col.key}`] = 'Stock On Hand must be an integer >= 0';
                        erroneousRows.add(rowIdx);
                    }
                } else if (col.key === 'reorder_point') {
                    const parsed = parseInt(val);
                    if (isNaN(parsed) || parsed < 0) {
                        cellValidationErrors[`${rowIdx}-${col.key}`] = 'Reorder Point must be an integer >= 0';
                        erroneousRows.add(rowIdx);
                    }
                } else if (col.key === 'unit_price') {
                    if (val !== '') {
                        const parsed = parseFloat(val);
                        if (isNaN(parsed) || parsed < 0) {
                            cellValidationErrors[`${rowIdx}-${col.key}`] = 'Unit Price must be a float >= 0.0';
                            erroneousRows.add(rowIdx);
                        }
                    }
                } else if (col.key === 'supplier_lead_days') {
                    if (val !== '') {
                        const parsed = parseInt(val);
                        if (isNaN(parsed) || parsed < 0) {
                            cellValidationErrors[`${rowIdx}-${col.key}`] = 'Supplier Lead Days must be an integer >= 0';
                            erroneousRows.add(rowIdx);
                        }
                    }
                }
            });
        });
    }
    
    const totalRows = stagedCSVRows.length;
    const errorCount = Object.keys(cellValidationErrors).length;
    const cleanRowsCount = totalRows - erroneousRows.size;
    const erroneousRowsCount = erroneousRows.size;
    
    // Update stats bar
    const statsContainer = document.getElementById('stagingTableStats');
    if (statsContainer) {
        statsContainer.innerHTML = `
            <span class="staging-badge total"><i class="fa-solid fa-file-csv"></i> Total Rows: ${totalRows}</span>
            <span class="staging-badge clean"><i class="fa-solid fa-circle-check"></i> Clean Rows: ${cleanRowsCount}</span>
            <span class="staging-badge errors" style="${erroneousRowsCount > 0 ? '' : 'display:none;'}"><i class="fa-solid fa-triangle-exclamation"></i> Row Errors: ${erroneousRowsCount} (${errorCount} cell issues)</span>
        `;
    }
    
    // Update footer message and button active state
    const footerStats = document.getElementById('stagingValidationFooterStats');
    const commitBtn = document.getElementById('commitStagingBtn');
    
    if (!mappingComplete) {
        if (footerStats) {
            footerStats.innerHTML = `<span class="indicator-dot error"></span> Map all required headers marked with an asterisk (*) to trigger row analysis.`;
        }
        if (commitBtn) commitBtn.disabled = true;
    } else if (errorCount > 0) {
        if (footerStats) {
            footerStats.innerHTML = `<span class="indicator-dot warning"></span> Detected ${errorCount} data validation anomalies. Fix them by double-clicking red cells.`;
        }
        if (commitBtn) commitBtn.disabled = true;
    } else {
        if (footerStats) {
            footerStats.innerHTML = `<span class="indicator-dot success"></span> All rows verified successfully. Sanitized and ready to reconcile with DB.`;
        }
        if (commitBtn) commitBtn.disabled = false;
    }
    
    renderStagingDataTable();
}

function renderStagingDataTable() {
    const thead = document.getElementById('stagingTableHeader');
    const tbody = document.getElementById('stagingTableBody');
    if (!thead || !tbody) return;
    
    thead.innerHTML = '';
    tbody.innerHTML = '';
    
    // 1. Render Table Headers
    const thr = document.createElement('tr');
    thr.innerHTML = `
        <th style="width:50px; text-align:center;">Status</th>
        <th style="width:60px; text-align:center;">Index</th>
        ${REQUIRED_SCHEMA_COLUMNS.map(col => {
            const mappedHeader = columnMappingState[col.key];
            return `
                <th style="white-space:nowrap;">
                    ${col.label}
                    ${col.required ? ' <b style="color:var(--status-danger);">*</b>' : ''}
                    <div style="font-size:0.65rem; color:var(--text-muted); font-weight:normal; margin-top:2px;">
                        ${mappedHeader ? `→ [${mappedHeader}]` : '(Unmapped)'}
                    </div>
                </th>
            `;
        }).join('')}
    `;
    thead.appendChild(thr);
    
    // 2. Render Table Body (limit preview to 100 rows for high responsiveness)
    const previewRows = stagedCSVRows.slice(0, 100);
    
    previewRows.forEach((row, rowIdx) => {
        const tr = document.createElement('tr');
        tr.className = 'staging-row';
        
        let rowHasError = false;
        REQUIRED_SCHEMA_COLUMNS.forEach(col => {
            if (cellValidationErrors[`${rowIdx}-${col.key}`]) {
                rowHasError = true;
            }
        });
        
        if (rowHasError) {
            tr.classList.add('has-error');
        }
        
        // Status column
        let statusTdHtml = `<td style="text-align:center; font-size: 1rem;">
            ${rowHasError 
                ? '<i class="fa-solid fa-triangle-exclamation" style="color: var(--status-danger);" title="Row contains validation errors. Double-click cell to fix."></i>'
                : '<i class="fa-solid fa-circle-check" style="color: var(--status-success);"></i>'
            }
        </td>`;
        
        // Index column
        let indexTdHtml = `<td style="text-align:center; color:var(--text-muted); font-weight: 500;">${rowIdx + 1}</td>`;
        
        let fieldsHtml = REQUIRED_SCHEMA_COLUMNS.map(col => {
            const mappedHeader = columnMappingState[col.key];
            let cellVal = '';
            let csvHeaderIdx = -1;
            
            if (mappedHeader) {
                csvHeaderIdx = stagedCSVHeaders.indexOf(mappedHeader);
                if (csvHeaderIdx !== -1) {
                    cellVal = row[csvHeaderIdx] || '';
                }
            }
            
            const cellError = cellValidationErrors[`${rowIdx}-${col.key}`];
            const errorClass = cellError ? 'cell-error' : '';
            const errorTooltip = cellError ? `title="${cellError}"` : '';
            
            return `
                <td class="editable-cell ${errorClass}" ${errorTooltip} 
                    data-rowidx="${rowIdx}" 
                    data-colkey="${col.key}" 
                    data-headeridx="${csvHeaderIdx}">
                    ${cellVal || '<span style="color:rgba(255,255,255,0.15); font-style:italic;">Empty</span>'}
                </td>
            `;
        }).join('');
        
        tr.innerHTML = statusTdHtml + indexTdHtml + fieldsHtml;
        tbody.appendChild(tr);
    });
    
    // Add warning row at bottom if rows exceed 100
    if (stagedCSVRows.length > 100) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td colspan="${REQUIRED_SCHEMA_COLUMNS.length + 2}" style="text-align:center; padding:1rem; color:var(--text-muted); background:rgba(255,255,255,0.01);">
                <i class="fa-solid fa-ellipsis"></i> Showing the first 100 rows. The remaining ${stagedCSVRows.length - 100} rows are fully validated and sanitised in the background.
            </td>
        `;
        tbody.appendChild(tr);
    }
    
    // 3. Attach Inline Edit Event Listeners
    const editableCells = tbody.querySelectorAll('.editable-cell');
    editableCells.forEach(cell => {
        cell.addEventListener('dblclick', function() {
            // Check if already editing
            if (cell.querySelector('input')) return;
            
            const rowIdx = parseInt(cell.getAttribute('data-rowidx'));
            const colKey = cell.getAttribute('data-colkey');
            const csvHeaderIdx = parseInt(cell.getAttribute('data-headeridx'));
            
            if (csvHeaderIdx === -1 || isNaN(csvHeaderIdx)) {
                addNotification('Unmapped column', 'Please map this column header at the top before editing cells.', 'warning');
                return;
            }
            
            const currentVal = stagedCSVRows[rowIdx][csvHeaderIdx] || '';
            cell.innerHTML = `<input type="text" class="editable-cell-input" value="${currentVal.replace(/"/g, '&quot;')}">`;
            
            const input = cell.querySelector('input');
            input.focus();
            
            // Save value on blur or Enter
            const saveValue = () => {
                const newVal = input.value.trim();
                stagedCSVRows[rowIdx][csvHeaderIdx] = newVal;
                
                // Re-validate immediately
                validateStagedData();
            };
            
            input.addEventListener('blur', saveValue);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveValue();
                } else if (e.key === 'Escape') {
                    // Restore original value
                    cell.innerHTML = currentVal || '<span style="color:rgba(255,255,255,0.15); font-style:italic;">Empty</span>';
                }
            });
        });
    });
}

async function commitStagedCSV() {
    const modal = document.getElementById('csvValidationModal');
    const uploadBtn = document.getElementById('uploadCsvBtn');
    if (!modal || !uploadBtn) return;
    
    // Close Validation Modal
    modal.style.display = 'none';
    
    // Show standard loader in the upload button
    const originalText = uploadBtn.innerHTML;
    uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Reconciling &amp; Forecasting...';
    uploadBtn.disabled = true;
    
    // Add Notification
    addNotification('Ingesting sanitized data', 'Reconciling mapping cells with prediction pipeline...', 'info');
    
    // 1. Serialize staged rows back into standard clean CSV string format
    const cleanHeaders = ['date', 'product_id', 'product_name', 'category', 'sales_qty', 'stock_on_hand', 'reorder_point', 'promo', 'holiday', 'unit_price', 'supplier_lead_days'];
    
    let csvString = cleanHeaders.join(',') + '\n';
    
    stagedCSVRows.forEach(row => {
        const rowVals = cleanHeaders.map(colKey => {
            const mappedHeader = columnMappingState[colKey];
            let cellVal = '';
            if (mappedHeader) {
                const headerIdx = stagedCSVHeaders.indexOf(mappedHeader);
                if (headerIdx !== -1) {
                    cellVal = row[headerIdx] || '';
                }
            }
            
            // Fill defaults for empty optional fields
            if (cellVal === '') {
                if (colKey === 'promo' || colKey === 'holiday') {
                    return '0';
                } else if (colKey === 'unit_price') {
                    return '0.0';
                } else if (colKey === 'supplier_lead_days') {
                    return '7';
                }
            }
            
            // Escape cells containing commas or quotes
            if (cellVal.includes(',') || cellVal.includes('"') || cellVal.includes('\n')) {
                return `"${cellVal.replace(/"/g, '""')}"`;
            }
            return cellVal;
        });
        
        csvString += rowVals.join(',') + '\n';
    });
    
    // 2. Convert CSV string into Blob and add to FormData
    const csvBlob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const formData = new FormData();
    formData.append('file', new File([csvBlob], stagedCSVFileName, { type: 'text/csv' }));
    
    // 3. Post to predict API
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
            
            if (detail.error === 'INSUFFICIENT_DATA') {
                const days = detail.data_span_days || '?';
                addNotification(
                    '⚠ Not Enough Data',
                    `Your CSV covers only ${days} day(s). Upload at least 90 days to enable forecasting.`,
                    'warning'
                );
                return;
            }
            throw new Error(typeof detail === 'string' ? detail : (errData.detail?.message || 'Prediction failed'));
        }
        
        const data = await response.json();
        
        if (data.status === 'success') {
            const fileIndicator = document.getElementById('uploadedFileIndicator');
            const fileNameDisplay = document.getElementById('uploadedFileName');
            const newUserCsvGuide = document.getElementById('newUserCsvGuide');
            
            if (fileIndicator && fileNameDisplay) {
                fileNameDisplay.textContent = stagedCSVFileName;
                fileIndicator.style.display = 'flex';
                localStorage.setItem('stockSense_uploadedFile', stagedCSVFileName);
                if (typeof loadChatHistory === 'function') {
                    loadChatHistory();
                }
            }
            if (newUserCsvGuide) newUserCsvGuide.style.display = 'none';
            
            // Update chart title with actual forecast horizon from server
            const chartTitle = document.getElementById('forecastChartTitle');
            if (chartTitle && data.forecast_label) {
                chartTitle.textContent = `Demand Forecast — ${data.forecast_label} (${data.data_span_days} days of data)`;
            }
            
            updateFooterCsvStatus(stagedCSVFileName);
            
            // Cache the full result
            localStorage.setItem('stockSense_lastResult', JSON.stringify({
                historical:  data.historical,
                forecast:    data.forecast,
                insight:     data.insight,
                drivers:     data.drivers,
                kpis:        data.kpis,
                bi_metrics:  data.bi_metrics,
                promo_suggestions: data.promo_suggestions,
                holidays:    data.holidays
            }));
            
            updateChartWithData(data.historical, data.forecast);
            
            if (data.insight && data.drivers) {
                renderInsight(data.insight);
                renderDrivers(data.drivers);
            }
            
            if (data.promo_suggestions) {
                renderPromoSuggestions(data.promo_suggestions);
            }
            
            _showAllTimeline = false;
            _showAllDrivers = false;
            
            if (data.kpis)        updateKPIs(data.kpis);
            if (data.bi_metrics)  updateBIMetrics(data.bi_metrics);
            
            // Auto-refresh the inventory table
            loadInventoryData();
            
            const productCount = data.products ? data.products.length : 0;
            const atRisk = data.kpis ? (data.kpis.at_risk_products || 0) : 0;
            
            addNotification(
                'Multi-Product Forecast Complete',
                `Successfully analysed ${productCount} SKUs. ${atRisk > 0 ? `⚠ ${atRisk} products need attention.` : 'All products look healthy.'}`,
                atRisk > 0 ? 'warning' : 'success'
            );
            
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
                    .slice(0, 3)
                    .forEach(p => addNotification(
                        '⚠ Low Stock Alert',
                        `${p.product_name}: Only ${p.current_stock} units left.`,
                        'warning'
                    ));
            }
        }
    } catch (error) {
        console.error("Upload error:", error);
        addNotification('Upload Failed', error.message || 'Could not process CSV file.', 'error');
    } finally {
        uploadBtn.innerHTML = originalText;
        uploadBtn.disabled = false;
        stagedCSVRows = [];
        stagedCSVHeaders = [];
        cellValidationErrors = {};
        columnMappingState = {};
    }
}

function setupCsvUpload() {
    const fileInput = document.getElementById('csvFileInput');
    const uploadBtn = document.getElementById('uploadCsvBtn');
    const fileIndicator = document.getElementById('uploadedFileIndicator');
    const fileNameDisplay = document.getElementById('uploadedFileName');
    const clearFileBtn = document.getElementById('clearUploadedFileBtn');
    const newUserCsvGuide = document.getElementById('newUserCsvGuide');
    
    // Restore uploaded file indicator and all dashboard data from localStorage
    const savedFileName = localStorage.getItem('stockSense_uploadedFile');
    if (savedFileName && fileIndicator && fileNameDisplay) {
        fileNameDisplay.textContent = savedFileName;
        fileIndicator.style.display = 'flex';
        if (newUserCsvGuide) newUserCsvGuide.style.display = 'none';

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
        clearFileBtn.addEventListener('click', () => {
            showConfirm('Remove CSV data? This will clear all inventory and forecast data from the app so it is ready for a fresh upload.', async () => {

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
    });
}

    if (!fileInput || !uploadBtn) return;
    
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (fileIndicator) fileIndicator.style.display = 'none';
        if (newUserCsvGuide) newUserCsvGuide.style.display = 'none';
        
        const reader = new FileReader();
        reader.onload = function(evt) {
            const csvText = evt.target.result;
            initializeCSVStaging(csvText, file.name);
        };
        reader.readAsText(file);
        
        // Reset file input value so uploading the same file again triggers change event
        fileInput.value = '';
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
        if (fullInventoryData && fullInventoryData.length > 0) {
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
            
            const poBtnHtml = (item.urgency === 'Critical' || item.urgency === 'Plan') ? `
                <button class="primary-btn timeline-po-btn" style="padding: 0.25rem 0.6rem; font-size: 0.72rem; height: 26px; margin-left: 0.5rem; display: inline-flex; align-items: center; gap: 0.25rem; font-family: 'Outfit', sans-serif;" onclick="openDraftPO('${sku}', '${item.name.replace(/'/g, "\\'")}', ${item.stock})">
                    <i class="fa-solid fa-file-invoice"></i> Draft PO
                </button>
            ` : '';

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
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        ${badgeHtml}
                        ${poBtnHtml}
                    </div>
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
        if (fullInventoryData && fullInventoryData.length > 5) {
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

// ==========================================
// Theme Toggle System (Dark / Light)
// ==========================================
function initThemeToggle() {
    const themeBtn = document.getElementById('themeToggleBtn');
    if (!themeBtn) return;

    // Load active theme preference or default to dark
    const storedTheme = localStorage.getItem('theme') || 'dark';
    if (storedTheme === 'light') {
        themeBtn.classList.add('light');
        document.body.classList.add('light-mode');
    } else {
        document.body.classList.remove('light-mode');
    }
    
    // Ensure charts match active theme on initial load after short delay
    setTimeout(() => {
        updateChartsForTheme();
    }, 100);

    themeBtn.addEventListener('click', () => {
        const isCurrentlyLight = themeBtn.classList.contains('light');
        if (isCurrentlyLight) {
            themeBtn.classList.remove('light');
            document.body.classList.remove('light-mode');
            localStorage.setItem('theme', 'dark');
            addNotification('Theme Switched', 'Dark mode activated.', 'success');
        } else {
            themeBtn.classList.add('light');
            document.body.classList.add('light-mode');
            localStorage.setItem('theme', 'light');
            addNotification('Theme Switched', 'Light mode activated.', 'success');
        }
        updateChartsForTheme();
    });
}

function updateChartsForTheme() {
    const isLight = document.body.classList.contains('light-mode');
    
    // Choose colors based on theme
    const textColor = isLight ? '#475569' : '#94a3b8';
    const gridColor = isLight ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.05)';
    const tooltipBg = isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 17, 26, 0.9)';
    const tooltipText = isLight ? '#0f172a' : '#ffffff';
    const tooltipBorder = isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.1)';
    const pointBgColor = isLight ? '#ffffff' : '#0f111a';
    
    // Set global Chart.js defaults
    if (typeof Chart !== 'undefined') {
        Chart.defaults.color = textColor;
    }
    
    // Helper to update a chart instance's scales and tooltips
    const updateChartColors = (chart) => {
        if (!chart) return;
        
        // Update scales
        if (chart.options.scales) {
            Object.keys(chart.options.scales).forEach(scaleKey => {
                const scale = chart.options.scales[scaleKey];
                if (scale.grid) {
                    scale.grid.color = gridColor;
                }
                if (scale.ticks) {
                    scale.ticks.color = textColor;
                }
            });
        }
        
        // Update tooltips
        if (chart.options.plugins && chart.options.plugins.tooltip) {
            chart.options.plugins.tooltip.backgroundColor = tooltipBg;
            chart.options.plugins.tooltip.titleColor = tooltipText;
            chart.options.plugins.tooltip.bodyColor = isLight ? '#334155' : '#e2e8f0';
            chart.options.plugins.tooltip.borderColor = tooltipBorder;
        }
        
        // Update point bg colors for lines
        if (chart.data.datasets) {
            chart.data.datasets.forEach(ds => {
                if (ds.pointBackgroundColor && ds.pointBackgroundColor !== 'transparent') {
                    ds.pointBackgroundColor = pointBgColor;
                }
            });
        }
        
        // Update legend label color for Doughnut chart
        if (chart.options.plugins && chart.options.plugins.legend && chart.options.plugins.legend.labels) {
            chart.options.plugins.legend.labels.color = textColor;
        }
        
        // Update border color for Doughnut chart
        if (chart.config.type === 'doughnut') {
            chart.data.datasets.forEach(ds => {
                ds.borderColor = isLight ? '#ffffff' : 'rgba(255, 255, 255, 0.1)';
            });
        }
        
        chart.update('none'); // Update smoothly without reset animations
    };
    
    // Update all existing charts
    updateChartColors(forecastChartInstance);
    updateChartColors(forecastChartYAxisInstance);
    updateChartColors(drawerChartInstance);
    updateChartColors(financialsCategoryChartInstance);
    updateChartColors(financialsSpendChartInstance);
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

    // Show chart controls and actual chart container, hide empty state placeholder
    const chartWrapper = document.getElementById('chartScrollWrapper');
    const chartContainerRelative = document.getElementById('chartContainerRelative');
    const headerControls = document.querySelector('.chart-header-controls');
    const emptyState = document.getElementById('chartEmptyState');
    if (chartContainerRelative) chartContainerRelative.style.display = 'block';
    if (chartWrapper) chartWrapper.style.display = 'block';
    if (headerControls) headerControls.style.display = 'flex';
    if (emptyState) emptyState.style.display = 'none';

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
    if (_chartFilter.range !== 'all' && _chartFilter.range > 0 && historical.length > 0) {
        // Anchor to the LAST date in the dataset (not today).
        // This ensures "Last 1yr" shows 365 days before the data ends,
        // even if the CSV was uploaded months ago.
        const lastHistDateStr = historical[historical.length - 1].date; // "YYYY-MM-DD"
        const [year, month, day] = lastHistDateStr.split('-').map(Number);
        const lastDateObj = new Date(Date.UTC(year, month - 1, day));
        const cutoffDateObj = new Date(lastDateObj.getTime());
        cutoffDateObj.setUTCDate(cutoffDateObj.getUTCDate() - _chartFilter.range);
        
        // Convert cutoff to YYYY-MM-DD UTC string for robust, timezone-independent comparison
        const cutoffStr = cutoffDateObj.toISOString().split('T')[0];
        filteredHist = historical.filter(d => d.date >= cutoffStr);
        
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

    // Synchronize static Y-axis overlay scales with the updated main chart scales
    if (forecastChartYAxisInstance) {
        const mainYScale = forecastChartInstance.scales.y;
        forecastChartYAxisInstance.options.scales.y.min = mainYScale.min;
        forecastChartYAxisInstance.options.scales.y.max = mainYScale.max;
        forecastChartYAxisInstance.options.scales.y.ticks.stepSize = mainYScale.ticks.stepSize;
        forecastChartYAxisInstance.update('none');
    }

    // Scroll to the far right so that the forecast and recent history are immediately visible
    const chartScrollWrapper = document.getElementById('chartScrollWrapper');
    if (chartScrollWrapper) {
        requestAnimationFrame(() => {
            chartScrollWrapper.scrollLeft = chartScrollWrapper.scrollWidth - chartScrollWrapper.clientWidth;
        });
    }
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
        const promoScrollIndicator = document.getElementById('promo-scroll-indicator');
        if (promoScrollIndicator) {
            promoScrollIndicator.style.display = 'none';
        }
        return;
    }
    
    let html = '';
    suggestions.forEach(promo => {
        const badgeClass = promo.type.toLowerCase();
        let typeIcon = 'fa-tags';
        if (promo.type === 'Holiday') typeIcon = 'fa-calendar-day';
        else if (promo.type === 'Clearance') typeIcon = 'fa-fire-flame-curved';
        else if (promo.type === 'Seasonality') typeIcon = 'fa-chart-line';
        
        // Format dates beautifully
        const startStr = formatDateString(promo.start_date);
        const endStr = formatDateString(promo.end_date);
        
        const isScheduled = scheduledPromoIds.has(promo.id);
        const btnHtml = isScheduled ? `
            <button class="promo-schedule-btn scheduled" disabled>
                <i class="fa-solid fa-circle-check"></i> Campaign Scheduled
            </button>
        ` : `
            <button class="promo-schedule-btn unscheduled" id="btn-promo-${promo.id}" onclick="schedulePromotion('${promo.id}', '${promo.title.replace(/'/g, "\\'")}', '${promo.discount_pct}', '${promo.type}', '${promo.start_date}', '${promo.end_date}', '${promo.target_product.replace(/'/g, "\\'")}', '${promo.target_sku}', '${promo.expected_impact}', '${promo.urgency}', '${promo.reason.replace(/'/g, "\\'")}')">
                <i class="fa-solid fa-calendar-plus"></i> Schedule Campaign
            </button>
        `;

        // Extract percentage/metric number and the text (e.g. "+35% Sales Lift" -> "+35%", "Sales Lift")
        let impactVal = '';
        let impactLbl = promo.expected_impact || '';
        const regexMatch = String(promo.expected_impact).match(/^([\+\-]?\d+%)\s*(.*)$/);
        if (regexMatch) {
            impactVal = regexMatch[1];
            impactLbl = regexMatch[2];
        } else {
            const standalonePct = String(promo.expected_impact).match(/(\d+%)/);
            if (standalonePct) {
                impactVal = standalonePct[1];
                impactLbl = String(promo.expected_impact).replace(standalonePct[1], '').trim();
            }
        }

        const impactInner = impactVal ? `
            <div class="impact-metric-row">
                <span class="impact-val-num">${impactVal}</span>
                <span class="impact-val-lbl">${impactLbl}</span>
            </div>
        ` : `
            <div class="impact-metric-row">
                <span class="impact-val-lbl-full">${impactLbl}</span>
            </div>
        `;

        html += `
            <div class="promo-card ${badgeClass}">
                <div class="promo-card-header">
                    <span class="promo-badge-tag ${badgeClass}">
                        <i class="fa-solid ${typeIcon}"></i> ${promo.type}
                    </span>
                    <span class="promo-urgency-badge ${promo.urgency.toLowerCase()}">
                        <i class="fa-solid ${promo.urgency === 'High' ? 'fa-triangle-exclamation' : 'fa-circle-info'}"></i> ${promo.urgency} Urgency
                    </span>
                </div>
                
                <h3 class="promo-card-title">${promo.title}</h3>
                
                <div class="promo-card-dates">
                    <i class="fa-regular fa-calendar-days"></i>
                    <span>${startStr} &mdash; ${endStr}</span>
                </div>
                
                <div class="promo-impact-showcase ${badgeClass}">
                    <div class="impact-label">Projected Benefit</div>
                    ${impactInner}
                </div>
                
                <p class="promo-card-reason">${promo.reason}</p>
                
                <div class="promo-action-wrapper">
                    ${btnHtml}
                </div>
                
                <div class="promo-card-footer">
                    <div class="promo-target-label">
                        <span class="footer-label">Target Product</span>
                        <span class="footer-value" title="${promo.target_product}">${promo.target_product}</span>
                    </div>
                    <div class="promo-target-label" style="text-align: right;">
                        <span class="footer-label">SKU Code</span>
                        <span class="footer-sku-code">${promo.target_sku || 'N/A'}</span>
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    const promoScrollIndicator = document.getElementById('promo-scroll-indicator');
    if (promoScrollIndicator) {
        promoScrollIndicator.style.display = 'flex';
    }
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
                    beginAtZero: true,
                    ticks: {
                        color: 'transparent'
                    },
                    afterFit: function(scale) {
                        scale.width = 115; // 50px padding/buffer beyond the 65px sticky Y-axis overlay to prevent slanted labels from clipping
                    }
                }
            }
        }
    });

    // Secondary chart for the sticky Y-axis numbers
    const ctxYAxis = document.getElementById('forecastChartYAxis')?.getContext('2d');
    if (ctxYAxis) {
        forecastChartYAxisInstance = new Chart(ctxYAxis, {
            type: 'line',
            data: {
                labels: [],
                datasets: []
            },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                },
                scales: {
                    x: {
                        display: false,
                    },
                    y: {
                        beginAtZero: true,
                        grid: {
                            display: false,
                            drawBorder: false
                        },
                        ticks: {
                            color: '#94a3b8',
                            font: {
                                family: "'Outfit', sans-serif"
                            }
                        },
                        afterFit: function(scale) {
                            scale.width = 65; // Matches the width of the sticky Y-axis canvas
                        }
                    }
                }
            }
        });
    }

    // Update chart colors to match current theme
    updateChartsForTheme();
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
    const token = localStorage.getItem('stockSense_jwt');
    const appContainer = document.getElementById('appContainer');
    const authScreen = document.getElementById('authScreen');
    
    if (!savedName || !token) {
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
                authIndustryGroup.style.display = 'flex';
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
    
    // Tab switching logic for settings panels
    const settingsTabs = document.querySelectorAll('.settings-tab');
    const settingsPanels = document.querySelectorAll('.settings-panel');
    if (settingsTabs.length > 0 && settingsPanels.length > 0) {
        settingsTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab;
                
                // Toggle active classes on tabs
                settingsTabs.forEach(t => t.classList.toggle('active', t === tab));
                
                // Toggle active classes on panels
                settingsPanels.forEach(panel => {
                    panel.classList.toggle('active', panel.id === `settings-panel-${targetTab}`);
                });
            });
        });
    }

    // Strategy Card Selection Logic
    const strategyCards = document.querySelectorAll('.strategy-card');
    if (strategyCards.length > 0) {
        const selectStrategyCard = (value) => {
            strategyCards.forEach(card => {
                if (card.dataset.value === value) {
                    card.classList.add('active');
                    const radio = card.querySelector('input[type="radio"]');
                    if (radio) radio.checked = true;
                } else {
                    card.classList.remove('active');
                }
            });
            if (strategyInput) {
                strategyInput.value = value;
            }
        };

        strategyCards.forEach(card => {
            card.addEventListener('click', () => {
                const val = card.dataset.value;
                selectStrategyCard(val);
            });
        });

        // Initialize UI strategy card from saved strategy value
        const currentStrategy = localStorage.getItem('stockSense_cfgStrategy') || 'balanced';
        selectStrategyCard(currentStrategy);
    }
    
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

    // 2b. Avatar Remove Logic
    const removeAvatarBtn = document.getElementById('removeAvatarBtn');
    if (removeAvatarBtn) {
        removeAvatarBtn.addEventListener('click', () => {
            showConfirm('Are you sure you want to remove your organization logo?', async () => {
            
            try {
                const avatarInput = document.getElementById('settingAvatarUrl');
                if (avatarInput) avatarInput.value = '';
                localStorage.setItem('stockSense_avatarUrl', '');
                
                const currentName = localStorage.getItem('stockSense_storeName') || 'Store';
                const currentRole = localStorage.getItem('stockSense_industry') || 'Electronics';
                
                // Save updated empty profile avatar URL to the backend database
                const token = localStorage.getItem('stockSense_jwt');
                await fetch('/api/user/profile', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        org_name: currentName,
                        industry: currentRole,
                        avatar_url: ''
                    })
                });
                
                // Immediately refresh UI
                updateUserProfileUI(currentName, currentRole, '');
                
                addNotification('Logo Removed', 'Your organization logo has been successfully removed.', 'success');
            } catch (error) {
                console.error("Remove Avatar Error:", error);
                addNotification('Removal Failed', 'Could not remove your organization logo.', 'warning');
            }
        });
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
            showConfirm('You will be signed out of StockSense AI.', () => {
                localStorage.removeItem('stockSense_storeName');
                localStorage.removeItem('stockSense_industry');
                localStorage.removeItem('stockSense_jwt');
                window.location.reload();
            }, { title: 'Sign Out', variant: 'warn', confirmLabel: 'Sign Out' });
        });
    }
    
    // Mobile Profile Dropdown Actions
    const mobileSettingsBtn = document.getElementById('mobileSettingsBtn');
    if (mobileSettingsBtn) {
        mobileSettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('navSettings').click();
            const navMenu = document.querySelector('.nav-menu');
            if (navMenu) navMenu.classList.remove('open');
        });
    }
    
    const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');
    if (mobileLogoutBtn) {
        mobileLogoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showConfirm('You will be signed out of StockSense AI.', () => {
                localStorage.removeItem('stockSense_storeName');
                localStorage.removeItem('stockSense_industry');
                localStorage.removeItem('stockSense_jwt');
                window.location.reload();
            }, { title: 'Sign Out', variant: 'warn', confirmLabel: 'Sign Out' });
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
                
                filterAndSortInventory();
                
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
        purgeBtn.addEventListener('click', () => {
            const orgName = localStorage.getItem('stockSense_storeName') || 'your organization';
            showConfirm(`This will permanently delete ALL inventory and chat history for "${orgName}". This cannot be undone.`, async () => {

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
                    // Clear all cached frontend state
                    localStorage.removeItem('stockSense_uploadedFile');
                    localStorage.removeItem('stockSense_lastResult');
                    localStorage.removeItem('stockSense_inventoryChangesPending');
                    
                    addNotification('Data Purged', result.message, 'warning');
                    
                    // Clear the local inventory table immediately and reload
                    if (typeof fullInventoryData !== 'undefined') fullInventoryData = [];
                    renderInventoryTable([]);
                    
                    setTimeout(() => {
                        window.location.reload();
                    }, 1000);
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
    });
}
}

function updateUserProfileUI(name, role, avatarUrl) {
    const hasCustomAvatar = avatarUrl && avatarUrl.trim() !== '' && avatarUrl !== '/default_avatar.png' && avatarUrl !== 'default_avatar.png';

    // Sidebar
    const sidebarName = document.getElementById('sidebarUserName');
    const sidebarRole = document.getElementById('sidebarUserRole');
    if (sidebarName) sidebarName.textContent = name;
    if (sidebarRole) sidebarRole.textContent = role;

    // Sidebar Avatar
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    const sidebarAvatarIcon = document.getElementById('sidebarAvatarIcon');
    if (sidebarAvatar) {
        if (hasCustomAvatar) {
            sidebarAvatar.style.backgroundImage = `url('${avatarUrl}')`;
            sidebarAvatar.style.backgroundSize = 'cover';
            sidebarAvatar.style.backgroundPosition = 'center';
            if (sidebarAvatarIcon) sidebarAvatarIcon.style.display = 'none';
        } else {
            sidebarAvatar.style.backgroundImage = 'none';
            if (sidebarAvatarIcon) sidebarAvatarIcon.style.display = 'block';
        }
    }

    // Settings Preview
    const settingsPreview = document.getElementById('settingsAvatarPreview');
    const settingsIcon = document.getElementById('settingsAvatarIcon');
    if (settingsPreview) {
        if (hasCustomAvatar) {
            settingsPreview.style.backgroundImage = `url('${avatarUrl}')`;
            settingsPreview.style.backgroundSize = 'cover';
            settingsPreview.style.backgroundPosition = 'center';
            if (settingsIcon) settingsIcon.style.display = 'none';
        } else {
            settingsPreview.style.backgroundImage = 'none';
            if (settingsIcon) settingsIcon.style.display = 'block';
        }
    }

    // Dropdown Header
    const dropdownName = document.getElementById('dropdownUserName');
    const dropdownRole = document.getElementById('dropdownUserRole');
    if (dropdownName) dropdownName.textContent = name;
    if (dropdownRole) dropdownRole.textContent = role;

    // Dropdown Avatar
    const dropdownAvatar = document.getElementById('dropdownAvatar');
    const dropdownAvatarIcon = document.getElementById('dropdownAvatarIcon');
    if (dropdownAvatar) {
        if (hasCustomAvatar) {
            dropdownAvatar.style.backgroundImage = `url('${avatarUrl}')`;
            dropdownAvatar.style.backgroundSize = 'cover';
            dropdownAvatar.style.backgroundPosition = 'center';
            if (dropdownAvatarIcon) dropdownAvatarIcon.style.display = 'none';
        } else {
            dropdownAvatar.style.backgroundImage = 'none';
            if (dropdownAvatarIcon) dropdownAvatarIcon.style.display = 'block';
        }
    }

    // Mobile Profile Sync
    const mobileName = document.getElementById('mobileUserName');
    const mobileRole = document.getElementById('mobileUserRole');
    if (mobileName) mobileName.textContent = name;
    if (mobileRole) mobileRole.textContent = role;

    const mobileAvatar = document.getElementById('mobileAvatar');
    const mobileAvatarIcon = document.getElementById('mobileAvatarIcon');
    if (mobileAvatar) {
        if (hasCustomAvatar) {
            mobileAvatar.style.backgroundImage = `url('${avatarUrl}')`;
            mobileAvatar.style.backgroundSize = 'cover';
            mobileAvatar.style.backgroundPosition = 'center';
            if (mobileAvatarIcon) mobileAvatarIcon.style.display = 'none';
        } else {
            mobileAvatar.style.backgroundImage = 'none';
            if (mobileAvatarIcon) mobileAvatarIcon.style.display = 'block';
        }
    }

    // Toggle Remove Button
    const removeBtn = document.getElementById('removeAvatarBtn');
    if (removeBtn) {
        if (hasCustomAvatar) {
            removeBtn.style.display = 'inline-flex';
        } else {
            removeBtn.style.display = 'none';
        }
    }

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
// Unified KPI Overview Dialog
// ==========================================
function setupUnifiedKpiCardTrigger() {
    const kpiCard = document.getElementById('kpiUnifiedCard');
    if (kpiCard) {
        kpiCard.addEventListener('click', () => {
            showUnifiedKpiModal();
        });
    }
}

async function showUnifiedKpiModal() {
    // 1. Remove old modal if it exists
    const old = document.getElementById('unifiedKpiModal');
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
            console.error("Failed to fetch Inventory data on-the-fly for KPI Overview:", e);
        }
    }

    // 3. Create modal overlay and container
    const overlay = document.createElement('div');
    overlay.className = 'sku-modal-overlay';
    overlay.id = 'unifiedKpiModal';

    overlay.innerHTML = `
        <div class="sku-modal-container" style="width: 1000px; max-width: 95vw;">
            <div class="sku-modal-header">
                <div>
                    <h3 style="margin:0; font-size:1.3rem; display:flex; align-items:center; gap:0.6rem; color:var(--text-primary);">
                        <i class="fa-solid fa-chart-simple" style="color:var(--accent-primary);"></i> KPI Inventory Overview
                    </h3>
                    <p style="margin:0.25rem 0 0; font-size:0.8rem; color:var(--text-secondary);" id="unifiedKpiModalSub">
                        Detailed breakdown of SKU details, total and available units, sales, and replenishment status for all ${items.length} products.
                    </p>
                </div>
                <button class="sku-modal-close" id="closeUnifiedKpiModal" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            
            <div class="sku-modal-search">
                <i class="fa-solid fa-search"></i>
                <input type="text" id="unifiedKpiModalSearchInput" placeholder="Search by SKU, Name, or Category..." autocomplete="off">
            </div>

            <div class="sku-table-wrapper">
                <table class="sku-table">
                    <thead>
                        <tr>
                            <th style="width: 15%; text-align: center; font-size: 0.8rem; font-weight: 600; text-transform: uppercase;">SKU / ID</th>
                            <th style="width: 30%; text-align: center; font-size: 0.8rem; font-weight: 600; text-transform: uppercase;">Product Details</th>
                            <th style="width: 11%; text-align: center; font-size: 0.8rem; font-weight: 600; text-transform: uppercase;">Total Units</th>
                            <th style="width: 11%; text-align: center; font-size: 0.8rem; font-weight: 600; text-transform: uppercase;">Stock Available</th>
                            <th style="width: 11%; text-align: center; font-size: 0.8rem; font-weight: 600; text-transform: uppercase;">Unit Sold</th>
                            <th style="width: 11%; text-align: center; font-size: 0.8rem; font-weight: 600; text-transform: uppercase;">Unit Price</th>
                            <th style="width: 11%; text-align: center; font-size: 0.8rem; font-weight: 600; text-transform: uppercase;">Status</th>
                        </tr>
                    </thead>
                    <tbody id="unifiedKpiModalTableBody">
                        ${renderUnifiedKpiModalRows(items)}
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
    const searchInput = document.getElementById('unifiedKpiModalSearchInput');
    if (searchInput) searchInput.focus();

    // 4. Modal Close Logic
    const closeModal = () => {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 250);
    };

    document.getElementById('closeUnifiedKpiModal').addEventListener('click', closeModal);

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
            
            const tbody = document.getElementById('unifiedKpiModalTableBody');
            if (tbody) {
                tbody.innerHTML = renderUnifiedKpiModalRows(filtered);
            }

            const sub = document.getElementById('unifiedKpiModalSub');
            if (sub) {
                if (query.length > 0) {
                    sub.textContent = `Showing ${filtered.length} of ${items.length} matched products.`;
                } else {
                    sub.textContent = `Detailed breakdown of SKU details, total and available units, sales, and replenishment status for all ${items.length} products.`;
                }
            }
        });
    }
}

function renderUnifiedKpiModalRows(items) {
    if (!items || items.length === 0) {
        return `
            <tr>
                <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem; font-size: 0.8rem;">
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
        const price = (item.price && item.price > 0) ? formatCurrency(item.price) : '—';

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
                <td style="text-align: center; font-size: 0.8rem; vertical-align: middle;">
                    <code style="font-family: monospace; font-size: 0.78rem; color: var(--text-primary); background: rgba(255,255,255,0.06); padding: 3px 7px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.04);">${item.sku}</code>
                </td>
                <td style="text-align: center; font-size: 0.8rem; vertical-align: middle;">
                    <div style="display:flex; flex-direction:column; align-items:center; gap:0.15rem;">
                        <span style="font-weight: 500; color: var(--text-primary);">${item.name}</span>
                        <span style="font-size: 0.75rem; color: var(--text-muted);">${item.category || 'N/A'}</span>
                    </div>
                </td>
                <td style="text-align: center; font-size: 0.8rem; font-weight: 600; color: var(--text-primary); vertical-align: middle;">
                    ${total.toLocaleString()}
                </td>
                <td style="text-align: center; font-size: 0.8rem; font-weight: 600; color: ${remainingColor}; vertical-align: middle;">
                    ${left.toLocaleString()}
                </td>
                <td style="text-align: center; font-size: 0.8rem; color: var(--text-secondary); vertical-align: middle;">
                    ${sold.toLocaleString()}
                </td>
                <td style="text-align: center; font-size: 0.8rem; font-weight: 600; color: var(--accent-primary); vertical-align: middle;">
                    ${price}
                </td>
                <td style="text-align: center; font-size: 0.8rem; vertical-align: middle;">
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
        <div class="sku-modal-container" style="width: 1150px; max-width: 95vw; max-height: 90vh;">
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
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 0.5rem; align-items: stretch;">
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; min-height: 90px; justify-content: space-between;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">HISTORICAL SALES</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: var(--text-primary); font-weight: 700;">
                            ${totalActualDaily.toLocaleString()} <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-muted);">units/day avg</span>
                        </h3>
                    </div>
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; min-height: 90px; justify-content: space-between;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">AI FORECAST</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: var(--accent-primary); font-weight: 700;">
                            ${totalForecastDaily.toLocaleString()} <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-secondary);">units/day avg</span>
                        </h3>
                    </div>
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; min-height: 90px; justify-content: space-between;">
                        <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">VELOCITY SHIFT</span>
                        <h3 style="margin: 0; font-size: 1.25rem; color: ${isIncrease ? 'var(--status-success)' : 'var(--status-danger)'}; font-weight: 700; display: flex; align-items: center; gap: 0.35rem;">
                            <i class="fa-solid ${isIncrease ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i>
                            ${isIncrease ? '+' : ''}${deltaPct}%
                            <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-muted);">(${isIncrease ? '+' : ''}${delta} units/day)</span>
                        </h3>
                    </div>
                    <div class="glass-panel bi-highlight-card" style="padding: 0.85rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; min-height: 90px; justify-content: space-between;">
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

function getDeterministicMargin(sku, category) {
    const str = sku || "";
    const val = [...str].reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const cat = (category || "").toLowerCase();
    let base = 20;
    let range = 15;
    if (cat.includes("accessory") || cat.includes("case") || cat.includes("cable") || cat.includes("charger") || cat.includes("stand")) {
        base = 30;
        range = 15;
    } else if (cat.includes("electronic") || cat.includes("watch") || cat.includes("earbud") || cat.includes("power bank")) {
        base = 20;
        range = 10;
    } else {
        base = 15;
        range = 15;
    }
    return base + (val % (range + 1));
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
        const marginPct = getDeterministicMargin(p.sku, p.category);
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
    
    // Compute portfolio average margin weighted by forecasted demand * price (revenue)
    let totalForecastRev = 0;
    let totalForecastProf = 0;
    computedItems.forEach(item => {
        const itemRev = (item.forecasted_demand || 0) * (item.price || 0);
        totalForecastRev += itemRev;
        totalForecastProf += itemRev * (item.marginPct / 100);
    });
    const portfolioAvgMargin = totalForecastRev > 0 
        ? ((totalForecastProf / totalForecastRev) * 100).toFixed(1)
        : (computedItems.reduce((sum, item) => sum + item.marginPct, 0) / Math.max(1, computedItems.length)).toFixed(1);

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
        <div class="sku-modal-container" style="width: 1200px; max-width: 95vw; max-height: 90vh;">
            <div class="sku-modal-header">
                <div>
                    <h2 style="margin:0; font-size:1.35rem; display:flex; align-items:center; gap:0.5rem; color:var(--text-primary);">
                        <i class="fa-solid fa-chart-line" style="color:var(--accent-secondary);"></i>
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
                            ${portfolioAvgMargin}% <span style="font-size: 0.75rem; font-weight: 400; color: var(--text-muted);">aggregate target</span>
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
                                <th class="sortable-header" data-col="sku" style="width: 12%;">SKU <span class="sort-indicator" id="sort-margin-sku"></span></th>
                                <th class="sortable-header" data-col="name" style="width: 24%;">Product Details <span class="sort-indicator" id="sort-margin-name"></span></th>
                                <th class="sortable-header" data-col="price" style="width: 12%; text-align: right;">Unit Price <span class="sort-indicator" id="sort-margin-price"></span></th>
                                <th class="sortable-header" data-col="marginPct" style="width: 24%; text-align: center;">Margin Breakdown <span class="sort-indicator" id="sort-margin-marginPct"></span></th>
                                <th class="sortable-header" data-col="profit" style="width: 16%; text-align: right;">Projected Profit (30d) <span class="sort-indicator" id="sort-margin-profit"></span></th>
                                <th style="width: 12%; text-align: center;">Health</th>
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
                <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 3rem;">
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
                    <div style="display: flex; flex-direction: column; gap: 0.1rem; align-items: flex-end;">
                        <strong style="color: var(--status-success); font-size: 1rem;">${formatCurrency(profit30d)}</strong>
                        <span style="font-size: 0.68rem; color: var(--text-muted);">Unit profit: ${formatCurrency(profitPerUnit)}</span>
                    </div>
                </td>
                <td style="text-align: center; vertical-align: middle;">
                    ${classBadge}
                </td>
            </tr>
        `;
    }).join('');
}


// ==========================================
// KPI: Next Event – Interactive Holiday Calendar Modal
// ==========================================
function setupKpiNextEventTrigger() {
    const kpiCard = document.getElementById('kpiNextEventCard');
    if (kpiCard) {
        kpiCard.addEventListener('click', () => showModalHolidays());
    }
}

function showModalHolidays() {
    // 1. Remove any existing instance
    const old = document.getElementById('holidayCalendarModal');
    if (old) old.remove();

    // Determine region and years
    const region = localStorage.getItem('stockSense_cfgRegion') || 'BD';
    let years = [];
    let cachedHolidays = [];
    try {
        const cachedData = JSON.parse(localStorage.getItem('stockSense_lastResult') || 'null');
        if (cachedData) {
            if (Array.isArray(cachedData.holidays)) {
                cachedHolidays = cachedData.holidays;
            }
            const allItems = [...(cachedData.historical || []), ...(cachedData.forecast || [])];
            years = [...new Set(allItems.map(item => {
                const d = item.date || item.Date;
                return d ? d.split('-')[0] : null;
            }).filter(Boolean))];
        }
    } catch (e) {
        console.warn('Could not parse cached result:', e);
    }
    if (years.length === 0) {
        const currentYear = new Date().getFullYear();
        years = [currentYear, currentYear + 1];
    }

    const yearLabel = years.length > 0 ? years.join(' – ') : 'Your Dataset';

    // 2. Build overlay with loading state initially
    const overlay = document.createElement('div');
    overlay.className = 'sku-modal-overlay';
    overlay.id = 'holidayCalendarModal';
    overlay.innerHTML = `
        <div class="sku-modal-container" style="width:820px;max-width:95vw;max-height:90vh;">
            <div class="sku-modal-header">
                <div>
                    <h2 style="margin:0;font-size:1.3rem;display:flex;align-items:center;gap:0.6rem;color:var(--text-primary);">
                        <i class="fa-solid fa-calendar-day" style="color:var(--status-warning);"></i>
                        Holiday &amp; Event Calendar
                    </h2>
                    <p style="margin:0.3rem 0 0;font-size:0.8rem;color:var(--text-secondary);" id="holidayModalSubtitle">
                        Syncing regional holidays...
                    </p>
                </div>
                <button class="sku-modal-close" id="closeHolidayModal" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            
            <div id="holidayModalContent" style="display:flex; flex-direction:column; gap:1.5rem; flex:1; min-height:0;">
                <div style="text-align:center;padding:4rem 2rem;color:var(--text-secondary);">
                    <i class="fa-solid fa-circle-notch fa-spin" style="font-size:2.5rem;color:var(--accent-primary);margin-bottom:1rem;"></i>
                    <p style="font-size:1.05rem;margin:0 0 0.25rem;font-weight:600;">Syncing regional holiday calendar...</p>
                    <p style="font-size:0.8rem;color:var(--text-muted);margin:0;">Fetching public and religious holidays for region: ${region} and years: ${years.join(', ')}</p>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Open animation
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('open')));

    // Close logic helper
    const closeModal = () => {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 250);
    };
    const closeBtn = document.getElementById('closeHolidayModal');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    const escHandler = (e) => {
        if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    // Helpers for countdowns and dates
    const daysUntil = (dateStr) => {
        const t = new Date(dateStr);
        const n = new Date();
        n.setHours(0, 0, 0, 0);
        return Math.round((t - n) / 86400000);
    };
    const fmtDate = (dateStr) => {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    };
    const monthLabel = (dateStr) => {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    };

    // 3. Fetch from backend
    fetch(`/api/holidays?region=${region}&years=${years.join(',')}`)
        .then(res => {
            if (!res.ok) throw new Error('Failed to fetch holidays from server');
            return res.json();
        })
        .then(data => {
            if (data.status === 'success' && Array.isArray(data.holidays)) {
                renderHolidays(data.holidays);
                // Also update the cached data in localStorage so other elements remain synchronized
                updateHolidaysCache(data.holidays);
            } else {
                throw new Error(data.detail || 'Invalid response format');
            }
        })
        .catch(err => {
            console.error('API holiday fetch failed, checking fallback:', err);
            // Fall back to cached holidays if available
            if (cachedHolidays && cachedHolidays.length > 0) {
                renderHolidays(cachedHolidays);
            } else {
                // Render error state
                const contentDiv = document.getElementById('holidayModalContent');
                if (contentDiv) {
                    contentDiv.innerHTML = `
                        <div style="text-align:center;padding:4rem 2rem;color:var(--text-muted);">
                            <i class="fa-solid fa-triangle-exclamation" style="font-size:3rem;color:var(--status-danger);margin-bottom:1rem;display:block;"></i>
                            <p style="font-size:1rem;margin:0 0 0.5rem;font-weight:600;color:var(--text-primary);">Failed to load holidays</p>
                            <p style="font-size:0.8rem;margin:0 0 1.5rem;">${err.message || 'The holiday service is currently unavailable.'}</p>
                            <button id="retryHolidayFetchBtn" class="btn btn-primary" style="padding:0.5rem 1.2rem;font-size:0.8rem;border-radius:6px;background:var(--accent-primary);color:#fff;border:none;cursor:pointer;">
                                <i class="fa-solid fa-rotate-right"></i> Retry Sync
                            </button>
                        </div>
                    `;
                    const retryBtn = document.getElementById('retryHolidayFetchBtn');
                    if (retryBtn) {
                        retryBtn.addEventListener('click', () => {
                            contentDiv.innerHTML = `
                                <div style="text-align:center;padding:4rem 2rem;color:var(--text-secondary);">
                                    <i class="fa-solid fa-circle-notch fa-spin" style="font-size:2.5rem;color:var(--accent-primary);margin-bottom:1rem;"></i>
                                    <p style="font-size:1.05rem;margin:0 0 0.25rem;font-weight:600;">Syncing regional holiday calendar...</p>
                                    <p style="font-size:0.8rem;color:var(--text-muted);margin:0;">Retrying fetch...</p>
                                </div>
                            `;
                            showModalHolidays(); // Re-run
                        });
                    }
                }
            }
        });

    function updateHolidaysCache(newHolidays) {
        try {
            const cachedData = JSON.parse(localStorage.getItem('stockSense_lastResult') || '{}');
            cachedData.holidays = newHolidays;
            localStorage.setItem('stockSense_lastResult', JSON.stringify(cachedData));
        } catch (e) {
            console.warn('Could not update holidays cache:', e);
        }
    }

    function renderHolidays(holidaysList) {
        // Sort chronologically (defensive)
        const sortedHolidays = holidaysList.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        
        // Update header subtitle
        const totalEvents = sortedHolidays.length;
        const upcomingCount = sortedHolidays.filter(h => daysUntil(h.date) >= 0).length;
        const pastCount = sortedHolidays.filter(h => daysUntil(h.date) < 0).length;
        const subtitle = document.getElementById('holidayModalSubtitle');
        if (subtitle) {
            subtitle.innerHTML = `
                <strong>${totalEvents}</strong> events for <strong>${yearLabel}</strong>
                &nbsp;·&nbsp; <span style="color:var(--status-success);">${upcomingCount} upcoming</span>
                &nbsp;·&nbsp; <span style="color:var(--text-muted);">${pastCount} past</span>
            `;
        }

        // Identify the next upcoming holiday index
        let nextIdx = sortedHolidays.findIndex(h => daysUntil(h.date) >= 0);
        if (nextIdx === -1 && sortedHolidays.length > 0) nextIdx = sortedHolidays.length - 1;

        const buildRows = (list) => {
            if (list.length === 0) {
                return `<tr><td colspan="3" style="text-align:center;padding:2.5rem 1rem;color:var(--text-muted);font-size:0.9rem;">
                    <i class="fa-solid fa-calendar-xmark" style="font-size:2rem;margin-bottom:0.5rem;display:block;opacity:0.35;"></i>
                    No events match your search.
                </td></tr>`;
            }
            let lastMonth = '';
            return list.map((h) => {
                const origIdx = sortedHolidays.indexOf(h);
                const isNext  = origIdx === nextIdx;
                const du      = daysUntil(h.date);
                const isPast  = du < 0;
                const month   = monthLabel(h.date);
                let sep = '';
                if (month !== lastMonth) {
                    lastMonth = month;
                    sep = `<tr class="holiday-month-group"><td colspan="3"><span><i class="fa-solid fa-calendar-days"></i> ${month}</span></td></tr>`;
                }
                const duBadge = isPast
                    ? `<span class="holiday-badge past"><i class="fa-solid fa-rotate-left"></i> ${Math.abs(du)}d ago</span>`
                    : du === 0
                        ? `<span class="holiday-badge today"><i class="fa-solid fa-star"></i> Today!</span>`
                        : `<span class="holiday-badge upcoming"><i class="fa-regular fa-clock"></i> In ${du}d</span>`;
                const nextRibbon = isNext
                    ? `<span class="holiday-next-badge"><i class="fa-solid fa-bolt"></i> Next</span> `
                    : '';
                const rowClass = isNext ? 'holiday-row holiday-row-next' : (isPast ? 'holiday-row holiday-row-past' : 'holiday-row');
                return `${sep}<tr class="${rowClass}" id="holiday-row-${origIdx}">
                    <td>${fmtDate(h.date)}</td>
                    <td>${nextRibbon}${h.name}</td>
                    <td style="text-align:right;">${duBadge}</td>
                </tr>`;
            }).join('');
        };

        const nextEventName = nextIdx >= 0 ? sortedHolidays[nextIdx].name : 'N/A';

        const contentDiv = document.getElementById('holidayModalContent');
        if (!contentDiv) return;

        contentDiv.innerHTML = `
            ${sortedHolidays.length === 0 ? `
            <div style="text-align:center;padding:3.5rem 1rem;color:var(--text-muted);">
                <i class="fa-solid fa-calendar-xmark" style="font-size:3rem;margin-bottom:1rem;display:block;opacity:0.3;"></i>
                <p style="font-size:0.95rem;margin:0 0 0.5rem;">No holiday data available for region ${region}.</p>
                <p style="font-size:0.8rem;margin:0;">Upload a sales CSV to see events for your dataset's year range.</p>
            </div>
            ` : `
            <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
                <div class="holiday-stat-chip"><i class="fa-solid fa-calendar-check" style="color:var(--accent-primary);"></i><span><strong>${totalEvents}</strong> Total Events</span></div>
                <div class="holiday-stat-chip"><i class="fa-solid fa-arrow-trend-up" style="color:var(--status-success);"></i><span><strong>${upcomingCount}</strong> Upcoming</span></div>
                <div class="holiday-stat-chip"><i class="fa-solid fa-bolt" style="color:var(--status-warning);"></i><span>Next: <strong>${nextEventName}</strong></span></div>
            </div>

            <div class="sku-modal-search">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" id="holidaySearchInput" placeholder="Search by event name or date (YYYY-MM-DD)..." autocomplete="off">
            </div>

            <div class="sku-table-wrapper holiday-table-wrapper">
                <table class="sku-table holiday-calendar-table">
                    <thead>
                        <tr>
                            <th style="width:32%;">Date</th>
                            <th>Holiday / Event</th>
                            <th style="width:18%;text-align:right;">Countdown</th>
                        </tr>
                    </thead>
                    <tbody id="holidayTableBody">${buildRows(sortedHolidays)}</tbody>
                </table>
            </div>
            `}
        `;

        // Scroll next event into view
        if (nextIdx >= 0 && sortedHolidays.length > 0) {
            setTimeout(() => {
                const nextRow = document.getElementById(`holiday-row-${nextIdx}`);
                if (nextRow) nextRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 350);
        }

        // Live search
        const searchInput = document.getElementById('holidaySearchInput');
        if (searchInput) {
            searchInput.focus({ preventScroll: true });
            searchInput.addEventListener('input', () => {
                const q = searchInput.value.toLowerCase().trim();
                const filtered = q
                     ? sortedHolidays.filter(h => h.name.toLowerCase().includes(q) || h.date.includes(q))
                     : sortedHolidays;
                const tbody = document.getElementById('holidayTableBody');
                if (tbody) tbody.innerHTML = buildRows(filtered);
            });
        }
    }
}

/**
 * Initializes drag-to-scroll swipe interactions on the AI Promotional Planner Suggestions deck.
 * This allows user-friendly horizontal swipe-to-scroll dragging using mouse gestures on desktop.
 */
function initPromoDragToScroll() {
    const slider = document.getElementById('promo-suggestions-container');
    if (!slider) return;

    let isDown = false;
    let startX;
    let scrollLeft;
    let hasDragged = false;
    let dragThreshold = 5; // pixels threshold to recognize dragging

    slider.addEventListener('mousedown', (e) => {
        // Only trigger on left-click dragging
        if (e.button !== 0) return;
        
        isDown = true;
        hasDragged = false;
        slider.style.cursor = 'grabbing';
        slider.style.userSelect = 'none';
        slider.style.webkitUserSelect = 'none';
        
        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
    });

    slider.addEventListener('mouseleave', () => {
        if (isDown) {
            isDown = false;
            slider.style.cursor = 'grab';
            slider.style.removeProperty('user-select');
            slider.style.removeProperty('-webkit-user-select');
        }
    });

    slider.addEventListener('mouseup', () => {
        if (isDown) {
            isDown = false;
            slider.style.cursor = 'grab';
            slider.style.removeProperty('user-select');
            slider.style.removeProperty('-webkit-user-select');
        }
    });

    slider.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        
        const x = e.pageX - slider.offsetLeft;
        const walk = (x - startX) * 1.5; // Scroll speed modifier
        
        if (Math.abs(x - startX) > dragThreshold) {
            hasDragged = true;
        }
        
        slider.scrollLeft = scrollLeft - walk;
    });

    // Use capture phase to intercept click events and prevent action triggers if the user was dragging
    slider.addEventListener('click', (e) => {
        if (hasDragged) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
}

/**
 * Initializes and manages the AI Help Chatbot Assistant (Groq Llama-3.1-8b-instant).
 * Connects to the /api/docs/chat streaming endpoint and parses SSE events in real-time.
 */
function initHelpChat() {
    const aiHelpToggle = document.getElementById('aiHelpToggle');
    const aiHelpPanel = document.getElementById('aiHelpPanel');
    const aiHelpClose = document.getElementById('aiHelpClose');
    const aiHelpClear = document.getElementById('aiHelpClear');
    const aiHelpInput = document.getElementById('aiHelpInput');
    const aiHelpSend = document.getElementById('aiHelpSend');
    const aiHelpMessages = document.getElementById('aiHelpMessages');
    
    if (!aiHelpToggle || !aiHelpPanel) return;

    let chatbotMode = 'insight'; // 'insight' or 'guide'
    let aiHelpHistory = [];
    let aiInsightFloatingHistory = [];

    const greetingInsight = `Hello! 👋 I am your AI Insight co-pilot. I can help you analyze your inventory, predict stockouts, suggest strategies, or query your sales history. How can I assist you today?`;
    const greetingGuide = `Hello! 👋 I am your StockSense AI virtual assistant. Ask me anything about how the app works, time-series forecasting, or configuring your business parameters!`;

    const chipsInsight = `
        <button class="ai-help-chip" data-query="Identify products with high risk of stockouts">💡 Predict stockouts</button>
        <button class="ai-help-chip" data-query="Analyze my sales trends and drivers">📊 Sales analysis</button>
        <button class="ai-help-chip" data-query="Recommend custom reorder levels for my inventory">📦 Optimize reorder</button>
        <button class="ai-help-chip" data-query="Suggest pricing or clearance strategies based on current stock">💰 Strategy advice</button>
    `;
    const chipsGuide = `
        <button class="ai-help-chip" data-query="How do I change the Forecasting Strategy?">💡 Change Strategy</button>
        <button class="ai-help-chip" data-query="What do the SHAP demand drivers mean?">📊 Explain SHAP</button>
        <button class="ai-help-chip" data-query="How do I upload custom product CSVs?">📦 Upload CSV</button>
        <button class="ai-help-chip" data-query="Is my inventory data secure?">🔒 Privacy &amp; Security</button>
    `;

    // Restore sessions from localStorage if they exist
    try {
        aiHelpHistory = JSON.parse(localStorage.getItem('stockSense_helpChatHistory') || '[]');
        aiInsightFloatingHistory = JSON.parse(localStorage.getItem('stockSense_insightFloatingChatHistory') || '[]');
    } catch (e) {
        console.warn('Could not load saved chat histories:', e);
    }

    function renderActiveHistory() {
        const activeHistory = chatbotMode === 'insight' ? aiInsightFloatingHistory : aiHelpHistory;
        const defaultGreeting = chatbotMode === 'insight' ? greetingInsight : greetingGuide;

        aiHelpMessages.innerHTML = `
            <div class="ai-help-message assistant">
                <div class="ai-help-bubble">
                    ${defaultGreeting}
                </div>
            </div>
        `;

        activeHistory.forEach(msg => {
            appendHelpMessage(msg.role, msg.content);
        });

        aiHelpMessages.scrollTop = aiHelpMessages.scrollHeight;
    }

    function switchMode(newMode) {
        chatbotMode = newMode;
        
        aiHelpPanel.setAttribute('data-mode', chatbotMode);

        const btnInsight = document.getElementById('btnModeInsight');
        const btnGuide = document.getElementById('btnModeGuide');
        if (btnInsight && btnGuide) {
            if (chatbotMode === 'insight') {
                btnInsight.classList.add('active');
                btnGuide.classList.remove('active');
            } else {
                btnGuide.classList.add('active');
                btnInsight.classList.remove('active');
            }
        }

        const avatarEl = document.getElementById('aiHelpAvatar');
        const titleEl = document.getElementById('aiChatPanelTitle');
        const subtitleEl = document.getElementById('aiChatPanelSubtitle');
        const suggestionsEl = document.getElementById('aiHelpSuggestions');
        
        if (chatbotMode === 'insight') {
            if (avatarEl) avatarEl.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
            if (titleEl) titleEl.textContent = 'StockSense AI Insight';
            if (subtitleEl) subtitleEl.innerHTML = '<span class="ai-help-status-dot"></span> Chatting Agent';
            if (suggestionsEl) suggestionsEl.innerHTML = chipsInsight;
            if (aiHelpInput) aiHelpInput.placeholder = 'Type a message or analytical question...';
        } else {
            if (avatarEl) avatarEl.innerHTML = '<i class="fa-solid fa-robot"></i>';
            if (titleEl) titleEl.textContent = 'StockSense AI Guide';
            if (subtitleEl) subtitleEl.innerHTML = '<span class="ai-help-status-dot"></span> Online Guide Agent';
            if (suggestionsEl) suggestionsEl.innerHTML = chipsGuide;
            if (aiHelpInput) aiHelpInput.placeholder = 'Type a guide question...';
        }

        renderActiveHistory();
    }

    // Toggle panel open/close
    aiHelpToggle.addEventListener('click', () => {
        const isHidden = aiHelpPanel.style.display === 'none';
        aiHelpPanel.style.display = isHidden ? 'flex' : 'none';
        if (isHidden) {
            aiHelpInput.focus();
            aiHelpMessages.scrollTop = aiHelpMessages.scrollHeight;
        }
    });

    if (aiHelpClose) {
        aiHelpClose.addEventListener('click', () => {
            aiHelpPanel.style.display = 'none';
        });
    }

    if (aiHelpClear) {
        aiHelpClear.addEventListener('click', () => {
            if (chatbotMode === 'insight') {
                aiInsightFloatingHistory = [];
                localStorage.setItem('stockSense_insightFloatingChatHistory', JSON.stringify(aiInsightFloatingHistory));
            } else {
                aiHelpHistory = [];
                localStorage.setItem('stockSense_helpChatHistory', JSON.stringify(aiHelpHistory));
            }
            renderActiveHistory();
        });
    }

    // Delegated suggestion chips handler
    const suggestionsContainer = document.getElementById('aiHelpSuggestions');
    if (suggestionsContainer) {
        suggestionsContainer.addEventListener('click', (e) => {
            const chip = e.target.closest('.ai-help-chip');
            if (!chip) return;
            const question = chip.getAttribute('data-query');
            if (!question) return;
            aiHelpInput.value = question;
            aiHelpInput.focus();
            sendHelpMessage();
        });
    }

    if (aiHelpInput) {
        aiHelpInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendHelpMessage();
        });
    }

    if (aiHelpSend) {
        aiHelpSend.addEventListener('click', () => sendHelpMessage());
    }

    // Setup mode selector listeners
    const btnModeInsight = document.getElementById('btnModeInsight');
    const btnModeGuide = document.getElementById('btnModeGuide');
    if (btnModeInsight) {
        btnModeInsight.addEventListener('click', () => switchMode('insight'));
    }
    if (btnModeGuide) {
        btnModeGuide.addEventListener('click', () => switchMode('guide'));
    }

    // Render initial history
    renderActiveHistory();

    function appendHelpMessage(role, content) {
        if (!content) return;
        const div = document.createElement('div');
        div.className = `ai-help-message ${role}`;
        
        let renderedContent = content
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/^\s*[-*]\s+(.*)$/gm, '<li>$1</li>');
            
        if (renderedContent.includes('<li>')) {
            renderedContent = renderedContent.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');
            renderedContent = renderedContent.replace(/<\/ul>\s*<ul>/g, '');
        }

        div.innerHTML = `<div class="ai-help-bubble">${renderedContent}</div>`;
        aiHelpMessages.appendChild(div);
        aiHelpMessages.scrollTop = aiHelpMessages.scrollHeight;
        return div;
    }

    async function sendHelpMessage() {
        const text = aiHelpInput.value.trim();
        if (!text) return;

        // Render User message
        appendHelpMessage('user', text);
        aiHelpInput.value = '';

        if (chatbotMode === 'insight') {
            const typingIndicator = document.createElement('div');
            typingIndicator.className = 'ai-help-message assistant typing-indicator-container';
            typingIndicator.innerHTML = `
                <div class="ai-help-bubble" style="background:transparent; border:none; padding:0.25rem 0;">
                    <div class="ai-help-typing-indicator">
                        <span class="ai-help-dot"></span>
                        <span class="ai-help-dot"></span>
                        <span class="ai-help-dot"></span>
                    </div>
                </div>
            `;
            aiHelpMessages.appendChild(typingIndicator);
            aiHelpMessages.scrollTop = aiHelpMessages.scrollHeight;

            try {
                const token = localStorage.getItem('stockSense_jwt');
                const currency = localStorage.getItem('stockSense_cfgCurrency') || 'BDT';
                const activeStrategy = localStorage.getItem('stockSense_cfgStrategy') || 'balanced';
                
                let invContext = typeof currentInventoryContext !== 'undefined' ? currentInventoryContext : null;
                if (!invContext) {
                    invContext = { info: "SME Electronics Store Inventory" };
                }

                const payloadHistory = aiInsightFloatingHistory.map(m => ({ role: m.role, content: m.content }));

                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': token ? `Bearer ${token}` : ''
                    },
                    body: JSON.stringify({
                        message: text,
                        history: payloadHistory,
                        inventory_context: invContext,
                        currency: currency,
                        strategy: activeStrategy
                    })
                });

                typingIndicator.remove();

                if (!response.ok) {
                    const errRes = await response.json().catch(() => ({}));
                    const detail = errRes.message || errRes.detail || 'Insight agent is currently locked or unavailable.';
                    appendHelpMessage('assistant', `⚠️ ${detail}`);
                    return;
                }

                const result = await response.json();
                if (result.status === 'success') {
                    appendHelpMessage('assistant', result.response);
                    
                    aiInsightFloatingHistory.push({ role: 'user', content: text });
                    aiInsightFloatingHistory.push({ role: 'assistant', content: result.response });

                    if (aiInsightFloatingHistory.length > 20) {
                        aiInsightFloatingHistory = aiInsightFloatingHistory.slice(-20);
                    }
                    localStorage.setItem('stockSense_insightFloatingChatHistory', JSON.stringify(aiInsightFloatingHistory));
                }
            } catch (error) {
                console.error('Error in sendHelpMessage (Insight):', error);
                typingIndicator.remove();
                appendHelpMessage('assistant', "⚠️ I'm sorry, I encountered an error connecting to the AI server. Please try again.");
            }
        } else {
            const typingIndicator = document.createElement('div');
            typingIndicator.className = 'ai-help-message assistant typing-indicator-container';
            typingIndicator.innerHTML = `
                <div class="ai-help-bubble" style="background:transparent; border:none; padding:0.25rem 0;">
                    <div class="ai-help-typing-indicator">
                        <span class="ai-help-dot"></span>
                        <span class="ai-help-dot"></span>
                        <span class="ai-help-dot"></span>
                    </div>
                </div>
            `;
            aiHelpMessages.appendChild(typingIndicator);
            aiHelpMessages.scrollTop = aiHelpMessages.scrollHeight;

            const payloadHistory = aiHelpHistory.map(m => ({ role: m.role, content: m.content }));

            try {
                const token = localStorage.getItem('stockSense_jwt');
                const response = await fetch('/api/docs/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': token ? `Bearer ${token}` : ''
                    },
                    body: JSON.stringify({
                        message: text,
                        history: payloadHistory
                    })
                });

                typingIndicator.remove();

                if (!response.ok) {
                    const errRes = await response.json().catch(() => ({}));
                    const detail = errRes.message || errRes.detail || 'Guide agent is currently locked or unavailable.';
                    appendHelpMessage('assistant', `⚠️ ${detail}`);
                    return;
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                
                let assistantBubble = appendHelpMessage('assistant', ' ');
                let bubbleElement = assistantBubble.querySelector('.ai-help-bubble');
                let fullResponseText = '';

                aiHelpMessages.scrollTop = Math.max(0, assistantBubble.offsetTop - 100);

                let lastRenderTime = 0;
                let renderTimeout = null;

                function updateBubble() {
                    let liveRender = fullResponseText
                        .replace(/\n/g, '<br>')
                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                        .replace(/^\s*[-*]\s+(.*)$/gm, '<li>$1</li>');
                    
                    if (liveRender.includes('<li>')) {
                        liveRender = liveRender.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');
                        liveRender = liveRender.replace(/<\/ul>\s*<ul>/g, '');
                    }
                    bubbleElement.innerHTML = liveRender;
                }

                function queueRender(force = false) {
                    const now = performance.now();
                    if (force) {
                        if (renderTimeout) {
                            clearTimeout(renderTimeout);
                            renderTimeout = null;
                        }
                        updateBubble();
                        lastRenderTime = now;
                        return;
                    }

                    const timeSinceLast = now - lastRenderTime;
                    if (timeSinceLast >= 60) {
                        if (renderTimeout) {
                            clearTimeout(renderTimeout);
                            renderTimeout = null;
                        }
                        updateBubble();
                        lastRenderTime = now;
                    } else {
                        if (!renderTimeout) {
                            renderTimeout = setTimeout(() => {
                                updateBubble();
                                lastRenderTime = performance.now();
                                renderTimeout = null;
                            }, 60 - timeSinceLast);
                        }
                    }
                }

                let buffer = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        const cleanedLine = line.trim();
                        if (!cleanedLine) continue;

                        if (cleanedLine === 'data: [DONE]') {
                            break;
                        }

                        if (cleanedLine.startsWith('data: ')) {
                            try {
                                const jsonPayload = JSON.parse(cleanedLine.substring(6));
                                if (jsonPayload.token) {
                                    fullResponseText += jsonPayload.token;
                                    queueRender();
                                } else if (jsonPayload.error) {
                                    queueRender(true);
                                    bubbleElement.innerHTML += `<br>⚠️ *Error: ${jsonPayload.error}*`;
                                }
                            } catch (e) {
                                console.warn('Error parsing stream token:', e, cleanedLine);
                            }
                        }
                    }
                }

                queueRender(true);

                aiHelpHistory.push({ role: 'user', content: text });
                aiHelpHistory.push({ role: 'assistant', content: fullResponseText });
                
                if (aiHelpHistory.length > 20) {
                    aiHelpHistory = aiHelpHistory.slice(-20);
                }
                localStorage.setItem('stockSense_helpChatHistory', JSON.stringify(aiHelpHistory));

            } catch (error) {
                console.error('Error in sendHelpMessage (Guide):', error);
                if (typingIndicator) typingIndicator.remove();
                addNotification('Chat Error', 'An error occurred while communicating with the helper agent.', 'error');
            }
        }
    }
}

function initPoModal() {
    const modal = document.getElementById('draftPoModal');
    const closeBtn = document.getElementById('closeDraftPoModal');
    const cancelBtn = document.getElementById('cancelDraftPoBtn');
    const downloadBtn = document.getElementById('downloadPoCsvBtn');
    const downloadPdfBtn = document.getElementById('downloadPoPdfBtn');
    const confirmBtn = document.getElementById('confirmDraftPoBtn');
    const copyBtn = document.getElementById('copyPoEmailBtn');

    if (!modal || !closeBtn || !cancelBtn || !downloadBtn || !downloadPdfBtn || !confirmBtn || !copyBtn) return;

    const closeModal = () => {
        modal.classList.remove('open');
        modal.style.pointerEvents = 'none';
    };

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Handle interactive quantity changes (Event Delegation)
    const poTableBody = document.getElementById('poItemsTableBody');
    if (poTableBody) {
        poTableBody.addEventListener('input', (e) => {
            if (e.target.classList.contains('po-item-qty-input')) {
                recalculatePoTotalsAndEmail();
            }
        });
    }

    // Trigger recalculation when supplier name changes too (updates email)
    const supplierInput = document.getElementById('poSupplierName');
    if (supplierInput) {
        supplierInput.addEventListener('input', () => {
            recalculatePoTotalsAndEmail();
        });
    }

    // Copy to clipboard
    copyBtn.addEventListener('click', () => {
        const body = document.getElementById('poEmailBody').value;
        navigator.clipboard.writeText(body).then(() => {
            const originalHTML = copyBtn.innerHTML;
            copyBtn.innerHTML = '<i class="fa-solid fa-check" style="color: var(--status-success);"></i> Copied!';
            copyBtn.disabled = true;
            addNotification('Email Copied', 'Supplier procurement draft email copied to clipboard.', 'success');
            setTimeout(() => {
                copyBtn.innerHTML = originalHTML;
                copyBtn.disabled = false;
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
        });
    });

    // Download CSV
    downloadBtn.addEventListener('click', () => {
        const supplier = document.getElementById('poSupplierName').value || 'Supplier Global Logistics';
        const leadDaysText = document.getElementById('poLeadDays').textContent;
        
        const currency = localStorage.getItem('stockSense_cfgCurrency') || 'BDT';
        const symbols = { 'USD': '$', 'CAD': 'C$', 'CNY': '¥', 'BDT': '৳' };
        const symbol = symbols[currency.toUpperCase()] || '৳';
        
        const rowsData = [
            ["StockSense AI - Replenishment Purchase Order Draft"],
            ["Store Name", localStorage.getItem('stockSense_storeName') || 'Store 12'],
            ["Supplier Name", supplier],
            ["Lead Information", leadDaysText],
            ["Generated At", new Date().toLocaleString()],
            [],
            ["SKU Code", "Product Name", "Order Quantity", "Wholesale Unit Price", "Total Cost Projection"]
        ];

        const tbody = document.getElementById('poItemsTableBody');
        let totalOrderCost = 0;
        if (tbody) {
            const rows = tbody.querySelectorAll('tr.po-draft-row');
            rows.forEach(row => {
                const sku = row.getAttribute('data-sku');
                const name = row.getAttribute('data-name');
                const price = parseFloat(row.getAttribute('data-wholesale-price')) || 0;
                const qtyInput = row.querySelector('.po-item-qty-input');
                const qty = parseInt(qtyInput.value) || 0;
                const total = qty * price;
                totalOrderCost += total;
                rowsData.push([sku, name, qty, price, total]);
            });
        }
        rowsData.push([]);
        rowsData.push(["Grand Total", "", "", "", totalOrderCost]);

        const csvContent = rowsData.map(row => row.map(val => typeof val === 'string' && val.includes(',') ? `"${val}"` : val).join(',')).join('\n');
        const encodedUri = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `StockSense_PurchaseOrder_Consolidated.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        addNotification('PO Export Successful', `Consolidated CSV Purchase Order downloaded.`, 'success');
        modal.classList.remove('open');
    });

    // Download PDF
    downloadPdfBtn.addEventListener('click', () => {
        const supplier = document.getElementById('poSupplierName').value || 'Supplier Global Logistics';
        const leadDaysText = document.getElementById('poLeadDays').textContent;
        const orgName = localStorage.getItem('stockSense_storeName') || 'Store 12';
        
        const currency = localStorage.getItem('stockSense_cfgCurrency') || 'BDT';
        const symbols = { 'USD': '$', 'CAD': 'C$', 'CNY': '¥', 'BDT': '৳' };
        const symbol = symbols[currency.toUpperCase()] || '৳';

        const originalHTML = downloadPdfBtn.innerHTML;
        downloadPdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating PDF...';
        downloadPdfBtn.disabled = true;

        let tableRowsHtml = '';
        let totalOrderCost = 0;
        const tbody = document.getElementById('poItemsTableBody');
        if (tbody) {
            const rows = tbody.querySelectorAll('tr.po-draft-row');
            rows.forEach(row => {
                const sku = row.getAttribute('data-sku');
                const name = row.getAttribute('data-name');
                const price = parseFloat(row.getAttribute('data-wholesale-price')) || 0;
                const qtyInput = row.querySelector('.po-item-qty-input');
                const qty = parseInt(qtyInput.value) || 0;
                const total = qty * price;
                totalOrderCost += total;
                
                tableRowsHtml += `
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 10px 12px; font-family: monospace; font-weight: 600; color: #475569; text-align: center;">${sku}</td>
                        <td style="padding: 10px 12px; font-weight: 600; color: #0f172a;">${name}</td>
                        <td style="padding: 10px 12px; text-align: center; font-weight: 700; color: #0f172a;">${qty.toLocaleString()}</td>
                        <td style="padding: 10px 12px; text-align: right; color: #475569;">${symbol}${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #10b981;">${symbol}${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                `;
            });
        }

        const element = document.createElement('div');
        element.innerHTML = `
            <div style="font-family: 'Outfit', sans-serif; color: #1e293b; padding: 40px; background: #ffffff; line-height: 1.5; box-sizing: border-box;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #8b5cf6; padding-bottom: 20px; margin-bottom: 25px;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <svg width="34" height="34" viewBox="0 0 1517 1517" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="587.006" y="481.033" width="150" height="150" rx="10" transform="rotate(135 587.006 481.033)" fill="#1F1F1F"/>
                            <rect x="864.285" y="1312.59" width="150" height="150" rx="10" transform="rotate(135 864.285 1312.59)" fill="#1F1F1F"/>
                            <rect x="1418.66" y="758.219" width="150" height="150" rx="10" transform="rotate(135 1418.66 758.219)" fill="#1F1F1F"/>
                            <rect x="864.285" y="203.847" width="150" height="150" rx="10" transform="rotate(135 864.285 203.847)" fill="#1F1F1F"/>
                            <path d="M488.104 1134.4C484.199 1138.31 477.868 1138.3 473.963 1134.4L382.039 1042.48C378.134 1038.57 378.134 1032.24 382.039 1028.33L473.963 936.41C477.868 932.505 484.199 932.505 488.104 936.41L549.062 997.368C567.816 1016.12 593.251 1026.66 619.773 1026.66H896.572C923.094 1026.66 948.529 1016.12 967.283 997.368L997.368 967.283C1016.12 948.529 1026.66 923.094 1026.66 896.572V619.773C1026.66 593.251 1016.12 567.816 997.368 549.062L936.41 488.104C932.505 484.199 932.505 477.868 936.41 473.963L1028.33 382.039C1032.24 378.134 1038.57 378.134 1042.48 382.039L1134.4 473.963C1138.3 477.868 1138.31 484.199 1134.4 488.104L1074.95 547.558C1056.19 566.312 1045.66 591.747 1045.66 618.269V898.263C1045.66 924.785 1056.19 950.22 1074.95 968.974L1134.31 1028.33C1138.21 1032.24 1138.21 1038.57 1134.31 1042.48L1042.38 1134.4C1038.48 1138.3 1032.15 1138.3 1028.24 1134.4L968.787 1074.95C950.033 1056.19 924.598 1045.66 898.076 1045.66H618.269C591.747 1045.66 566.312 1056.19 547.558 1074.95L488.104 1134.4Z" fill="#1F1F1F"/>
                            <path fill-rule="evenodd" clip-rule="evenodd" d="M210.919 857.214C207.013 861.119 200.681 861.119 196.776 857.214L104.852 765.29C100.947 761.384 100.947 755.053 104.852 751.148L196.776 659.224C200.681 655.319 207.013 655.319 210.919 659.224L272.062 720.368C290.816 739.121 316.251 749.657 342.773 749.657H619.2C645.722 749.657 671.157 739.121 689.911 720.368L751.054 659.224C754.96 655.319 761.292 655.319 765.197 659.224L857.121 751.148C861.026 755.053 861.026 761.384 857.121 765.29L765.197 857.214C761.292 861.119 754.96 861.119 751.054 857.214L691.787 797.946C673.033 779.193 647.598 768.657 621.076 768.657H340.897C314.375 768.657 288.94 779.193 270.186 797.946L210.919 857.214Z" fill="#1F1F1F"/>
                        </svg>
                        <div>
                            <h1 style="margin: 0; color: #8b5cf6; font-size: 20px; font-weight: 700; letter-spacing: -0.02em;">StockSense AI</h1>
                            <p style="margin: 2px 0 0 0; font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Intelligent Replenishment Engine</p>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <h2 style="margin: 0; color: #0f172a; font-size: 20px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;">Purchase Order</h2>
                        <p style="margin: 3px 0 0 0; font-size: 12px; color: #64748b;">PO Ref: <span style="font-family: monospace; font-weight: 600; color: #1e293b;">PO-CONS-${Math.floor(1000 + Math.random() * 9000)}</span></p>
                    </div>
                </div>

                <div style="display: flex; justify-content: space-between; gap: 30px; margin-bottom: 30px;">
                    <div style="flex: 1;">
                        <h3 style="margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; letter-spacing: 0.05em;">Buyer Information</h3>
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 15px; font-size: 13px; min-height: 80px;">
                            <p style="margin: 0; font-weight: 700; color: #0f172a;">${orgName}</p>
                            <p style="margin: 4px 0 0 0; color: #475569; font-size: 12px;">Procurement Department</p>
                            <p style="margin: 4px 0 0 0; color: #475569; font-size: 12px;">Consolidated Replenishment Order</p>
                        </div>
                   </div>
                   <div style="flex: 1;">
                       <h3 style="margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; letter-spacing: 0.05em;">Supplier Information</h3>
                       <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 15px; font-size: 13px; min-height: 80px;">
                           <p style="margin: 0; font-weight: 700; color: #0f172a;">${supplier}</p>
                           <p style="margin: 4px 0 0 0; color: #475569; font-size: 12px;">${leadDaysText}</p>
                           <p style="margin: 4px 0 0 0; color: #7c3aed; font-size: 12px; font-weight: 600;">Status: Draft Replenishment</p>
                       </div>
                   </div>
               </div>

               <div style="background: #faf5ff; border: 1px solid #f3e8ff; border-radius: 8px; padding: 12px 15px; margin-bottom: 30px; display: flex; justify-content: space-between; font-size: 12px; color: #7c3aed;">
                   <div><strong>Order Date:</strong> ${new Date().toLocaleDateString(undefined, { dateStyle: 'long' })}</div>
                   <div><strong>AI Model Authority:</strong> Weekly Prophet ML Core & SHAP</div>
               </div>

               <h3 style="margin: 0 0 10px 0; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; letter-spacing: 0.05em; text-align: center;">Order Line Items</h3>
               <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 13px;">
                   <thead>
                       <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                           <th style="text-align: center; padding: 12px; color: #475569; font-weight: 600;">SKU Code</th>
                           <th style="text-align: left; padding: 12px; color: #475569; font-weight: 600;">Product Description</th>
                           <th style="text-align: center; padding: 12px; color: #475569; font-weight: 600;">Quantity</th>
                           <th style="text-align: right; padding: 12px; color: #475569; font-weight: 600;">Unit Cost</th>
                           <th style="text-align: right; padding: 12px; color: #475569; font-weight: 600;">Total Cost</th>
                       </tr>
                   </thead>
                   <tbody>
                       ${tableRowsHtml}
                   </tbody>
               </table>

               <div style="display: flex; justify-content: flex-end; margin-bottom: 40px;">
                   <div style="width: 250px; font-size: 13px;">
                       <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #e2e8f0; color: #64748b;">
                           <span>Subtotal</span>
                           <span>${symbol}${totalOrderCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                       </div>
                       <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #e2e8f0; color: #64748b;">
                           <span>Shipping/Handling</span>
                           <span>Free / Included</span>
                       </div>
                       <div style="display: flex; justify-content: space-between; padding: 10px 0; font-size: 15px; font-weight: 700; color: #0f172a;">
                           <span>Total Amount Due</span>
                           <span style="color: #8b5cf6;">${symbol}${totalOrderCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                       </div>
                   </div>
               </div>

               <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 60px; border-top: 1px solid #e2e8f0; padding-top: 25px; font-size: 12px; color: #64748b;">
                   <div>
                       <div style="border-bottom: 1px solid #cbd5e1; width: 180px; height: 35px;"></div>
                       <p style="margin: 8px 0 0 0; font-weight: 500;">Buyer Procurement Officer</p>
                   </div>
                   <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end;">
                       <div style="border: 1px solid rgba(139, 92, 246, 0.2); background: rgba(139, 92, 246, 0.05); color: #8b5cf6; padding: 4px 10px; border-radius: 4px; font-weight: 700; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase;">
                           StockSense AI Verified
                       </div>
                       <p style="margin: 6px 0 0 0; font-size: 11px; color: #94a3b8;">Automated Replenishment Optimization</p>
                   </div>
               </div>

               <div style="margin-top: 60px; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 15px; font-size: 9px; color: #94a3b8; line-height: 1.4;">
                   Important Notice: This purchase order has been generated automatically via StockSense AI inventory demand planning suite. Recommended order counts ensure optimal inventory coverage and mitigate stockout frequencies.
               </div>
           </div>
       `;

       const opt = {
           margin: [10, 10, 10, 10],
           filename: `StockSense_PurchaseOrder_Consolidated.pdf`,
           image: { type: 'jpeg', quality: 0.98 },
           html2canvas: { scale: 2, useCORS: true, logging: false },
           jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
       };

       html2pdf().set(opt).from(element).save().then(() => {
           downloadPdfBtn.innerHTML = originalHTML;
           downloadPdfBtn.disabled = false;
           addNotification('PO PDF Downloaded', `Consolidated Purchase Order PDF is downloaded.`, 'success');
           closeModal();
       }).catch(err => {
           console.error('PDF Generation failed: ', err);
           downloadPdfBtn.innerHTML = originalHTML;
           downloadPdfBtn.disabled = false;
           addNotification('PDF Export Failed', 'An error occurred during PDF generation.', 'danger');
       });
   });

    // Confirm & Log PO in local SQLite database
    confirmBtn.addEventListener('click', async () => {
        const supplier = document.getElementById('poSupplierName').value || 'Supplier Global Logistics';
        const tbody = document.getElementById('poItemsTableBody');
        if (!tbody) return;

        const items = [];
        let maxLeadDays = 7;
        
        const rows = tbody.querySelectorAll('tr.po-draft-row');
        rows.forEach(row => {
            const sku = row.getAttribute('data-sku');
            const name = row.getAttribute('data-name');
            const price = parseFloat(row.getAttribute('data-wholesale-price')) || 0;
            const leadDays = parseInt(row.getAttribute('data-lead-days')) || 7;
            
            const qtyInput = row.querySelector('.po-item-qty-input');
            const qty = parseInt(qtyInput.value) || 0;
            
            if (leadDays > maxLeadDays) {
                maxLeadDays = leadDays;
            }

            items.push({
                sku: sku,
                name: name,
                quantity: qty,
                unit_price: price
            });
        });

        if (items.length === 0) {
            addNotification('Empty Order', 'Please select at least one item to log a PO.', 'warning');
            return;
        }

        const today = new Date();
        const orderDateStr = today.toISOString().split('T')[0];
        const deliveryDate = new Date(today);
        deliveryDate.setDate(today.getDate() + maxLeadDays);
        const deliveryDateStr = deliveryDate.toISOString().split('T')[0];

        const refSuffix = items.length === 1 ? items[0].sku : 'CONS';
        const poId = `PO-${refSuffix}-${Math.floor(1000 + Math.random() * 9000)}`;

        const poPayload = {
            id: poId,
            supplier: supplier,
            order_date: orderDateStr,
            delivery_date: deliveryDateStr,
            items: items
        };

        try {
            const token = localStorage.getItem('stockSense_jwt');
            const res = await fetch('/api/purchase_orders', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(poPayload)
            });

            const data = await res.json();
            if (data.status === 'success') {
                addNotification('PO Saved & Logged', `Purchase Order ${poId} was created and logged as Draft.`, 'success');
                modal.classList.remove('open');
                modal.style.pointerEvents = 'none';
                
                // Clear checkboxes and selection
                selectedInventorySKUs.clear();
                const selectAllCb = document.getElementById('selectAllInventory');
                if (selectAllCb) selectAllCb.checked = false;
                
                // Re-render inventory to clear checkbox visuals
                const activeTab = document.querySelector('.nav-item.active');
                if (activeTab && activeTab.id === 'navInventory') {
                    renderInventoryTable(currentFilteredData, currentInventoryPage);
                } else {
                    updateConsolidatedPoButtonState();
                }

                loadPoLedger(); // Refresh the ledger list
            } else {
                addNotification('PO Draft Failed', data.message || 'Could not draft Purchase Order.', 'warning');
            }
        } catch (error) {
            console.error("PO logging failed:", error);
            addNotification('Connection Error', 'Failed to connect to server to log Purchase Order.', 'danger');
        }
    });
}

function recalculatePoTotalsAndEmail() {
    const tbody = document.getElementById('poItemsTableBody');
    if (!tbody) return;

    const currency = localStorage.getItem('stockSense_cfgCurrency') || 'BDT';
    const symbols = { 'USD': '$', 'CAD': 'C$', 'CNY': '¥', 'BDT': '৳' };
    const symbol = symbols[currency.toUpperCase()] || '৳';

    let grandTotal = 0;
    const items = [];

    const rows = tbody.querySelectorAll('tr.po-draft-row');
    rows.forEach(row => {
        const sku = row.getAttribute('data-sku');
        const name = row.getAttribute('data-name');
        const price = parseFloat(row.getAttribute('data-wholesale-price')) || 0;
        const leadDays = parseInt(row.getAttribute('data-lead-days')) || 7;
        const category = row.getAttribute('data-category') || 'General';
        
        const qtyInput = row.querySelector('.po-item-qty-input');
        const qty = parseInt(qtyInput.value) || 0;
        const total = qty * price;
        grandTotal += total;

        const totalCostCell = row.querySelector('.po-item-total-cost');
        if (totalCostCell) {
            totalCostCell.textContent = symbol + total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        items.push({ sku, name, qty, price, category, leadDays });
    });

    const grandTotalEl = document.getElementById('poGrandTotal');
    if (grandTotalEl) {
        grandTotalEl.textContent = symbol + grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    const orgName = localStorage.getItem('stockSense_storeName') || 'Store 12';
    const emailSubjectEl = document.getElementById('poEmailSubject');
    const emailBodyEl = document.getElementById('poEmailBody');

    if (emailSubjectEl && emailBodyEl) {
        if (items.length === 1) {
            emailSubjectEl.textContent = `Urgent Stock Procurement Request: ${items[0].name} (SKU: ${items[0].sku})`;
        } else {
            emailSubjectEl.textContent = `Urgent Stock Procurement Request: Consolidated Order (${items.length} SKUs)`;
        }

        let itemBullets = '';
        items.forEach(item => {
            itemBullets += `• Product Name: ${item.name}\n  SKU Code: ${item.sku}\n  Category: ${item.category}\n  Quantity: ${item.qty.toLocaleString()} units\n  Unit Price: ${symbol}${item.price.toFixed(2)} (Wholesale rate)\n  Lead Time: ${item.leadDays} days\n\n`;
        });

        emailBodyEl.value = `Dear Sales and Logistics Team,

I hope this message finds you well.

Based on our automated StockSense AI predictive demand models for ${orgName}, we are projecting a significant sales surge for our products over the coming week. To prevent out-of-stock events and satisfy our customers, we would like to immediately place a consolidated replenishment purchase order.

Please find the structured order details below:

${itemBullets}Please confirm receipt of this purchase order and reply with a formal invoice and estimated dispatch date at your earliest convenience. If you have any questions regarding these quantities, feel free to contact our inventory desk.

Thank you for your continued support as a valued supply partner.

Best regards,
Procurement Officer
${orgName}
Powered by StockSense AI`;
    }
}

async function openDraftPO(skuOrSkus, name, stock) {
    const modal = document.getElementById('draftPoModal');
    if (!modal) return;

    const skus = Array.isArray(skuOrSkus) ? skuOrSkus : [skuOrSkus];
    if (skus.length === 0) return;

    try {
        const token = localStorage.getItem('stockSense_jwt');
        
        // Fetch draft details for all SKUs in parallel
        const promises = skus.map(sku => 
            fetch(`/api/purchase_order/draft?sku=${encodeURIComponent(sku)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(res => {
                if (!res.ok) throw new Error(`Failed to fetch draft for SKU ${sku}`);
                return res.json();
            })
        );
        
        const results = await Promise.all(promises);
        const validResults = results.filter(r => r.status === 'success');
        
        if (validResults.length > 0) {
            const currency = localStorage.getItem('stockSense_cfgCurrency') || 'BDT';
            const symbols = { 'USD': '$', 'CAD': 'C$', 'CNY': '¥', 'BDT': '৳' };
            const symbol = symbols[currency.toUpperCase()] || '৳';

            // Find max lead days among all selected products
            const maxLeadDays = Math.max(...validResults.map(r => r.lead_days || 7));
            document.getElementById('poLeadDays').textContent = `${maxLeadDays} Days Lead (Max)`;

            // Set default supplier (first item's supplier or general default)
            const defaultSupplier = validResults[0].supplier || 'Supplier Global Logistics';
            document.getElementById('poSupplierName').value = defaultSupplier;

            // Render line items
            const tbody = document.getElementById('poItemsTableBody');
            tbody.innerHTML = '';
            
            validResults.forEach(data => {
                const tr = document.createElement('tr');
                tr.className = 'po-draft-row';
                tr.setAttribute('data-sku', data.sku);
                tr.setAttribute('data-name', data.name);
                tr.setAttribute('data-wholesale-price', data.wholesale_price);
                tr.setAttribute('data-category', data.category);
                tr.setAttribute('data-lead-days', data.lead_days);

                tr.innerHTML = `
                    <td style="font-family: monospace; font-size: 0.78rem; color: var(--text-muted); white-space: nowrap; text-align: center;">${data.sku}</td>
                    <td style="font-size: 0.82rem; font-weight: 600; color: var(--text-primary);">${data.name}</td>
                    <td style="font-size: 0.82rem; text-align: center; white-space: nowrap;">${data.current_stock.toLocaleString()}</td>
                    <td style="font-size: 0.82rem; text-align: center; white-space: nowrap;">${data.forecasted_demand.toLocaleString()}</td>
                    <td style="text-align: center; white-space: nowrap;">
                        <input type="number" class="po-item-qty-input settings-input" style="width: 68px; padding: 0.25rem 0.4rem; text-align: center; font-weight: 700; background: rgba(139,92,246,0.1); border-color: rgba(139,92,246,0.4); margin: 0; display: inline-block; font-size: 0.8rem;" value="${data.recommended_qty}" min="0">
                    </td>
                    <td style="font-size: 0.82rem; text-align: right; white-space: nowrap;">${symbol}${data.wholesale_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td class="po-item-total-cost" style="font-size: 0.82rem; text-align: right; font-weight: 700; color: var(--status-success); white-space: nowrap;">${symbol}${data.total_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                `;
                tbody.appendChild(tr);
            });

            // Perform initial total calculation and email generation
            recalculatePoTotalsAndEmail();

            // Open modal
            modal.style.pointerEvents = 'auto';
            modal.classList.add('open');
        } else {
            addNotification('Draft Failed', 'Could not fetch draft details for the selected products.', 'warning');
        }
    } catch (e) {
        console.error("Failed to load PO draft details:", e);
        addNotification('Error', 'Failed to connect to the backend to generate Purchase Order.', 'error');
    }
}

async function schedulePromotion(id, title, discountPct, type, startDate, endDate, targetProduct, targetSku, expectedImpact, urgency, reason) {
    const btn = document.getElementById(`btn-promo-${id}`);
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scheduling...';
        btn.disabled = true;
    }

    try {
        const token = localStorage.getItem('stockSense_jwt');
        const response = await fetch('/api/promotions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                id, title, type,
                start_date: startDate,
                end_date: endDate,
                target_product: targetProduct,
                target_sku: targetSku,
                discount_pct: discountPct,
                expected_impact: expectedImpact,
                urgency, reason
            })
        });

        const result = await response.json();
        if (result.status === 'success') {
            scheduledPromoIds.add(id);
            addNotification(
                '📅 Campaign Scheduled',
                `Successfully scheduled '${title}' for ${targetProduct} (${discountPct} off).`,
                'success'
            );
            
            // Re-render suggestions to lock scheduled state
            const lastResult = JSON.parse(localStorage.getItem('stockSense_lastResult') || '{}');
            if (lastResult.promo_suggestions) {
                renderPromoSuggestions(lastResult.promo_suggestions);
            }
            
            // Trigger automatic re-forecasting so model registers promotion impact!
            addNotification('AI Model Syncing', 'Re-computing Facebook Prophet demand projections incorporating scheduled campaign...', 'info');
            reforecastFromInventory();
        } else {
            addNotification('Scheduling Failed', result.message || 'Could not schedule campaign.', 'warning');
            if (btn) {
                btn.innerHTML = '<i class="fa-solid fa-calendar-plus"></i> Schedule Campaign';
                btn.disabled = false;
            }
        }
    } catch (e) {
        console.error("Failed to schedule promotion:", e);
        addNotification('Error', 'Failed to connect to server to schedule campaign.', 'error');
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-calendar-plus"></i> Schedule Campaign';
            btn.disabled = false;
        }
    }
}

async function loadScheduledPromotions() {
    try {
        const token = localStorage.getItem('stockSense_jwt');
        if (!token) return;
        const response = await fetch('/api/promotions', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.status === 'success' && data.promotions) {
            scheduledPromoIds = new Set(data.promotions.map(p => p.id));
        }
    } catch (e) {
        console.warn("Failed to load scheduled promotions:", e);
    }
}

window.schedulePromotion = schedulePromotion;
window.openDraftPO = openDraftPO;

// ====================================================
// Product Telemetry Side-Drawer & Persistent PO Logic
// ====================================================

let drawerChartInstance = null;

async function openTelemetryDrawer(item) {
    const drawer = document.getElementById('productTelemetryDrawer');
    if (!drawer) return;

    // Populate static fields
    document.getElementById('drawerSku').textContent = item.sku;
    document.getElementById('drawerProdName').textContent = item.name;
    document.getElementById('drawerCategoryBadge').textContent = item.category;
    document.getElementById('drawerStock').textContent = item.stock.toLocaleString();
    document.getElementById('drawerReorderPt').textContent = item.reorder_point !== undefined ? item.reorder_point : '50';
    document.getElementById('drawerLeadTime').textContent = `${item.supplier_lead_days || 7}d`;
    
    const supplierName = item.supplier && item.supplier.trim() ? item.supplier : `${item.category} Global Logistics`;
    document.getElementById('drawerSupplier').textContent = supplierName;

    // Configure Status Card styling dynamically
    const statusCard = document.getElementById('drawerStatusCard');
    const statusIcon = document.getElementById('drawerStatusIcon');
    const statusText = document.getElementById('drawerStatusText');
    const statusSub = document.getElementById('drawerStatusSub');

    statusCard.className = 'drawer-status-card'; // reset classes
    
    if (item.stock <= 0) {
        statusCard.classList.add('status-danger');
        statusIcon.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color: var(--status-danger);"></i>';
        statusText.textContent = 'Out of Stock';
        statusSub.textContent = 'Immediate procurement required to fulfill customer demand.';
    } else if (item.stock <= (item.reorder_point || 50)) {
        statusCard.classList.add('status-warning');
        statusIcon.innerHTML = '<i class="fa-solid fa-clock-rotate-left" style="color: var(--status-warning);"></i>';
        statusText.textContent = 'Low Stock';
        statusSub.textContent = 'Stock level is below safety threshold. Reorder recommended.';
    } else {
        statusCard.classList.add('status-success');
        statusIcon.innerHTML = '<i class="fa-solid fa-circle-check" style="color: var(--status-success);"></i>';
        statusText.textContent = 'In Stock';
        statusSub.textContent = 'Inventory level is healthy for immediate fulfillment.';
    }

    // Configure the Draft PO action button inside the drawer
    const drawerPoBtn = document.getElementById('drawerCreatePoBtn');
    if (drawerPoBtn) {
        // Re-bind listener for this specific SKU
        drawerPoBtn.onclick = () => {
            closeTelemetryDrawer();
            openDraftPO(item.sku, item.name, item.stock);
        };
    }

    // Slide in the drawer!
    drawer.classList.add('drawer-open');

    // Render Mini Line Chart (actual sales history vs forecast predictions)
    renderDrawerChart(item.sku);
}

function closeTelemetryDrawer() {
    const drawer = document.getElementById('productTelemetryDrawer');
    if (drawer) {
        drawer.classList.remove('drawer-open');
    }
}

// Bind Close Drawer event triggers
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('closeTelemetryDrawer');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeTelemetryDrawer);
    }
});

async function renderDrawerChart(sku) {
    const canvas = document.getElementById('drawerForecastChart');
    if (!canvas) return;

    // Destroy existing instance to prevent memory leaks
    if (drawerChartInstance) {
        drawerChartInstance.destroy();
        drawerChartInstance = null;
    }

    try {
        const token = localStorage.getItem('stockSense_jwt');
        const res = await fetch(`/api/forecast/${encodeURIComponent(sku)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error("Forecast not generated or SKU not found.");
        
        const data = await res.json();
        if (data.status === 'success' && data.forecast) {
            const labels = data.forecast.map(row => {
                const dateObj = new Date(row.forecast_date);
                return dateObj.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
            });
            const predictedSales = data.forecast.map(row => Math.round(row.predicted_sales * 10) / 10);

            const ctx = canvas.getContext('2d');
            
            const gradient = ctx.createLinearGradient(0, 0, 0, 160);
            gradient.addColorStop(0, 'rgba(139, 92, 246, 0.4)');
            gradient.addColorStop(1, 'rgba(139, 92, 246, 0.0)');

            drawerChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'AI Projected Daily Sales',
                        data: predictedSales,
                        borderColor: '#a78bfa',
                        borderWidth: 2,
                        backgroundColor: gradient,
                        fill: true,
                        tension: 0.35,
                        pointBackgroundColor: '#8b5cf6',
                        pointBorderColor: '#fff',
                        pointHoverRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return `Predicted: ${context.parsed.y} units`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: { color: 'rgba(255, 255, 255, 0.4)', font: { size: 9 } }
                        },
                        y: {
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: { color: 'rgba(255, 255, 255, 0.4)', font: { size: 9 } }
                        }
                    }
                }
            });
            updateChartsForTheme();
        }
    } catch (e) {
        // Render a clean fallback label if no forecast was loaded
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '12px "Outfit", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText("Upload CSV to calculate predictions", canvas.width / 2, canvas.height / 2);
    }
}

// --- PO Persistent Ledger Backend Integrations ---

async function loadPoLedger() {
    const tbody = document.getElementById('poLedgerTableBody');
    const badge = document.getElementById('poCountBadge');
    if (!tbody || !badge) return;

    try {
        const token = localStorage.getItem('stockSense_jwt');
        const res = await fetch('/api/purchase_orders', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const result = await res.json();
        if (result.status === 'success' && result.data) {
            const data = result.data;
            badge.innerText = `${data.length} ${data.length === 1 ? 'Order' : 'Orders'}`;

            if (data.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" style="text-align:center; color: var(--text-muted); padding: 2rem;">
                            <i class="fa-solid fa-folder-open" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem; color: var(--accent-primary);"></i>
                            No purchase orders logged in database yet.
                        </td>
                    </tr>`;
                return;
            }

            tbody.innerHTML = '';
            
            const currency = localStorage.getItem('stockSense_cfgCurrency') || 'BDT';
            const symbols = { 'USD': '$', 'CAD': 'C$', 'CNY': '¥', 'BDT': '৳' };
            const symbol = symbols[currency.toUpperCase()] || '৳';

            data.forEach(po => {
                const tr = document.createElement('tr');
                
                let statusClass = 'in-stock'; // Green for Received
                if (po.status === 'Draft') statusClass = 'neutral-badge';
                if (po.status === 'Ordered') statusClass = 'low-stock'; // Yellow
                if (po.status === 'Cancelled') statusClass = 'out-of-stock'; // Red

                const statusPillStyle = po.status === 'Draft' ? 'background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.15); color: var(--text-secondary);' : '';

                tr.innerHTML = `
                    <td style="font-family: monospace; font-weight: 600; color: var(--text-muted);">${po.id}</td>
                    <td style="font-weight: 500; color: #fff;">${po.supplier}</td>
                    <td>${po.order_date}</td>
                    <td>${po.delivery_date}</td>
                    <td style="text-align: right; font-weight: 600; color: var(--status-success);">${symbol}${Number(po.total_amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    <td><span class="status-pill ${statusClass}" style="${statusPillStyle}">${po.status}</span></td>
                    <td style="text-align: right; white-space: nowrap; display: flex; justify-content: flex-end; gap: 0.5rem;">
                        ${po.status !== 'Received' ? `
                            <button class="primary-btn action-receive-po" data-po-id="${po.id}" style="padding: 0 0.65rem; height: 32px; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 0.35rem; background: linear-gradient(135deg, var(--status-success), #047857);">
                                <i class="fa-solid fa-square-check"></i> Receive
                            </button>
                        ` : ''}
                        <button class="icon-btn action-delete-po" data-po-id="${po.id}" title="Delete PO Record" style="color: var(--status-danger); width: 32px; height: 32px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); display: inline-flex; align-items: center; justify-content: center; vertical-align: middle;">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            // Re-bind Action Handlers
            document.querySelectorAll('.action-receive-po').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const poId = e.currentTarget.getAttribute('data-po-id');
                    await markPoAsReceived(poId);
                });
            });

            document.querySelectorAll('.action-delete-po').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const poId = e.currentTarget.getAttribute('data-po-id');
                    showConfirm(`Are you sure you want to delete PO Record ${poId}?`, async () => {
                        await deletePo(poId);
                    });
                });
            });
        }
    } catch (e) {
        console.warn("Failed to load PO Ledger list:", e);
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--status-danger);">Failed to query PO ledger database.</td></tr>`;
    }
}

async function markPoAsReceived(poId) {
    try {
        const token = localStorage.getItem('stockSense_jwt');
        const res = await fetch(`/api/purchase_orders/${encodeURIComponent(poId)}/status`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: 'Received' })
        });
        
        const data = await res.json();
        if (data.status === 'success') {
            addNotification('Inventory Reconciled', `Stock values updated for all products in PO ${poId}.`, 'success');
            loadPoLedger();
            loadInventoryData();
        } else {
            addNotification('Verification Failed', data.message || 'Could not update order status.', 'warning');
        }
    } catch (error) {
        console.error("Receive PO failed:", error);
    }
}

async function deletePo(poId) {
    try {
        const token = localStorage.getItem('stockSense_jwt');
        const res = await fetch(`/api/purchase_orders/${encodeURIComponent(poId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await res.json();
        if (data.status === 'success') {
            addNotification('PO Deleted', `Purchase Order ${poId} removed successfully.`, 'success');
            loadPoLedger();
        } else {
            addNotification('Delete Failed', data.message || 'Could not remove order.', 'warning');
        }
    } catch (error) {
        console.error("Delete PO failed:", error);
    }
}

// --- Financial Control Tower Methods ---
let _financialsCache = null;
let financialsCategoryChartInstance = null;
let financialsSpendChartInstance = null;

async function loadFinancialsData() {
    try {
        const token = localStorage.getItem('stockSense_jwt');
        const res = await fetch('/api/financials/summary', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await res.json();
        
        if (result.status === 'success') {
            _financialsCache = result;
            updateFinancialsUI();
        } else {
            console.error("Failed to load financials summary:", result.message);
        }
    } catch (err) {
        console.error("Error loading financials:", err);
    }
}

function updateFinancialsUI() {
    if (!_financialsCache) return;
    
    const kpis = _financialsCache.kpis;
    const catAlloc = _financialsCache.category_allocation;
    const spendVel = _financialsCache.spend_velocity;
    
    // Set KPI values
    const capTiedElem = document.getElementById('financial-capital-tied');
    const retValElem = document.getElementById('financial-retail-value');
    const revRiskElem = document.getElementById('financial-revenue-at-risk');
    const totalSpendElem = document.getElementById('financial-total-spend');
    
    if (capTiedElem) capTiedElem.innerText = formatCurrency(kpis.capital_tied_up);
    if (retValElem) retValElem.innerText = formatCurrency(kpis.retail_value);
    if (revRiskElem) revRiskElem.innerText = formatCurrency(kpis.revenue_at_risk);
    if (totalSpendElem) totalSpendElem.innerText = formatCurrency(kpis.total_spend);
    
    const marginSubElem = document.getElementById('financial-margin-percentage');
    if (marginSubElem && kpis.retail_value > 0) {
        const grossMargin = ((kpis.retail_value - kpis.capital_tied_up) / kpis.retail_value) * 100.0;
        marginSubElem.innerText = `Portfolio Margin: ${grossMargin.toFixed(1)}%`;
    }
    
    // Update Category Table
    const tableBody = document.getElementById('financialsCategoryTableBody');
    if (tableBody) {
        tableBody.innerHTML = '';
        if (catAlloc.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">No category data available. Upload inventory CSV.</td></tr>';
        } else {
            catAlloc.forEach(c => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding: 0.75rem 0.5rem; font-weight: 500; color: var(--text-primary);"><i class="fa-solid fa-folder-open" style="color: var(--accent-primary); margin-right: 0.5rem; font-size: 0.85rem;"></i> ${c.category}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-secondary);">${c.units.toLocaleString()}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--text-primary); font-weight: 600;">${formatCurrency(c.capital_tied_up)}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--status-success); font-weight: 500;">${formatCurrency(c.retail_value)}</td>
                    <td style="padding: 0.75rem 0.5rem; text-align: right; color: var(--accent-secondary); font-weight: 600;">${c.margin_pct.toFixed(1)}%</td>
                `;
                tableBody.appendChild(tr);
            });
        }
    }
    
    // ----------------------------------------
    // RENDER CHART 1: Category Capital allocation
    // ----------------------------------------
    const categoryCanvas = document.getElementById('financialsCategoryChart');
    if (categoryCanvas) {
        const categoryCtx = categoryCanvas.getContext('2d');
        if (financialsCategoryChartInstance) financialsCategoryChartInstance.destroy();
        
        const categoryLabels = catAlloc.map(c => c.category);
        const categoryData = catAlloc.map(c => c.capital_tied_up);
        
        if (categoryLabels.length === 0) {
            categoryLabels.push("Awaiting Data");
            categoryData.push(0);
        }
        
        financialsCategoryChartInstance = new Chart(categoryCtx, {
            type: 'doughnut',
            data: {
                labels: categoryLabels,
                datasets: [{
                    data: categoryData,
                    backgroundColor: [
                        'rgba(139, 92, 246, 0.7)',
                        'rgba(59, 130, 246, 0.7)',
                        'rgba(16, 185, 129, 0.7)',
                        'rgba(245, 158, 11, 0.7)',
                        'rgba(239, 68, 68, 0.7)'
                    ],
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: 'rgba(255, 255, 255, 0.7)',
                            font: { family: "'Outfit', sans-serif", size: 10 },
                            boxWidth: 10
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return ` ${context.label}: ${formatCurrency(context.raw)}`;
                            }
                        }
                    }
                }
            }
        });
    }
    
    // ----------------------------------------
    // RENDER CHART 2: Spend Velocity Bar Chart
    // ----------------------------------------
    const spendCanvas = document.getElementById('financialsSpendChart');
    if (spendCanvas) {
        const spendCtx = spendCanvas.getContext('2d');
        if (financialsSpendChartInstance) financialsSpendChartInstance.destroy();
        
        const spendLabels = spendVel.map(s => s.month);
        const spendData = spendVel.map(s => s.amount);
        
        if (spendLabels.length === 0) {
            spendLabels.push("Awaiting Data");
            spendData.push(0);
        }
        
        financialsSpendChartInstance = new Chart(spendCtx, {
            type: 'bar',
            data: {
                labels: spendLabels,
                datasets: [{
                    label: 'Procurement Outflow',
                    data: spendData,
                    backgroundColor: 'rgba(16, 185, 129, 0.55)',
                    borderColor: '#10b981',
                    borderWidth: 1.5,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.5)',
                            font: { family: "'Outfit', sans-serif" },
                            callback: function(value) {
                                return getCurrencySymbol() + value.toLocaleString();
                            }
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.5)',
                            font: { family: "'Outfit', sans-serif" }
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return ` Spend: ${formatCurrency(context.raw)}`;
                            }
                        }
                    }
                }
            }
        });
        updateChartsForTheme();
    }
    
    // Setup Slider listener once if not already bound
    const slider = document.getElementById('roiBufferSlider');
    if (slider && !slider.dataset.bound) {
        slider.addEventListener('input', simulateROI);
        slider.dataset.bound = "true";
    }
    
    simulateROI();
}

function simulateROI() {
    const slider = document.getElementById('roiBufferSlider');
    if (!slider) return;
    
    const M = parseFloat(slider.value);
    const sliderVal = document.getElementById('roiSliderVal');
    if (sliderVal) sliderVal.innerText = M.toFixed(1) + 'x';
    
    if (!_financialsCache || !_financialsCache.kpis) return;
    
    const baseRisk = _financialsCache.kpis.revenue_at_risk;
    const baseCapital = _financialsCache.kpis.capital_tied_up;
    
    let additionalCapital = 0;
    if (M > 1.4) {
        additionalCapital = baseCapital * (M - 1.4) * 0.45;
    } else {
        additionalCapital = -baseCapital * (1.4 - M) * 0.25;
    }
    
    if (additionalCapital < 0) additionalCapital = Math.max(-baseCapital * 0.3, additionalCapital);
    
    let recoveredRevenue = 0;
    if (baseRisk > 0) {
        recoveredRevenue = baseRisk * Math.min(1.0, Math.max(0.0, (M - 1.0) / 0.6));
    }
    
    let roiPct = 0;
    const profitGenerated = recoveredRevenue * 0.3;
    if (additionalCapital > 0) {
        roiPct = (profitGenerated / additionalCapital) * 100.0;
    } else if (additionalCapital < 0) {
        roiPct = (profitGenerated / Math.abs(additionalCapital)) * 100.0;
    } else {
        roiPct = 42.8; 
    }
    
    const capReqElem = document.getElementById('roiCapitalRequired');
    if (capReqElem) {
        if (additionalCapital >= 0) {
            capReqElem.innerText = `+${formatCurrency(additionalCapital)}`;
            capReqElem.style.color = 'var(--text-primary)';
        } else {
            capReqElem.innerText = `-${formatCurrency(Math.abs(additionalCapital))}`;
            capReqElem.style.color = 'var(--status-info)';
        }
    }
    
    const recRevElem = document.getElementById('roiRecoveredRevenue');
    if (recRevElem) recRevElem.innerText = formatCurrency(recoveredRevenue);
    
    const netRoiElem = document.getElementById('roiNetProjection');
    if (netRoiElem) {
        if (roiPct > 0) {
            netRoiElem.innerText = `${roiPct.toFixed(1)}% Return`;
            netRoiElem.style.color = 'var(--accent-primary)';
        } else {
            netRoiElem.innerText = `0.0% Return`;
            netRoiElem.style.color = 'var(--text-muted)';
        }
    }
}

function updateSelectAllCheckboxState() {
    const selectAllCb = document.getElementById('selectAllInventory');
    if (!selectAllCb) return;

    const pageCbs = document.querySelectorAll('.inventory-select-row');
    if (pageCbs.length === 0) {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = false;
        return;
    }

    let checkedCount = 0;
    pageCbs.forEach(cb => {
        if (cb.checked) checkedCount++;
    });

    if (checkedCount === 0) {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = false;
    } else if (checkedCount === pageCbs.length) {
        selectAllCb.checked = true;
        selectAllCb.indeterminate = false;
    } else {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = true;
    }
}

function updateConsolidatedPoButtonState() {
    const btn = document.getElementById('createConsolidatedPoBtn');
    const countEl = document.getElementById('consolidatedPoCount');
    if (!btn || !countEl) return;

    const count = selectedInventorySKUs.size;
    countEl.innerText = count;
    
    if (count > 0) {
        btn.style.display = 'inline-flex';
    } else {
        btn.style.display = 'none';
    }
}

// Expose bindings to global window object
window.openTelemetryDrawer = openTelemetryDrawer;
window.closeTelemetryDrawer = closeTelemetryDrawer;
window.loadPoLedger = loadPoLedger;
window.markPoAsReceived = markPoAsReceived;
window.deletePo = deletePo;
window.loadFinancialsData = loadFinancialsData;
window.simulateROI = simulateROI;



