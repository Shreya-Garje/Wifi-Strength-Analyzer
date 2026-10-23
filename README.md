# Wi-Fi Signal Strength Analyzer Web Application

A full-stack, beginner-friendly **Wi-Fi Signal Strength Analyzer** web application built with **Python 3, Flask, HTML5, CSS3, and JavaScript**. 

This application runs natively on **Windows 10 and Windows 11** laptops and provides real-time telemetry of your connected Wi-Fi link, scans nearby wireless access points (BSSIDs), visualizes signal fluctuations on a live line graph, and exports reports to CSV format.

---

## 1. Project Overview & Architecture

### Objectives
- **Connected Network Telemetry**: Read real-time Wi-Fi connection metrics from the Windows operating system every 5 seconds.
- **Estimated RSSI & Native RSSI**: Convert Windows signal percentage to estimated dBm (`dBm ≈ (Percentage / 2) - 100`) and display native hardware RSSI when exposed by modern Windows 11 drivers.
- **Nearby Access Point Scanner**: Discover nearby 802.11 access points, sorting by signal strength, handling hidden SSIDs and duplicate mesh networks.
- **Real-Time Signal Graph**: Plot a live time-series canvas chart showing the last 90 readings (7.5 minutes of continuous monitoring).
- **Data Export**: Generate RFC 4180 compliant `wifi-signal-report.csv` containing both historical connected telemetry and nearby access point scans.

### Architecture
Modern web browsers sandbox JavaScript to prevent raw radio frame inspection. To overcome this limitation, this application utilizes:
1. **Python Flask Backend**: Safely queries the native Windows `netsh wlan` command-line utility via Python's `subprocess` module (`shell=False`).
2. **RESTful JSON Endpoints**: Delivers structured telemetry via `/api/status` and `/api/scan`.
3. **Frontend Dashboard**: A responsive, dark navy and teal glassmorphism UI rendered with semantic HTML5, modern CSS, and vanilla JavaScript.

---

## 2. Technology Stack

- **Backend**: Python 3.8+ and Flask (bound to `127.0.0.1:5000`, `debug=False`)
- **Frontend**: Semantic HTML5, Vanilla CSS3 (Custom Properties, Flexbox, CSS Grid, Container Queries), Vanilla JavaScript (ES6+)
- **Data Visualization**: Native HTML5 `<canvas>` with HiDPI Retina scaling and interactive crosshair hover inspection
- **OS Wi-Fi Commands**: Windows `netsh wlan show interfaces` and `netsh wlan show networks mode=bssid`
- **Data Export**: Client-side RFC 4180 CSV blob generation (`wifi-signal-report.csv`)

---

## 3. Project Directory Structure

```text
wifi-signal-analyzer/
│
├── app.py                  # Python Flask server & netsh wlan parser
├── requirements.txt        # Python dependencies (Flask)
├── README.md               # Complete setup, testing, and troubleshooting guide
│
├── templates/
│   └── index.html          # Semantic HTML5 dashboard template
│
└── static/
    ├── style.css           # Professional dark navy / teal responsive stylesheet
    └── app.js              # Live polling, canvas chart rendering & CSV export
```

---

## 4. Installation & Execution Instructions (Windows PowerShell)

Follow these exact steps in **Windows PowerShell**:

### Step 1: Open PowerShell and Navigate to the Project Folder
```powershell
cd "c:\Users\Shreya\OneDrive\wifi signal analyzer"
```

### Step 2: Create a Python Virtual Environment
```powershell
python -m venv venv
```
*(If `python` is not in your PATH or you are using a specific environment, specify the full path to `python.exe`)*

### Step 3: Activate the Virtual Environment
```powershell
.\venv\Scripts\Activate.ps1
```
> **Note on PowerShell Execution Policy**: If you receive an execution policy restriction error (`Execution_Policies`), run:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```
> Or invoke the activation script with:
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\venv\Scripts\Activate.ps1
> ```

### Step 4: Install Dependencies
```powershell
pip install -r requirements.txt
```

### Step 5: Start the Flask Application
```powershell
python app.py
```

### Step 6: Open the Application in Your Browser
Open Chrome, Edge, or Firefox and navigate to:
```text
http://127.0.0.1:5000
```

### How to Stop the Application
To stop the server, press `CTRL + C` in the PowerShell terminal window.

---

## 5. Feature Breakdown

### A. Dashboard & Telemetry Monitoring
- **Polling Frequency**: Every 5 seconds, the browser queries `GET /api/status`.
- **Metrics Displayed**:
  - Connected SSID and BSSID (MAC address).
  - Signal strength percentage (0–100%) with animated progress fill.
  - Estimated RSSI in dBm and native driver RSSI (when reported by Windows 11).
  - Wi-Fi Channel and Frequency Band (2.4 GHz or 5 GHz).
  - Radio Protocol (e.g., 802.11ax, 802.11ac, 802.11n).
  - Security & Authentication (e.g., WPA2-Personal CCMP, WPA3).
  - Link speed rates (Receive and Transmit Mbps).
  - WLAN adapter hardware description.

### B. Signal Quality Classification
The dashboard maps percentage to five quality tiers:
- **80% – 100% (Excellent)**: Optimal throughput, minimal latency. Ideal for 4K/8K UHD streaming and gaming.
- **65% – 79% (Very Good)**: Stable connection for multiple concurrent HD video conferences and downloads.
- **50% – 64% (Good)**: Reliable for everyday web browsing, social media, and audio streaming.
- **35% – 49% (Fair)**: Vulnerable to speed drops, high ping, and packet retransmissions.
- **0% – 34% (Weak)**: Edge of router range; frequent dropouts and severe latency. Relocation recommended.

### C. Estimated dBm Calculation & Limitations
Windows does not directly expose raw milliwatt signal power by default; it provides a normalized integer from 0 to 100%. The application derives estimated dBm using the standard telecommunications linear approximation:
$$\text{Estimated dBm} \approx \left(\frac{\text{Signal \%}}{2}\right) - 100$$
- $100\% \rightarrow -50 \text{ dBm}$ (Excellent, directly adjacent to router)
- $80\% \rightarrow -60 \text{ dBm}$ (Strong)
- $50\% \rightarrow -75 \text{ dBm}$ (Moderate)
- $20\% \rightarrow -90 \text{ dBm}$ (Very weak)
- $0\% \rightarrow -100 \text{ dBm}$ (Theoretical sensitivity floor)

*Disclaimer: Actual radio frequency signal power is subject to physical environmental variables including wall attenuation, 2.4/5 GHz frequency characteristics, co-channel interference, and adapter driver calibration.*

### D. Nearby Access Point Scanner
- Triggered by clicking **"Scan Nearby Networks"** or **"↻ Rescan"**.
- Queries `GET /api/scan` which executes `netsh wlan show networks mode=bssid`.
- Table columns:
  1. **Network (SSID)**: Displays network name with lock status. Hidden networks are labeled `[Hidden Network]`.
  2. **Signal Strength**: Numerical percentage, mini bar, and colored tier badge.
  3. **Est. dBm**: Derived dBm value.
  4. **Channel & Band**: Operating channel and frequency band.
  5. **Security / Auth**: Authentication type (WPA2, WPA3, Open).
  6. **Access Point BSSID**: Physical MAC address of each radio transmitter.
- Sorts by signal strength, highest first.
- Prevents overlapping scans with a scan lock and animated progress bar.
- Includes a live search filter box to quickly find networks by SSID or BSSID.

### E. Real-Time Signal Canvas Graph
- Holds up to **90 readings** (7.5 minutes of continuous history).
- Responsive redraw via `ResizeObserver` with HiDPI Retina pixel-ratio scaling.
- Y-axis: 0% to 100% with labeled threshold guides (Excellent, Very Good, Fair).
- X-axis: Dynamic timestamps.
- Glowing gradient line with translucent area fill.
- Interactive hover crosshair and floating tooltip displaying time, SSID, %, dBm, and quality tier.

### F. CSV Report Export
- Clicking **"Export CSV"** downloads `wifi-signal-report.csv`.
- Validates data availability to avoid fabricating empty reports.
- Formatted in two RFC 4180 compliant sections:
  1. **Connected Wi-Fi Signal History** (up to 90 time-series samples).
  2. **Nearby Access Points Scan Results** (all discovered BSSIDs).

---

## 6. API Reference & Sample JSON Responses

### 1. `GET /api/status`
Returns current connected Wi-Fi link information.

**Sample Response (Connected):**
```json
{
  "authentication": "WPA2-Personal",
  "band": "2.4 GHz",
  "bssid": "1a:b3:41:8c:7b:f1",
  "channel": 6,
  "cipher": "CCMP",
  "connected": true,
  "estimated_dbm": -56,
  "interface_description": "Realtek RTL8852BE WiFi 6 802.11ax PCIe Adapter",
  "interface_name": "Wi-Fi",
  "message": "Connected to Samsumg F15",
  "native_rssi": -49,
  "quality": "Excellent",
  "radio_type": "802.11n",
  "receive_rate_mbps": 72.2,
  "signal": 88,
  "ssid": "Samsumg F15",
  "state": "connected",
  "success": true,
  "timestamp": "2026-10-10T21:05:00.000000+00:00",
  "transmit_rate_mbps": 72.2
}
```

**Sample Response (Disconnected):**
```json
{
  "connected": false,
  "interface_description": "Realtek RTL8852BE WiFi 6 802.11ax PCIe Adapter",
  "interface_name": "Wi-Fi",
  "message": "Wi-Fi interface is disconnected. Connect to a wireless network to view live signal metrics.",
  "state": "disconnected",
  "success": true,
  "timestamp": "2026-10-10T21:06:00.000000+00:00"
}
```

---

### 2. `GET /api/scan`
Returns nearby access points discovered by the Windows WLAN AutoConfig service.

**Sample Response:**
```json
{
  "count": 2,
  "message": "Detected 2 nearby access point records.",
  "networks": [
    {
      "authentication": "WPA2-Personal",
      "band": "5 GHz",
      "bssid": "1a:b3:41:8c:7b:f1",
      "channel": 36,
      "encryption": "CCMP",
      "estimated_dbm": -56,
      "is_hidden": false,
      "network_type": "Infrastructure",
      "quality": "Excellent",
      "radio_type": "802.11ax",
      "signal": 88,
      "ssid": "Home-Network-5G"
    },
    {
      "authentication": "WPA2-Personal",
      "band": "2.4 GHz",
      "bssid": "24:f5:a2:10:9b:0c",
      "channel": 1,
      "encryption": "CCMP",
      "estimated_dbm": -72,
      "is_hidden": false,
      "network_type": "Infrastructure",
      "quality": "Good",
      "radio_type": "802.11n",
      "signal": 56,
      "ssid": "Guest-Wi-Fi"
    }
  ],
  "success": true,
  "timestamp": "2026-10-10T21:05:05.000000+00:00"
}
```

---

## 7. Testing Guide

| Test Scenario | Steps to Execute | Expected Result |
| :--- | :--- | :--- |
| **Connected Wi-Fi Detection** | Ensure Wi-Fi is connected and load `http://127.0.0.1:5000` | Header shows green "Connected • [SSID]" badge. Signal gauge shows actual percentage, channel, band, and dBm. |
| **Nearby Network Scanning** | Click "Scan Nearby Networks" | Button displays loading indicator; table populates with detected APs sorted by signal descending. |
| **Live Signal Graph Updates** | Keep dashboard open for 30+ seconds | Canvas updates every 5 seconds without full page reload. History point counter increments. Hover displays tooltip. |
| **CSV Export** | Click "Export CSV" | Browser triggers download of `wifi-signal-report.csv`. File contains headers, history samples, and AP table. |
| **Wi-Fi Disconnection** | Disconnect from Wi-Fi via Windows taskbar | Within 5 seconds, badge turns red "Disconnected", warning banner appears, cards show "Inactive" without crashing. |
| **Empty Scan Results** | Place laptop where no signals exist or turn off Wi-Fi | Table shows friendly empty state: "No Nearby Networks Detected". |
| **Responsive Layout** | Resize browser window or inspect via mobile device emulation | Grid adjusts smoothly from 3 columns to 2 columns and single-column stacked layout. |

---

## 8. Troubleshooting

### Issue 1: `python` command is not recognized
- **Cause**: Python is not added to Windows environment `PATH`.
- **Solution**: Open System Properties > Environment Variables, or use the direct path to Python (e.g., `C:\Users\<User>\AppData\Local\Programs\Python\Python312\python.exe`).

### Issue 2: `The Wireless AutoConfig Service (wlansvc) is not running`
- **Cause**: The Windows WLAN service is disabled or stopped.
- **Solution**: Open Windows PowerShell as Administrator and run:
  ```powershell
  Start-Service -Name wlansvc
  ```

### Issue 3: `Port 5000 is already in use`
- **Cause**: Another service or process is using port 5000.
- **Solution**: Edit `app.py` line `app.run(host="127.0.0.1", port=5000)` to port `5050` or `8080`, or terminate the conflicting process using `netstat -ano | findstr :5000`.

### Issue 4: `netsh command timed out`
- **Cause**: Wireless hardware took longer than 10 seconds to scan.
- **Solution**: Check your Wi-Fi adapter driver in Windows Device Manager. The application catches timeouts gracefully and returns HTTP 500 with a descriptive error message without crashing.

---

## 9. Packaging into a ZIP File

To package the entire project into a distributable `.zip` file for sharing or submission, run the following PowerShell command from the project directory:

```powershell
Compress-Archive -Path "app.py", "requirements.txt", "README.md", "templates", "static" -DestinationPath "wifi-signal-analyzer.zip" -Force
```

This creates `wifi-signal-analyzer.zip` containing all source code and assets, omitting the virtual environment.
