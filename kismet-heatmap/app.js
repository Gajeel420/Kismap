// Kismet Heatmap App Logic

let map;
let heatLayer;
let pollingInterval = null;
let lastTime = 0;
let devicesData = new Map(); // Store devices by MAC address

// DOM Elements
const kismetUrlInput = document.getElementById('kismet-url');
const kismetAuthInput = document.getElementById('kismet-auth');
const connectBtn = document.getElementById('connect-btn');
const statusText = document.getElementById('status-text');
const deviceCountEl = document.getElementById('device-count');

const filterSsidInput = document.getElementById('filter-ssid');
const filterBssidInput = document.getElementById('filter-bssid');
const typeApCb = document.getElementById('type-ap');
const typeClientCb = document.getElementById('type-client');
const typeBridgeCb = document.getElementById('type-bridge');

// Initialize Map
function initMap() {
    // Default to a generic location, user's Kismet data will move it
    map = L.map('map').setView([0, 0], 2);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    heatLayer = L.heatLayer([], {
        radius: 25,
        blur: 15,
        maxZoom: 17,
        gradient: {
            0.4: 'blue',
            0.6: 'cyan',
            0.7: 'lime',
            0.8: 'yellow',
            1.0: 'red'
        }
    }).addTo(map);
}

// Map RSSI to heat intensity (0.0 to 1.0)
// Typical RSSI range: -100 (weak) to -30 (strong)
function rssiToIntensity(rssi) {
    if (rssi >= -30) return 1.0;
    if (rssi <= -100) return 0.1;
    return (rssi + 100) / 70;
}

// Apply filters to devices and update heatmap
function updateHeatmap() {
    const ssidFilter = new RegExp(filterSsidInput.value, 'i');
    const bssidFilter = filterBssidInput.value.toLowerCase().trim();
    
    const showAp = typeApCb.checked;
    const showClient = typeClientCb.checked;
    const showBridge = typeBridgeCb.checked;

    const heatPoints = [];
    let visibleCount = 0;

    let centerLat = 0;
    let centerLon = 0;

    devicesData.forEach(device => {
        // Apply Type Filter
        const type = device.type.toLowerCase();
        let typeMatch = false;
        if (showAp && type.includes('ap')) typeMatch = true;
        if (showClient && type.includes('client')) typeMatch = true;
        if (showBridge && (type.includes('bridge') || (!type.includes('ap') && !type.includes('client')))) typeMatch = true;
        
        if (!typeMatch) return;

        // Apply SSID Filter
        if (filterSsidInput.value && !ssidFilter.test(device.ssid)) return;

        // Apply BSSID Filter
        if (bssidFilter && !device.bssid.toLowerCase().includes(bssidFilter)) return;

        // Valid point
        const intensity = rssiToIntensity(device.rssi);
        heatPoints.push([device.lat, device.lon, intensity]);
        visibleCount++;

        centerLat += device.lat;
        centerLon += device.lon;
    });

    heatLayer.setLatLngs(heatPoints);
    deviceCountEl.textContent = visibleCount;

    // Center map if first time having data
    if (visibleCount > 0 && map.getZoom() === 2) {
        map.setView([centerLat / visibleCount, centerLon / visibleCount], 16);
    }
}

// Fetch Kismet Data
async function fetchKismetData() {
    const baseUrl = kismetUrlInput.value.replace(/\/$/, "");
    const authInfo = kismetAuthInput.value;
    
    let headers = {};
    if (authInfo) {
        // Check if it's token or basic auth
        if (authInfo.includes(':')) {
            headers['Authorization'] = 'Basic ' + btoa(authInfo);
        } else {
            // Assume Kismet API token (cookie or header, but typical header is X-Kismet-Token or Authorization: Bearer)
            headers['X-Kismet-Token'] = authInfo; // Some implementations might need this or cookies
            headers['Authorization'] = 'Bearer ' + authInfo; // Fallback
        }
    }

    try {
        statusText.textContent = "Polling...";
        statusText.className = "polling";
        
        // Fetch devices (could optimize by using last-time API, but using all for simplicity in MVP)
        // Kismet JSON format can be deep, we ask for specific fields if possible or parse the full dump.
        const url = `${baseUrl}/devices/views/all/devices.json`;
        
        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data && Array.isArray(data)) {
            data.forEach(item => {
                try {
                    const mac = item['kismet.device.base.macaddr'];
                    const name = item['kismet.device.base.name'] || '';
                    const type = item['kismet.device.base.type'] || 'Unknown';
                    const signal = item['kismet.device.base.signal'] || {};
                    const rssi = signal['kismet.common.signal.last_signal'] || -90;
                    
                    const loc = item['kismet.device.base.location'] || {};
                    const avgLoc = loc['kismet.common.location.avg_loc'] || {};
                    const lat = avgLoc['kismet.common.location.geopoint'] ? avgLoc['kismet.common.location.geopoint'][1] : null;
                    const lon = avgLoc['kismet.common.location.geopoint'] ? avgLoc['kismet.common.location.geopoint'][0] : null;

                    // If no location, skip
                    if (lat !== null && lon !== null && lat !== 0 && lon !== 0) {
                        devicesData.set(mac, {
                            bssid: mac,
                            ssid: name,
                            type: type,
                            rssi: rssi,
                            lat: lat,
                            lon: lon
                        });
                    }
                } catch (err) {
                    console.warn("Failed to parse device data:", item);
                }
            });
        }
        
        statusText.textContent = "Connected";
        statusText.className = "connected";
        
        updateHeatmap();

    } catch (error) {
        console.error("Kismet fetch error:", error);
        statusText.textContent = "Error: " + error.message;
        statusText.className = "error";
        
        // Let's add some mock data if in local dev testing and fetch fails
        if (devicesData.size === 0 && baseUrl.includes("localhost")) {
            console.log("Injecting mock data for testing UI since fetch failed...");
            injectMockData();
            updateHeatmap();
        }
    }
}

function injectMockData() {
    // Generate some fake APs around a center point
    const center = [37.7749, -122.4194]; // SF
    for (let i = 0; i < 50; i++) {
        const lat = center[0] + (Math.random() - 0.5) * 0.01;
        const lon = center[1] + (Math.random() - 0.5) * 0.01;
        const mac = `00:11:22:33:44:${i.toString(16).padStart(2, '0')}`;
        devicesData.set(mac, {
            bssid: mac,
            ssid: `MockNetwork_${i}`,
            type: i % 3 === 0 ? 'Wi-Fi Client' : 'Wi-Fi AP',
            rssi: -90 + Math.random() * 50,
            lat: lat,
            lon: lon
        });
    }
}

// Event Listeners
connectBtn.addEventListener('click', () => {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        connectBtn.textContent = "Connect & Poll";
        statusText.textContent = "Disconnected";
        statusText.className = "";
    } else {
        connectBtn.textContent = "Stop Polling";
        // Immediate fetch
        fetchKismetData();
        // Poll every 5 seconds
        pollingInterval = setInterval(fetchKismetData, 5000);
    }
});

filterSsidInput.addEventListener('input', updateHeatmap);
filterBssidInput.addEventListener('input', updateHeatmap);
typeApCb.addEventListener('change', updateHeatmap);
typeClientCb.addEventListener('change', updateHeatmap);
typeBridgeCb.addEventListener('change', updateHeatmap);

// Run initialization
document.addEventListener('DOMContentLoaded', initMap);
