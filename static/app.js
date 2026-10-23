/**
 * Wi-Fi Signal Strength Analyzer - Frontend Controller
 * Handles live polling, HTML5 canvas rendering, nearby AP scanning,
 * telemetry statistics, and RFC 4180 CSV report export.
 */

(function () {
    'use strict';

    // =========================================================================
    // Configuration & State
    // =========================================================================

    const CONFIG = {
        POLL_INTERVAL_MS: 5000,       // 5 seconds refresh interval
        MAX_HISTORY_POINTS: 90,       // Keep up to 90 readings (7.5 minutes)
        CSV_FILENAME: 'wifi-signal-report.csv',
        API: {
            STATUS: '/api/status',
            SCAN: '/api/scan'
        }
    };

    const STATE = {
        history: [],                  // Array of { timestamp, timeLabel, signal, dbm, ssid, quality, ... }
        latestStatus: null,           // Latest response from /api/status
        latestScanNetworks: [],       // Latest list of APs from /api/scan
        isScanning: false,            // Scan lock to prevent overlapping runs
        pollTimerId: null,            // Polling interval timer ID
        hoverIndex: null              // Canvas inspection hover point index
    };

    // =========================================================================
    // DOM Element References
    // =========================================================================

    const DOM = {
        // Badges & Status
        connectionBadge: document.getElementById('connection-badge'),
        connectionStatusText: document.getElementById('connection-status-text'),
        adapterAlert: document.getElementById('adapter-alert'),
        alertTitle: document.getElementById('alert-title'),
        alertMessage: document.getElementById('alert-message'),

        // Card 1: Signal Gauge
        signalPercentage: document.getElementById('signal-percentage'),
        signalDbm: document.getElementById('signal-dbm'),
        signalProgressFill: document.getElementById('signal-progress-fill'),
        signalQualityBadge: document.getElementById('signal-quality-badge'),
        nativeRssiVal: document.getElementById('native-rssi-val'),

        // Card 2: Connected Network Details
        connectedSsid: document.getElementById('connected-ssid'),
        connectedStateBadge: document.getElementById('connected-state-badge'),
        connChannel: document.getElementById('conn-channel'),
        connBand: document.getElementById('conn-band'),
        connRadio: document.getElementById('conn-radio'),
        connSecurity: document.getElementById('conn-security'),
        connBssid: document.getElementById('conn-bssid'),
        connRates: document.getElementById('conn-rates'),

        // Card 3: Environment & Stats
        envNearbyCount: document.getElementById('env-nearby-count'),
        statPeakSignal: document.getElementById('stat-peak-signal'),
        statAvgSignal: document.getElementById('stat-avg-signal'),
        statReadingsCount: document.getElementById('stat-readings-count'),
        adapterName: document.getElementById('adapter-name'),
        adapterDesc: document.getElementById('adapter-desc'),
        lastRefreshTime: document.getElementById('last-refresh-time'),

        // Card 4: Graph
        canvasWrapper: document.getElementById('canvas-wrapper'),
        canvas: document.getElementById('signal-chart'),
        chartEmptyState: document.getElementById('chart-empty-state'),
        chartTooltip: document.getElementById('chart-tooltip'),
        graphSpanSummary: document.getElementById('graph-span-summary'),

        // Card 5: Scanner Table
        btnScan: document.getElementById('btn-scan'),
        btnScanText: document.getElementById('btn-scan-text'),
        btnRescanTable: document.getElementById('btn-rescan-table'),
        scanLoadingBar: document.getElementById('scan-loading-bar'),
        networksTableBody: document.getElementById('networks-table-body'),
        networksEmptyState: document.getElementById('networks-empty-state'),
        networkFilterInput: document.getElementById('network-filter-input'),

        // Export & Toast
        btnExportCsv: document.getElementById('btn-export-csv'),
        toastContainer: document.getElementById('toast-container')
    };

    // =========================================================================
    // Utilities
    // =========================================================================

    /**
     * Sanitizes untrusted strings to prevent XSS injection.
     */
    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    /**
     * Formats a Date object into a readable time string (HH:MM:SS).
     */
    function formatTime(date) {
        return date.toTimeString().split(' ')[0];
    }

    /**
     * Formats an ISO timestamp into locale time.
     */
    function formatTimestampLocale(isoStr) {
        if (!isoStr) return 'N/A';
        const d = new Date(isoStr);
        return isNaN(d.getTime()) ? isoStr : d.toLocaleTimeString();
    }

    /**
     * Maps signal percentage to quality classification and styling classes.
     */
    function getQualityMeta(percent) {
        if (percent === null || percent === undefined) {
            return { label: 'Unknown', cssClass: 'badge-unknown', color: '#64748b' };
        }
        const val = Number(percent);
        if (val >= 80) {
            return { label: 'Excellent', cssClass: 'quality-excellent', color: '#10b981' };
        } else if (val >= 65) {
            return { label: 'Very Good', cssClass: 'quality-vgood', color: '#14b8a6' };
        } else if (val >= 50) {
            return { label: 'Good', cssClass: 'quality-good', color: '#0ea5e9' };
        } else if (val >= 35) {
            return { label: 'Fair', cssClass: 'quality-fair', color: '#f59e0b' };
        } else {
            return { label: 'Weak', cssClass: 'quality-weak', color: '#ef4444' };
        }
    }

    /**
     * Displays a temporary toast notification banner.
     */
    function showToast(message, type = 'info', duration = 3500) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
        toast.innerHTML = `<span style="font-weight:bold;">${icon}</span> <span>${escapeHtml(message)}</span>`;

        DOM.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-hiding');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, duration);
    }

    // =========================================================================
    // Telemetry & Status Polling
    // =========================================================================

    /**
     * Fetches current Wi-Fi status from /api/status and updates the dashboard.
     */
    async function fetchWifiStatus() {
        try {
            const response = await fetch(CONFIG.API.STATUS);
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }

            const data = await response.json();
            STATE.latestStatus = data;
            renderStatus(data);

            // Record reading if connected and valid signal exists
            if (data.connected && data.signal !== null && data.signal !== undefined) {
                recordHistoryPoint(data);
            } else {
                updateStatsReadouts();
                renderChart();
            }

        } catch (err) {
            console.error('Failed to query Wi-Fi status:', err);
            renderErrorStatus(err.message);
        }
    }

    /**
     * Records a signal data point into the in-memory circular history buffer.
     */
    function recordHistoryPoint(data) {
        const now = new Date();
        const point = {
            timestamp: now.toISOString(),
            timeLabel: formatTime(now),
            signal: Number(data.signal),
            dbm: data.estimated_dbm !== null ? Number(data.estimated_dbm) : null,
            ssid: data.ssid || 'Unknown',
            bssid: data.bssid || 'N/A',
            quality: data.quality || 'Unknown',
            channel: data.channel !== null ? data.channel : 'N/A',
            band: data.band || 'N/A',
            radio: data.radio_type || 'N/A',
            security: data.authentication || 'N/A',
            rxRate: data.receive_rate_mbps,
            txRate: data.transmit_rate_mbps
        };

        STATE.history.push(point);

        // Keep latest 90 readings in browser memory
        if (STATE.history.length > CONFIG.MAX_HISTORY_POINTS) {
            STATE.history.shift();
        }

        updateStatsReadouts();
        renderChart();
    }

    /**
     * Updates statistics readouts (Peak, Avg, History count).
     */
    function updateStatsReadouts() {
        const count = STATE.history.length;
        DOM.statReadingsCount.textContent = `${count}/${CONFIG.MAX_HISTORY_POINTS}`;

        if (count === 0) {
            DOM.statPeakSignal.textContent = '--%';
            DOM.statAvgSignal.textContent = '--%';
            DOM.graphSpanSummary.innerHTML = `Span: <strong>0s recorded</strong>`;
            return;
        }

        const signals = STATE.history.map(p => p.signal);
        const peak = Math.max(...signals);
        const sum = signals.reduce((acc, v) => acc + v, 0);
        const avg = (sum / count).toFixed(1);

        DOM.statPeakSignal.textContent = `${peak}%`;
        DOM.statAvgSignal.textContent = `${avg}%`;

        const totalSpanSec = (count - 1) * 5;
        const spanMinutes = Math.floor(totalSpanSec / 60);
        const spanSec = totalSpanSec % 60;
        DOM.graphSpanSummary.innerHTML = `Span: <strong>${spanMinutes > 0 ? spanMinutes + 'm ' : ''}${spanSec}s recorded</strong>`;
    }

    /**
     * Renders connected status telemetry into UI cards and badges.
     */
    function renderStatus(data) {
        const now = new Date();
        DOM.lastRefreshTime.textContent = formatTime(now);

        // Disconnected or No Interface State
        if (!data.connected) {
            DOM.connectionBadge.className = 'status-badge status-disconnected';
            DOM.connectionStatusText.textContent = data.state === 'no_interface' 
                ? 'No Wi-Fi Adapter' 
                : 'Disconnected';

            DOM.adapterAlert.style.display = 'flex';
            DOM.adapterAlert.className = 'alert-banner alert-warning';
            DOM.alertTitle.textContent = 'Wi-Fi Status:';
            DOM.alertMessage.textContent = data.message || 'Wi-Fi adapter is disconnected. Please connect to a wireless network.';

            // Reset signal cards
            DOM.signalPercentage.textContent = '--';
            DOM.signalDbm.textContent = '-- dBm';
            DOM.signalProgressFill.style.width = '0%';
            DOM.signalProgressFill.style.background = 'var(--text-muted)';
            DOM.signalQualityBadge.textContent = 'Disconnected';
            DOM.signalQualityBadge.className = 'badge badge-quality badge-unknown';
            DOM.nativeRssiVal.textContent = 'N/A';

            DOM.connectedSsid.textContent = 'Disconnected';
            DOM.connectedStateBadge.textContent = 'Inactive';
            DOM.connectedStateBadge.className = 'badge badge-state';
            DOM.connChannel.textContent = 'N/A';
            DOM.connBand.textContent = 'N/A';
            DOM.connRadio.textContent = 'N/A';
            DOM.connSecurity.textContent = 'N/A';
            DOM.connBssid.textContent = 'N/A';
            DOM.connRates.textContent = 'N/A';

            DOM.adapterName.textContent = data.interface_name || 'Wi-Fi';
            DOM.adapterDesc.textContent = data.interface_description || 'Wireless Adapter';
            return;
        }

        // Connected State
        DOM.adapterAlert.style.display = 'none';
        DOM.connectionBadge.className = 'status-badge status-connected';
        DOM.connectionStatusText.textContent = `Connected • ${data.ssid}`;

        // Signal Gauge Card
        const sig = data.signal !== null ? data.signal : 0;
        DOM.signalPercentage.textContent = sig;

        const qualityMeta = getQualityMeta(sig);
        DOM.signalQualityBadge.textContent = qualityMeta.label;
        DOM.signalQualityBadge.className = `badge badge-quality ${qualityMeta.cssClass}`;

        DOM.signalProgressFill.style.width = `${Math.min(Math.max(sig, 0), 100)}%`;
        DOM.signalProgressFill.style.background = `linear-gradient(90deg, var(--teal-500), ${qualityMeta.color})`;

        // Estimated dBm
        if (data.estimated_dbm !== null && data.estimated_dbm !== undefined) {
            DOM.signalDbm.textContent = `${data.estimated_dbm} dBm`;
        } else {
            DOM.signalDbm.textContent = '-- dBm';
        }

        // Native Adapter RSSI (Windows 11)
        if (data.native_rssi !== null && data.native_rssi !== undefined) {
            DOM.nativeRssiVal.textContent = `${data.native_rssi} dBm (Native)`;
        } else {
            DOM.nativeRssiVal.textContent = 'Not exposed by driver';
        }

        // Connected Network Card
        DOM.connectedSsid.textContent = data.ssid || 'Connected';
        DOM.connectedStateBadge.textContent = 'Active Link';
        DOM.connectedStateBadge.className = 'badge badge-state status-connected';

        DOM.connChannel.textContent = data.channel !== null ? `Ch ${data.channel}` : 'N/A';
        DOM.connBand.textContent = data.band || 'N/A';
        DOM.connRadio.textContent = data.radio_type || 'N/A';
        DOM.connSecurity.textContent = data.authentication && data.cipher ? `${data.authentication} (${data.cipher})` : (data.authentication || 'N/A');
        DOM.connBssid.textContent = data.bssid || 'N/A';

        const rx = data.receive_rate_mbps !== null ? `${data.receive_rate_mbps} Mbps` : '--';
        const tx = data.transmit_rate_mbps !== null ? `${data.transmit_rate_mbps} Mbps` : '--';
        DOM.connRates.textContent = `${rx} / ${tx}`;

        DOM.adapterName.textContent = data.interface_name || 'Wi-Fi';
        DOM.adapterDesc.textContent = data.interface_description || 'Wireless Adapter';
        DOM.adapterDesc.title = data.interface_description || '';
    }

    /**
     * Renders connection failure when API call fails.
     */
    function renderErrorStatus(errorMessage) {
        DOM.connectionBadge.className = 'status-badge status-disconnected';
        DOM.connectionStatusText.textContent = 'API Connection Error';

        DOM.adapterAlert.style.display = 'flex';
        DOM.adapterAlert.className = 'alert-banner alert-danger';
        DOM.alertTitle.textContent = 'Communication Error:';
        DOM.alertMessage.textContent = `Could not reach backend server (${errorMessage}). Verify Flask is running on http://127.0.0.1:5000.`;
    }

    // =========================================================================
    // Nearby Access Points Scanner
    // =========================================================================

    /**
     * Initiates a scan of nearby Wi-Fi networks via /api/scan.
     */
    async function scanNearbyNetworks() {
        if (STATE.isScanning) {
            showToast('Scan already running, please wait...', 'info');
            return;
        }

        STATE.isScanning = true;
        setScanLoadingState(true);

        try {
            const response = await fetch(CONFIG.API.SCAN);
            if (!response.ok) {
                throw new Error(`Server returned HTTP ${response.status}`);
            }

            const data = await response.json();
            STATE.latestScanNetworks = data.networks || [];
            DOM.envNearbyCount.textContent = STATE.latestScanNetworks.length;

            renderNetworksTable(STATE.latestScanNetworks);
            showToast(data.message || `Found ${STATE.latestScanNetworks.length} access point(s)`, 'success');

        } catch (err) {
            console.error('Scan error:', err);
            showToast(`Scan failed: ${err.message}`, 'error', 4500);
        } finally {
            STATE.isScanning = false;
            setScanLoadingState(false);
        }
    }

    /**
     * Controls the scan button loading state and animated progress bar.
     */
    function setScanLoadingState(isLoading) {
        DOM.btnScan.disabled = isLoading;
        DOM.btnRescanTable.disabled = isLoading;

        if (isLoading) {
            DOM.btnScanText.textContent = 'Scanning WLAN...';
            DOM.scanLoadingBar.style.display = 'block';
        } else {
            DOM.btnScanText.textContent = 'Scan Nearby Networks';
            DOM.scanLoadingBar.style.display = 'none';
        }
    }

    /**
     * Renders access points into the nearby networks table.
     */
    function renderNetworksTable(networks) {
        DOM.networksTableBody.innerHTML = '';

        const filterTerm = (DOM.networkFilterInput.value || '').trim().toLowerCase();
        const filtered = networks.filter(ap => {
            if (!filterTerm) return true;
            const ssid = (ap.ssid || '').toLowerCase();
            const bssid = (ap.bssid || '').toLowerCase();
            const auth = (ap.authentication || '').toLowerCase();
            return ssid.includes(filterTerm) || bssid.includes(filterTerm) || auth.includes(filterTerm);
        });

        if (filtered.length === 0) {
            DOM.networksEmptyState.style.display = 'block';
            if (networks.length > 0 && filterTerm) {
                document.getElementById('empty-state-title').textContent = 'No Matching Networks';
                document.getElementById('empty-state-desc').textContent = `No access points matched filter: "${filterTerm}".`;
            } else {
                document.getElementById('empty-state-title').textContent = 'No Nearby Networks Detected';
                document.getElementById('empty-state-desc').textContent = 'Click "Scan Nearby Networks" to discover available access points.';
            }
            return;
        }

        DOM.networksEmptyState.style.display = 'none';

        filtered.forEach(ap => {
            const tr = document.createElement('tr');

            // SSID cell with hidden tag and Wi-Fi icon
            const isHidden = ap.is_hidden || !ap.ssid || ap.ssid === '[Hidden Network]';
            const displayName = isHidden ? '[Hidden Network]' : ap.ssid;
            const isSecured = ap.authentication && !ap.authentication.toLowerCase().includes('open');

            const lockIcon = isSecured 
                ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.75;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`
                : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--color-weak);"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;

            const ssidHtml = `
                <div class="ssid-cell-content">
                    <span class="ssid-icon">${lockIcon}</span>
                    <span class="ssid-name">${escapeHtml(displayName)}</span>
                    ${isHidden ? '<span class="hidden-badge">Hidden</span>' : ''}
                </div>
            `;

            // Signal cell with mini progress bar and quality badge
            const sigVal = ap.signal !== null && ap.signal !== undefined ? ap.signal : null;
            const qualityMeta = getQualityMeta(sigVal);
            const signalDisplay = sigVal !== null ? `${sigVal}%` : 'N/A';
            const barWidth = sigVal !== null ? Math.min(Math.max(sigVal, 0), 100) : 0;

            const signalHtml = `
                <div class="table-signal-cell">
                    <div class="mini-bar-wrap" title="${signalDisplay}">
                        <div class="mini-bar-fill" style="width: ${barWidth}%; background-color: ${qualityMeta.color};"></div>
                    </div>
                    <strong>${signalDisplay}</strong>
                    <span class="badge badge-quality ${qualityMeta.cssClass}" style="font-size:0.7rem; padding:0.15rem 0.45rem;">${qualityMeta.label}</span>
                </div>
            `;

            // Estimated dBm
            const dbmHtml = ap.estimated_dbm !== null && ap.estimated_dbm !== undefined 
                ? `<span style="font-weight:600; color:var(--teal-400);">${ap.estimated_dbm} dBm</span>` 
                : '<span style="color:var(--text-muted);">N/A</span>';

            // Channel & Band
            const channelStr = ap.channel !== null && ap.channel !== undefined ? `Ch ${ap.channel}` : 'N/A';
            const bandStr = ap.band && ap.band !== 'Unknown' ? ap.band : '';
            const channelHtml = `<span>${channelStr}</span> <span style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(bandStr)}</span>`;

            // Security
            const authStr = ap.authentication || 'N/A';
            const encStr = ap.encryption && ap.encryption !== 'Unknown' ? `(${ap.encryption})` : '';
            const secHtml = `<span>${escapeHtml(authStr)} ${escapeHtml(encStr)}</span>`;

            // BSSID
            const bssidHtml = `<span class="mono" style="font-size:0.8rem; color:var(--text-secondary);">${escapeHtml(ap.bssid || 'N/A')}</span>`;

            tr.innerHTML = `
                <td>${ssidHtml}</td>
                <td>${signalHtml}</td>
                <td>${dbmHtml}</td>
                <td>${channelHtml}</td>
                <td>${secHtml}</td>
                <td>${bssidHtml}</td>
            `;

            DOM.networksTableBody.appendChild(tr);
        });
    }

    // =========================================================================
    // Real-Time HTML5 Canvas Chart Rendering
    // =========================================================================

    /**
     * Renders the real-time line chart on HTML5 Canvas with HiDPI crispness.
     */
    function renderChart() {
        const canvas = DOM.canvas;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const container = DOM.canvasWrapper;
        const rect = container.getBoundingClientRect();

        // HiDPI Scaling
        const dpr = window.devicePixelRatio || 1;
        const width = rect.width;
        const height = rect.height;

        if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
            canvas.width = width * dpr;
            canvas.height = height * dpr;
        }

        ctx.resetTransform();
        ctx.scale(dpr, dpr);

        // Chart area padding
        const padding = { top: 25, right: 35, bottom: 45, left: 55 };
        const chartW = width - padding.left - padding.right;
        const chartH = height - padding.top - padding.bottom;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        const data = STATE.history;

        // If no readings collected yet, show empty state
        if (data.length === 0) {
            DOM.chartEmptyState.style.display = 'flex';
            return;
        } else {
            DOM.chartEmptyState.style.display = 'none';
        }

        // Draw horizontal grid lines & threshold levels (0%, 25%, 50%, 75%, 100%)
        const yTicks = [
            { val: 0, label: '0%' },
            { val: 25, label: '25%' },
            { val: 50, label: '50%' },
            { val: 75, label: '75%' },
            { val: 100, label: '100%' }
        ];

        ctx.lineWidth = 1;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.font = '11px Inter, sans-serif';

        yTicks.forEach(tick => {
            const y = padding.top + chartH - (tick.val / 100) * chartH;

            // Grid line
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartW, y);
            ctx.stroke();

            // Axis Label
            ctx.fillStyle = '#64748b';
            ctx.fillText(tick.label, padding.left - 10, y);
        });

        // Threshold Guidelines (80% Excellent, 65% Very Good, 35% Fair)
        const guidelines = [
            { val: 80, color: 'rgba(16, 185, 129, 0.25)', label: 'Excellent' },
            { val: 65, color: 'rgba(20, 184, 166, 0.25)', label: 'Very Good' },
            { val: 35, color: 'rgba(245, 158, 11, 0.25)', label: 'Fair' }
        ];

        guidelines.forEach(g => {
            const y = padding.top + chartH - (g.val / 100) * chartH;
            ctx.strokeStyle = g.color;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartW, y);
            ctx.stroke();
            ctx.setLineDash([]);
        });

        // Compute coordinate mappings for each data point
        const points = data.map((pt, index) => {
            const x = data.length === 1
                ? padding.left + chartW / 2
                : padding.left + (index / (CONFIG.MAX_HISTORY_POINTS - 1)) * chartW;
            const clampedSig = Math.min(Math.max(pt.signal, 0), 100);
            const y = padding.top + chartH - (clampedSig / 100) * chartH;
            return { x, y, pt, index };
        });

        // Draw area fill gradient under the line
        if (points.length > 0) {
            const areaGradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
            areaGradient.addColorStop(0, 'rgba(20, 184, 166, 0.35)');
            areaGradient.addColorStop(0.6, 'rgba(20, 184, 166, 0.12)');
            areaGradient.addColorStop(1, 'rgba(20, 184, 166, 0.0)');

            ctx.beginPath();
            ctx.moveTo(points[0].x, padding.top + chartH);
            ctx.lineTo(points[0].x, points[0].y);

            for (let i = 1; i < points.length; i++) {
                // Smooth curved line using bezier curve
                const prev = points[i - 1];
                const curr = points[i];
                const cpX = (prev.x + curr.x) / 2;
                ctx.bezierCurveTo(cpX, prev.y, cpX, curr.y, curr.x, curr.y);
            }

            ctx.lineTo(points[points.length - 1].x, padding.top + chartH);
            ctx.closePath();
            ctx.fillStyle = areaGradient;
            ctx.fill();
        }

        // Draw line chart stroke
        if (points.length > 0) {
            const lineGradient = ctx.createLinearGradient(padding.left, 0, padding.left + chartW, 0);
            lineGradient.addColorStop(0, '#06b6d4');
            lineGradient.addColorStop(0.5, '#14b8a6');
            lineGradient.addColorStop(1, '#10b981');

            ctx.lineWidth = 2.5;
            ctx.strokeStyle = lineGradient;
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);

            for (let i = 1; i < points.length; i++) {
                const prev = points[i - 1];
                const curr = points[i];
                const cpX = (prev.x + curr.x) / 2;
                ctx.bezierCurveTo(cpX, prev.y, cpX, curr.y, curr.x, curr.y);
            }
            ctx.stroke();
        }

        // Draw point nodes & pulse on latest node
        points.forEach((p, idx) => {
            const isLatest = idx === points.length - 1;
            const qualityMeta = getQualityMeta(p.pt.signal);

            if (isLatest) {
                // Glowing outer ring on current reading
                ctx.fillStyle = 'rgba(20, 184, 166, 0.25)';
                ctx.beginPath();
                ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = qualityMeta.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
                ctx.fill();
            } else if (points.length <= 30 || idx % 3 === 0) {
                // Subtle nodes for intermediate history
                ctx.fillStyle = qualityMeta.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // Draw time labels along X-axis
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const labelStep = Math.max(1, Math.floor(points.length / 5));
        for (let i = 0; i < points.length; i += labelStep) {
            const p = points[i];
            ctx.fillText(p.pt.timeLabel, p.x, padding.top + chartH + 10);
        }

        // Draw hover inspection vertical crosshair & highlight
        if (STATE.hoverIndex !== null && points[STATE.hoverIndex]) {
            const hp = points[STATE.hoverIndex];

            // Crosshair line
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(hp.x, padding.top);
            ctx.lineTo(hp.x, padding.top + chartH);
            ctx.stroke();
            ctx.setLineDash([]);

            // Crosshair dot
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(hp.x, hp.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'var(--teal-500)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    /**
     * Handles canvas mousemove/touch inspection to display live tooltips.
     */
    function handleCanvasHover(event) {
        const canvas = DOM.canvas;
        const rect = canvas.getBoundingClientRect();
        const clientX = event.clientX || (event.touches && event.touches[0].clientX);
        const clientY = event.clientY || (event.touches && event.touches[0].clientY);

        if (!clientX || !clientY) return;

        const x = clientX - rect.left;
        const padding = { top: 25, right: 35, bottom: 45, left: 55 };
        const chartW = rect.width - padding.left - padding.right;

        const data = STATE.history;
        if (data.length === 0) {
            hideTooltip();
            return;
        }

        // Find closest data point based on X position
        let closestIdx = 0;
        let minDiff = Infinity;

        data.forEach((_, idx) => {
            const px = data.length === 1
                ? padding.left + chartW / 2
                : padding.left + (idx / (CONFIG.MAX_HISTORY_POINTS - 1)) * chartW;
            const diff = Math.abs(x - px);
            if (diff < minDiff) {
                minDiff = diff;
                closestIdx = idx;
            }
        });

        if (minDiff < 30) {
            STATE.hoverIndex = closestIdx;
            const pt = data[closestIdx];
            showChartTooltip(pt, clientX - rect.left, clientY - rect.top);
        } else {
            hideTooltip();
        }

        renderChart();
    }

    function showChartTooltip(pt, localX, localY) {
        const tooltip = DOM.chartTooltip;
        const dbmStr = pt.dbm !== null ? `${pt.dbm} dBm` : 'N/A';
        const qualityMeta = getQualityMeta(pt.signal);

        tooltip.innerHTML = `
            <div><strong>${escapeHtml(pt.timeLabel)}</strong> • ${escapeHtml(pt.ssid)}</div>
            <div>Signal: <strong>${pt.signal}%</strong> (${dbmStr})</div>
            <div style="color:${qualityMeta.color}; font-weight:600;">Quality: ${qualityMeta.label}</div>
        `;

        tooltip.style.left = `${localX}px`;
        tooltip.style.top = `${localY}px`;
        tooltip.style.display = 'block';
    }

    function hideTooltip() {
        STATE.hoverIndex = null;
        DOM.chartTooltip.style.display = 'none';
        renderChart();
    }

    // =========================================================================
    // RFC 4180 Compliant CSV Export
    // =========================================================================

    /**
     * Escapes a single CSV value according to RFC 4180 rules.
     */
    function escapeCsvCell(value) {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    }

    /**
     * Generates and triggers download of wifi-signal-report.csv.
     */
    function exportCsvReport() {
        const historyData = STATE.history;
        const scanData = STATE.latestScanNetworks;

        // Validation: Do not export fabricated data if no readings or scans exist
        if (historyData.length === 0 && scanData.length === 0) {
            showToast('No Wi-Fi data available to export yet. Please wait for signal readings or scan nearby networks.', 'error', 4500);
            return;
        }

        const csvLines = [];

        // File Header
        csvLines.push('# Wi-Fi Signal Strength Analyzer - Telemetry & Scan Report');
        csvLines.push(`# Generated At (ISO UTC): ${new Date().toISOString()}`);
        csvLines.push(`# Platform: Windows 10/11 netsh wlan utility`);
        csvLines.push('');

        // Section 1: Connected Wi-Fi Signal History
        csvLines.push('=== SECTION 1: CONNECTED WI-FI SIGNAL HISTORY ===');
        const historyHeaders = [
            'Timestamp (ISO)',
            'Time (Local)',
            'SSID',
            'Signal Strength (%)',
            'Estimated RSSI (dBm)',
            'Quality Classification',
            'Channel',
            'Band',
            'Radio Protocol',
            'Security',
            'Access Point BSSID',
            'Receive Rate (Mbps)',
            'Transmit Rate (Mbps)'
        ];
        csvLines.push(historyHeaders.map(escapeCsvCell).join(','));

        if (historyData.length > 0) {
            historyData.forEach(h => {
                const row = [
                    h.timestamp,
                    h.timeLabel,
                    h.ssid,
                    h.signal,
                    h.dbm !== null ? h.dbm : '',
                    h.quality,
                    h.channel,
                    h.band,
                    h.radio,
                    h.security,
                    h.bssid,
                    h.rxRate !== null && h.rxRate !== undefined ? h.rxRate : '',
                    h.txRate !== null && h.txRate !== undefined ? h.txRate : ''
                ];
                csvLines.push(row.map(escapeCsvCell).join(','));
            });
        } else {
            csvLines.push('# No connected history samples recorded in this session.');
        }

        csvLines.push('');

        // Section 2: Nearby Wi-Fi Access Points Scan
        csvLines.push('=== SECTION 2: NEARBY ACCESS POINTS SCAN RESULTS ===');
        const scanHeaders = [
            'Scan Timestamp (ISO)',
            'Network Name (SSID)',
            'Is Hidden Network',
            'Signal Strength (%)',
            'Estimated RSSI (dBm)',
            'Quality Classification',
            'Wi-Fi Channel',
            'Frequency Band',
            'Radio Protocol',
            'Authentication',
            'Encryption',
            'Access Point BSSID (MAC)'
        ];
        csvLines.push(scanHeaders.map(escapeCsvCell).join(','));

        if (scanData.length > 0) {
            const scanTimestamp = (STATE.latestStatus && STATE.latestStatus.timestamp) || new Date().toISOString();
            scanData.forEach(ap => {
                const row = [
                    scanTimestamp,
                    ap.ssid || '[Hidden Network]',
                    ap.is_hidden ? 'TRUE' : 'FALSE',
                    ap.signal !== null ? ap.signal : '',
                    ap.estimated_dbm !== null ? ap.estimated_dbm : '',
                    ap.quality || 'Unknown',
                    ap.channel !== null ? ap.channel : '',
                    ap.band || '',
                    ap.radio_type || '',
                    ap.authentication || '',
                    ap.encryption || '',
                    ap.bssid || ''
                ];
                csvLines.push(row.map(escapeCsvCell).join(','));
            });
        } else {
            csvLines.push('# No nearby access points scanned yet. Click "Scan Nearby Networks" to capture access points.');
        }

        // Trigger browser download
        const csvContent = csvLines.join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const downloadUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = CONFIG.CSV_FILENAME;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);

        showToast(`Successfully exported ${CONFIG.CSV_FILENAME}`, 'success');
    }

    // =========================================================================
    // Event Listeners & Initialization
    // =========================================================================

    function setupEventListeners() {
        // Scan Buttons
        DOM.btnScan.addEventListener('click', scanNearbyNetworks);
        DOM.btnRescanTable.addEventListener('click', scanNearbyNetworks);

        // Export CSV
        DOM.btnExportCsv.addEventListener('click', exportCsvReport);

        // Search Filter in table
        DOM.networkFilterInput.addEventListener('input', () => {
            renderNetworksTable(STATE.latestScanNetworks);
        });

        // Canvas hover inspection
        DOM.canvas.addEventListener('mousemove', handleCanvasHover);
        DOM.canvas.addEventListener('mouseleave', hideTooltip);
        DOM.canvas.addEventListener('touchstart', handleCanvasHover, { passive: true });
        DOM.canvas.addEventListener('touchend', hideTooltip);

        // Window resize observer for canvas responsiveness
        if (window.ResizeObserver) {
            const resizeObserver = new ResizeObserver(() => {
                renderChart();
            });
            resizeObserver.observe(DOM.canvasWrapper);
        } else {
            window.addEventListener('resize', renderChart);
        }
    }

    /**
     * Application Entry Point.
     */
    function init() {
        setupEventListeners();

        // Initial status fetch
        fetchWifiStatus();

        // Perform an initial scan of nearby access points on load
        scanNearbyNetworks();

        // Setup 5-second polling timer
        STATE.pollTimerId = setInterval(fetchWifiStatus, CONFIG.POLL_INTERVAL_MS);

        console.log('Wi-Fi Signal Strength Analyzer initialized successfully.');
    }

    // Launch on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
