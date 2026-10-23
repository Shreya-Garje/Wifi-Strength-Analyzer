"""
Wi-Fi Signal Strength Analyzer - Backend Application
Flask backend that interfaces with Windows netsh wlan utilities to monitor
and scan Wi-Fi signal strength and access points in real time.
"""

import sys
import platform
import subprocess
import re
import threading
import webbrowser
from datetime import datetime, timezone
from flask import Flask, jsonify, render_template

app = Flask(__name__)


def classify_signal_quality(signal_pct):
    """
    Classify Wi-Fi signal quality percentage based on standard thresholds:
    - 80-100%: Excellent
    - 65-79%:  Very Good
    - 50-64%:  Good
    - 35-49%:  Fair
    - 0-34%:   Weak
    """
    if signal_pct is None:
        return "Unknown"
    try:
        val = int(signal_pct)
    except (ValueError, TypeError):
        return "Unknown"

    if val >= 80:
        return "Excellent"
    elif val >= 65:
        return "Very Good"
    elif val >= 50:
        return "Good"
    elif val >= 35:
        return "Fair"
    else:
        return "Weak"


def calculate_estimated_dbm(signal_pct):
    """
    Calculates estimated signal strength in dBm from Windows signal percentage (0-100%).
    Standard telecommunications linear approximation:
        dBm ≈ (Signal% / 2) - 100
    Examples:
        100% -> -50 dBm (Very strong, directly adjacent to router)
        80%  -> -60 dBm (Strong)
        50%  -> -75 dBm (Moderate)
        20%  -> -90 dBm (Very weak, edge of coverage)
        0%   -> -100 dBm (Minimum detectable threshold)
    """
    if signal_pct is None:
        return None
    try:
        val = int(signal_pct)
        return round((val / 2.0) - 100)
    except (ValueError, TypeError):
        return None


def run_command_safely(command_args, timeout_seconds=10):
    """
    Executes a system command safely without shell=True to prevent injection.
    Captures stdout and stderr, decoding with resilient fallback character replacement.
    """
    if platform.system() != "Windows":
        return False, "This application requires Microsoft Windows (netsh wlan) to query Wi-Fi hardware.", ""

    try:
        result = subprocess.run(
            command_args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
            shell=False
        )
        return True, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return False, f"Command '{' '.join(command_args)}' timed out after {timeout_seconds} seconds.", ""
    except FileNotFoundError:
        return False, f"Command executable '{command_args[0]}' was not found on this system.", ""
    except Exception as exc:
        return False, f"Subprocess error: {str(exc)}", ""


def parse_connected_interface(raw_output):
    """
    Parses output from 'netsh wlan show interfaces' into a clean structured dictionary.
    Excludes sensitive system properties (e.g. GUIDs, internal device keys) for security.
    """
    now_iso = datetime.now(timezone.utc).isoformat()

    # Check for known service or missing adapter conditions
    if "no wireless interface on the system" in raw_output.lower():
        return {
            "success": True,
            "connected": False,
            "state": "no_interface",
            "message": "No active wireless interface found on this system. Please verify your Wi-Fi adapter is enabled.",
            "timestamp": now_iso
        }

    if "autoconfig service (wlansvc) is not running" in raw_output.lower():
        return {
            "success": True,
            "connected": False,
            "state": "service_stopped",
            "message": "Windows WLAN AutoConfig Service (wlansvc) is not running. Wi-Fi scanning is unavailable.",
            "timestamp": now_iso
        }

    # Extract key-value lines
    kv_data = {}
    for line in raw_output.splitlines():
        if ":" in line:
            parts = line.split(":", 1)
            key = parts[0].strip()
            val = parts[1].strip()
            if key and key not in kv_data:
                kv_data[key] = val

    state = kv_data.get("State", "").lower()
    interface_name = kv_data.get("Name", "Wi-Fi")
    description = kv_data.get("Description", "Wireless Network Adapter")

    if state != "connected":
        return {
            "success": True,
            "connected": False,
            "state": state or "disconnected",
            "interface_name": interface_name,
            "interface_description": description,
            "message": "Wi-Fi interface is disconnected. Connect to a wireless network to view live signal metrics.",
            "timestamp": now_iso
        }

    # Connected state parsing
    raw_signal = kv_data.get("Signal", "")
    signal_pct = None
    m_sig = re.search(r"(\d+)%", raw_signal)
    if m_sig:
        signal_pct = int(m_sig.group(1))

    # Parse RSSI if natively exposed by modern Windows 11 drivers
    native_rssi = None
    raw_rssi = kv_data.get("Rssi", "")
    if raw_rssi:
        m_rssi = re.search(r"(-?\d+)", raw_rssi)
        if m_rssi:
            native_rssi = int(m_rssi.group(1))

    # Channel parsing
    channel = None
    raw_channel = kv_data.get("Channel", "")
    if raw_channel:
        m_chan = re.search(r"(\d+)", raw_channel)
        if m_chan:
            channel = int(m_chan.group(1))

    # Rates parsing
    rx_rate = None
    tx_rate = None
    try:
        raw_rx = kv_data.get("Receive rate (Mbps)") or kv_data.get("Receive rate") or ""
        if raw_rx:
            m_rx = re.search(r"([\d.]+)", raw_rx)
            if m_rx:
                rx_rate = float(m_rx.group(1))
    except (ValueError, TypeError):
        rx_rate = None

    try:
        raw_tx = kv_data.get("Transmit rate (Mbps)") or kv_data.get("Transmit rate") or ""
        if raw_tx:
            m_tx = re.search(r"([\d.]+)", raw_tx)
            if m_tx:
                tx_rate = float(m_tx.group(1))
    except (ValueError, TypeError):
        tx_rate = None

    ssid = kv_data.get("SSID", "Unknown Network")
    bssid = kv_data.get("AP BSSID") or kv_data.get("BSSID") or "N/A"
    band = kv_data.get("Band", "N/A")
    radio_type = kv_data.get("Radio type", "N/A")
    authentication = kv_data.get("Authentication", "N/A")
    cipher = kv_data.get("Cipher", "N/A")

    estimated_dbm = calculate_estimated_dbm(signal_pct)
    quality = classify_signal_quality(signal_pct)

    return {
        "success": True,
        "connected": True,
        "state": "connected",
        "interface_name": interface_name,
        "interface_description": description,
        "ssid": ssid,
        "bssid": bssid,
        "signal": signal_pct,
        "estimated_dbm": estimated_dbm,
        "native_rssi": native_rssi,
        "quality": quality,
        "channel": channel,
        "band": band,
        "radio_type": radio_type,
        "authentication": authentication,
        "cipher": cipher,
        "receive_rate_mbps": rx_rate,
        "transmit_rate_mbps": tx_rate,
        "message": f"Connected to {ssid}",
        "timestamp": now_iso
    }


def parse_nearby_networks(raw_output):
    """
    Parses output from 'netsh wlan show networks mode=bssid' into a list of access point records.
    Handles:
    - Multiple BSSIDs per SSID (e.g. mesh access points, dual-band SSIDs)
    - Hidden networks (empty SSID string)
    - Extracts signal %, estimated dBm, channel, band, radio type, security, and BSSID
    - Sorts records by signal strength (highest first)
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    lines = raw_output.splitlines()

    networks = []
    curr_ssid = None
    curr_hidden = False
    curr_net_type = None
    curr_auth = None
    curr_enc = None
    curr_ap = None

    for line in lines:
        sline = line.strip()
        if not sline:
            continue

        # Detect new SSID header: "SSID 1 : NetworkName" or "SSID 2 :" (hidden)
        m_ssid = re.match(r"^SSID\s+\d+\s*:\s*(.*)$", sline, re.IGNORECASE)
        if m_ssid:
            raw_name = m_ssid.group(1).strip()
            curr_hidden = not raw_name
            curr_ssid = raw_name if raw_name else "[Hidden Network]"
            curr_net_type = None
            curr_auth = None
            curr_enc = None
            curr_ap = None
            continue

        # SSID-level properties
        m_net_type = re.match(r"^Network type\s*:\s*(.*)$", sline, re.IGNORECASE)
        if m_net_type:
            curr_net_type = m_net_type.group(1).strip()
            continue

        m_auth = re.match(r"^Authentication\s*:\s*(.*)$", sline, re.IGNORECASE)
        if m_auth:
            curr_auth = m_auth.group(1).strip()
            continue

        m_enc = re.match(r"^Encryption\s*:\s*(.*)$", sline, re.IGNORECASE)
        if m_enc:
            curr_enc = m_enc.group(1).strip()
            continue

        # Detect BSSID header: "BSSID 1 : 1a:b3:41:8c:7b:f1" or "BSSID : 1a:b3:41:8c:7b:f1"
        m_bssid = re.match(r"^BSSID(?:\s+\d+)?\s*:\s*([0-9a-fA-F:-]+)", sline, re.IGNORECASE)
        if m_bssid:
            bssid_val = m_bssid.group(1).strip()
            curr_ap = {
                "ssid": curr_ssid if curr_ssid else "[Hidden Network]",
                "is_hidden": curr_hidden,
                "bssid": bssid_val,
                "network_type": curr_net_type or "Infrastructure",
                "authentication": curr_auth or "Unknown",
                "encryption": curr_enc or "Unknown",
                "signal": None,
                "estimated_dbm": None,
                "quality": "Unknown",
                "channel": None,
                "band": "Unknown",
                "radio_type": "Unknown"
            }
            networks.append(curr_ap)
            continue

        # BSSID-specific properties
        if curr_ap:
            m_sig = re.match(r"^Signal\s*:\s*(\d+)\s*%", sline, re.IGNORECASE)
            if m_sig:
                val = int(m_sig.group(1))
                curr_ap["signal"] = val
                curr_ap["estimated_dbm"] = calculate_estimated_dbm(val)
                curr_ap["quality"] = classify_signal_quality(val)
                continue

            m_chan = re.match(r"^Channel\s*:\s*(\d+)", sline, re.IGNORECASE)
            if m_chan:
                curr_ap["channel"] = int(m_chan.group(1))
                continue

            m_band = re.match(r"^Band\s*:\s*(.*)$", sline, re.IGNORECASE)
            if m_band:
                curr_ap["band"] = m_band.group(1).strip()
                continue

            m_radio = re.match(r"^Radio type\s*:\s*(.*)$", sline, re.IGNORECASE)
            if m_radio:
                curr_ap["radio_type"] = m_radio.group(1).strip()
                continue

    # Sort results by signal strength percentage descending (highest first)
    # APs with unknown signal go to the end
    networks.sort(
        key=lambda ap: (ap["signal"] is not None, ap["signal"] if ap["signal"] is not None else -1),
        reverse=True
    )

    count = len(networks)
    msg = f"Detected {count} nearby access point record{'s' if count != 1 else ''}." if count > 0 else "No nearby Wi-Fi networks detected."

    return {
        "success": True,
        "count": count,
        "networks": networks,
        "message": msg,
        "timestamp": now_iso
    }


@app.route("/")
def index():
    """Serves the main dashboard user interface."""
    return render_template("index.html")


@app.route("/api/status", methods=["GET"])
def api_status():
    """
    Returns current Wi-Fi connection information as JSON.
    Executes 'netsh wlan show interfaces'.
    """
    success, stdout, stderr = run_command_safely(["netsh", "wlan", "show", "interfaces"], timeout_seconds=8)
    if not success:
        return jsonify({
            "success": False,
            "connected": False,
            "state": "error",
            "message": stdout or "Failed to query wireless interface status.",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }), 500

    parsed = parse_connected_interface(stdout)
    return jsonify(parsed), 200


@app.route("/api/scan", methods=["GET"])
def api_scan():
    """
    Returns nearby Wi-Fi access point information as JSON.
    Executes 'netsh wlan show networks mode=bssid'.
    """
    success, stdout, stderr = run_command_safely(["netsh", "wlan", "show", "networks", "mode=bssid"], timeout_seconds=15)
    if not success:
        return jsonify({
            "success": False,
            "count": 0,
            "networks": [],
            "message": stdout or "Failed to scan nearby Wi-Fi networks.",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }), 500

    parsed = parse_nearby_networks(stdout)
    return jsonify(parsed), 200


def open_browser():
    """Opens the local dashboard in default browser after server initializes."""
    try:
        webbrowser.open_new_tab("http://127.0.0.1:5000")
    except Exception:
        pass


if __name__ == "__main__":
    # Server is strictly bound to localhost (127.0.0.1)
    print("==================================================================")
    print("   Wi-Fi Signal Strength Analyzer Web Application")
    print("   Running locally on: http://127.0.0.1:5000")
    print("   Opening web browser automatically...")
    print("   Press CTRL+C to stop the server.")
    print("==================================================================")
    threading.Timer(1.25, open_browser).start()
    app.run(host="127.0.0.1", port=5000, debug=False)
