/**
 * StockSense AI Frontend Logic
 * Handles dynamic rendering of insights, SHAP drivers, and Chart.js initialization.
 */

let forecastChartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    // 1. Fetch real insight data from the FastAPI backend
    fetchDataFromBackend();

    // 2. Initialize the Forecast Chart
    initChart();
    
    // 3. Setup CSV Upload Listener
    setupCsvUpload();

    // 4. Initialize Search Filtering
    initSearch();
});

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
    }
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
