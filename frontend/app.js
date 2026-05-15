/**
 * StockSense AI Frontend Logic
 * Handles dynamic rendering of insights, SHAP drivers, and Chart.js initialization.
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Simulate fetching the LLM Insight Payload
    setTimeout(() => {
        renderInsight();
        renderDrivers();
    }, 800); // Artificial delay to simulate network request

    // 2. Initialize the Forecast Chart
    initChart();
});

function renderInsight() {
    const container = document.getElementById('ai-insight-text');
    
    // The perfect output text based on backend guidelines
    const insightHTML = `
        <p class="animated-text">
            Sales are forecast to increase <b>23%</b> next week to approximately <b>4,850 units</b>, significantly above your baseline. 
            This surge is driven by the upcoming <b>Eid holiday (+18% impact)</b>, your current promotion campaign (+9%), and typical weekend demand patterns (+5%). 
            <br><br>
            <span style="color: var(--status-warning); font-weight: 600;">
                <i class="fa-solid fa-triangle-exclamation"></i> Stockout Warning:
            </span> 
            Your current inventory of 3,200 units will likely be depleted by Thursday. We recommend ordering at least <b>5,200 units</b> (40% above forecast) to meet demand and avoid lost sales. Additionally, schedule extra staff for Friday and Saturday when foot traffic typically peaks during holidays.
        </p>
    `;
    
    // Replace skeletons with actual text
    container.innerHTML = insightHTML;
}

function renderDrivers() {
    const driversList = document.getElementById('drivers-list');
    
    // Mock SHAP data
    const drivers = [
        { name: "Upcoming Holiday (Eid)", impact: "+18%", value: 85, color: "var(--accent-primary)" },
        { name: "Active Promotion Campaign", impact: "+9%", value: 45, color: "var(--accent-secondary)" },
        { name: "Day of Week (Weekend)", impact: "+5%", value: 25, color: "var(--status-success)" }
    ];

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

    new Chart(ctx, {
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
