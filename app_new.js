/* ============================================================
   Disaster Supply Locator — Frontend JS
   Connects to Flask backend at http://localhost:5000
   ============================================================ */

const API = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "http://localhost:5000" : window.location.origin;

// ─── BUG FIX #1 ───────────────────────────────────────────────────────────────
// REMOVED the top-level Leaflet map initialization that was here.
// L.map('leafletMap') ran on every page, but #leafletMap only exists on
// user-dashboard.html — crashing the entire JS file on all other pages.
// The map is now initialized only inside initUserDashboard() where it belongs.
// ──────────────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page || "";

  const pageMap = {
    "user-auth": initUserAuth,
    "admin-auth": initAdminAuth,
    "admin-dashboard": initAdminDashboard,
    "user-dashboard": initUserDashboard
  };

  if (pageMap[page]) pageMap[page]();
});

/* =========================
   COMMON HELPERS
========================= */
const goTo = (page) => (window.location.href = page);

function togglePanels(showPanel, hidePanel, activeBtn, inactiveBtn) {
  showPanel.classList.add("active-panel");
  hidePanel.classList.remove("active-panel");
  activeBtn.classList.add("active");
  inactiveBtn.classList.remove("active");
}

function saveAdminToken(idToken, uid, companyName, phone, email) {
  sessionStorage.setItem("admin_token", idToken);
  sessionStorage.setItem("admin_uid", uid);
  sessionStorage.setItem("admin_company", companyName);
  sessionStorage.setItem("admin_phone", phone);
  sessionStorage.setItem("admin_email", email);
}

function getAdminToken() {
  return sessionStorage.getItem("admin_token");
}

function clearAdminSession() {
  sessionStorage.removeItem("admin_token");
  sessionStorage.removeItem("admin_uid");
  sessionStorage.removeItem("admin_company");
  sessionStorage.removeItem("admin_phone");
  sessionStorage.removeItem("admin_email");
}

// Generic fetch helper
async function apiCall(path, method = "GET", body = null, token = null) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${API}${path}`, options);
  const json = await res.json();
  return { ok: res.ok, status: res.status, data: json };
}

/* =========================
   USER AUTH
========================= */
function initUserAuth() {
  const registerBtn = document.getElementById("userRegisterToggleBtn");
  const signinBtn = document.getElementById("userSigninToggleBtn");
  const registerPanel = document.getElementById("userRegisterForm");
  const signinPanel = document.getElementById("userSigninForm");
  const registerForm = document.getElementById("userRegisterActualForm");
  const signinForm = document.getElementById("userSigninActualForm");

  const showRegister = () => togglePanels(registerPanel, signinPanel, registerBtn, signinBtn);
  const showSignin = () => togglePanels(signinPanel, registerPanel, signinBtn, registerBtn);

  registerBtn?.addEventListener("click", showRegister);
  signinBtn?.addEventListener("click", showSignin);

  // USER CREATE ACCOUNT
  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("userEmail").value.trim().toLowerCase();
    const userName = document.getElementById("userName").value.trim();
    const phone = document.getElementById("userPhone").value.trim();
    const address = document.getElementById("userAddress").value.trim();

    const { ok, data } = await apiCall("/api/user/register", "POST", { email, userName, phone, address });

    if (!ok) {
      alert(data.message || "Registration failed.");
      if (data.message?.includes("already exists")) {
        showSignin();
        document.getElementById("signinUserEmail").value = email;
      }
      return;
    }

    sessionStorage.setItem("user_email", email);
    sessionStorage.setItem("user_name", data.data.userName);

    alert("User account created successfully.");
    goTo("user-dashboard.html");
  });

  // USER SIGN IN
  signinForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("signinUserEmail").value.trim().toLowerCase();

    const { ok, data } = await apiCall("/api/user/signin", "POST", { email });

    if (!ok) {
      alert(data.message || "Sign in failed.");
      if (data.message?.includes("register first")) showRegister();
      return;
    }

    sessionStorage.setItem("user_email", email);
    sessionStorage.setItem("user_name", data.data.userName);

    alert("User sign in successful.");
    goTo("user-dashboard.html");
  });
}

/* =========================
   ADMIN AUTH
========================= */
function initAdminAuth() {
  const registerBtn = document.getElementById("adminRegisterToggleBtn");
  const signinBtn = document.getElementById("adminSigninToggleBtn");
  const registerPanel = document.getElementById("adminRegisterForm");
  const signinPanel = document.getElementById("adminSigninForm");
  const registerForm = document.getElementById("adminRegisterActualForm");
  const signinForm = document.getElementById("adminSigninActualForm");
  const resetToggleBtn = document.getElementById("showResetPasswordBtn");
  const resetPanel = document.getElementById("resetPasswordPanel");
  const resetForm = document.getElementById("adminResetPasswordForm");

  const showRegister = () => togglePanels(registerPanel, signinPanel, registerBtn, signinBtn);
  const showSignin = () => togglePanels(signinPanel, registerPanel, signinBtn, registerBtn);

  registerBtn?.addEventListener("click", showRegister);
  signinBtn?.addEventListener("click", showSignin);

  // ADMIN CREATE ACCOUNT
  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("adminEmail").value.trim().toLowerCase();
    const password = document.getElementById("adminPassword").value.trim();
    const confirmPassword = document.getElementById("adminConfirmPassword").value.trim();
    const companyName = document.getElementById("companyName").value.trim();
    const phone = document.getElementById("adminPhone").value.trim();

    if (password !== confirmPassword) {
      alert("Password and Confirm Password do not match.");
      return;
    }

    const { ok, data } = await apiCall("/api/admin/register", "POST", {
      email, password, companyName, phone
    });

    if (!ok) {
      alert(data.message || "Registration failed.");
      if (data.message?.includes("already exists")) {
        showSignin();
        document.getElementById("signinAdminEmail").value = email;
      }
      return;
    }

    saveAdminToken(data.data.idToken, data.data.uid, data.data.companyName, data.data.phone, email);
    alert("Admin account created successfully.");
    goTo("admin-dashboard.html");
  });

  // ADMIN SIGN IN
  signinForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("signinAdminEmail").value.trim().toLowerCase();
    const password = document.getElementById("signinAdminPassword").value.trim();

    const { ok, data } = await apiCall("/api/admin/signin", "POST", { email, password });

    if (!ok) {
      alert(data.message || "Sign in failed.");
      if (data.message?.includes("register first")) showRegister();
      return;
    }

    saveAdminToken(data.data.idToken, data.data.uid, data.data.companyName, data.data.phone, email);
    alert("Admin sign in successful.");
    goTo("admin-dashboard.html");
  });

  // SHOW RESET PASSWORD PANEL
  resetToggleBtn?.addEventListener("click", () => {
    resetPanel.classList.toggle("show-reset");
  });

  // RESET PASSWORD
  resetForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("resetAdminEmail").value.trim().toLowerCase();
    const newPassword = document.getElementById("newAdminPassword").value.trim();
    const confirmNewPassword = document.getElementById("confirmNewAdminPassword").value.trim();

    if (newPassword !== confirmNewPassword) {
      alert("New password and confirm new password do not match.");
      return;
    }

    const { ok, data } = await apiCall("/api/admin/reset-password", "POST", { email, newPassword });

    if (!ok) {
      alert(data.message || "Password reset failed.");
      return;
    }

    alert("Password reset successfully. You can now sign in with your new password.");
    resetPanel.classList.remove("show-reset");
    showSignin();
    document.getElementById("signinAdminEmail").value = email;
  });
}

/* =========================
   ADMIN DASHBOARD
========================= */
function initAdminDashboard() {
  if (!getAdminToken()) {
    alert("Please sign in first.");
    goTo("admin-auth.html");
    return;
  }

  const el = {
    dashboardView: document.getElementById("dashboardView"),
    manageView: document.getElementById("manageView"),
    pageTitle: document.getElementById("pageTitle"),
    sidebarNav: document.getElementById("sidebarNav"),
    sidebarTopImage: document.getElementById("sidebarTopImage"),
    sidebarBottomImage: document.getElementById("sidebarBottomImage"),
    addCenterBtn: document.getElementById("addCenterBtn"),
    addCenterTopBtn: document.getElementById("addCenterTopBtn"),
    editBtn: document.getElementById("editBtn"),
    logoutTopBtn: document.getElementById("logoutTopBtn"),
    backToDashboardBtn: document.getElementById("backToDashboardBtn"),
    bottomBackBtn: document.getElementById("bottomBackBtn"),
    reliefForm: document.getElementById("reliefForm"),
    reliefTableBody: document.getElementById("reliefTableBody"),
    emptyState: document.getElementById("emptyState"),
    totalItemsBtn: document.getElementById("totalItemsBtn"),
    clearFormBtn: document.getElementById("clearFormBtn"),
    sendSmsBtn: document.getElementById("sendSmsBtn")
  };

  const doLogout = () => {
    clearAdminSession();
    goTo("admin-auth.html");
  };

  const updateTableState = () => {
    const count = el.reliefTableBody.querySelectorAll("tr").length;
    el.totalItemsBtn.textContent = `${count} Items`;
    el.emptyState.style.display = count ? "none" : "block";
  };

  const renderDashboardSidebar = () => {
    el.sidebarTopImage.className = "sidebar-image top-image dashboard-top";
    el.sidebarBottomImage.className = "sidebar-image bottom-image dashboard-bottom";
    el.sidebarNav.innerHTML = `
      <button class="nav-item active" id="dashboardNavBtn">
        <span class="nav-icon">◉</span> Dashboard
      </button>
      <button class="nav-item" id="manageNavBtn">
        <span class="nav-icon">⌂</span> Relief Centers
      </button>
      <button class="nav-item" id="logoutNavBtn">
        <span class="nav-icon">⇦</span> Logout
      </button>
    `;
    document.getElementById("dashboardNavBtn")?.addEventListener("click", showDashboard);
    document.getElementById("manageNavBtn")?.addEventListener("click", showManage);
    document.getElementById("logoutNavBtn")?.addEventListener("click", doLogout);
  };

  const renderManageSidebar = () => {
    el.sidebarTopImage.className = "sidebar-image top-image manage-top";
    el.sidebarBottomImage.className = "sidebar-image bottom-image manage-bottom";
    el.sidebarNav.innerHTML = `
      <!-- <button class="nav-item active" id="sendSmsNavBtn">
        <span class="nav-icon">✉</span> Send SMS
      </button> -->
      <button class="nav-item" id="manageReliefNavBtn">
        <span class="nav-icon">◉</span> Relief Centers
      </button>
    `;
    document.getElementById("sendSmsNavBtn")?.addEventListener("click", () => {
      alert("SMS feature can be connected later.");
    });
    document.getElementById("manageReliefNavBtn")?.addEventListener("click", showManage);
  };

  const showDashboard = () => {
    el.dashboardView.classList.add("active-view");
    el.manageView.classList.remove("active-view");
    el.pageTitle.textContent = "Admin Dashboard";
    renderDashboardSidebar();
    renderTable();
  };

  const showManage = () => {
    el.dashboardView.classList.remove("active-view");
    el.manageView.classList.add("active-view");
    el.pageTitle.textContent = "Manage Relief Centers";
    renderManageSidebar();
  };

  // LOAD & RENDER RELIEF CENTERS TABLE
  const renderTable = async () => {
    const { ok, data } = await apiCall("/api/relief-centers");
    if (!ok) {
      el.emptyState.style.display = "block";
      return;
    }

    const centers = data.data || [];
    el.reliefTableBody.innerHTML = "";

    centers.forEach((item) => {
      const row = document.createElement("tr");
      row.setAttribute("data-id", item.id);
      row.innerHTML = `
        <td>${item.centerName || ""}</td>
        <td>${item.reliefType || ""}</td>
        <td>${item.address || ""}</td>
        <td>${item.phoneNumber || ""}</td>
        <td>${item.lastUpdated ? new Date(item.lastUpdated).toLocaleString() : ""}</td>
        <td><button class="delete-btn">Delete</button></td>
      `;
      el.reliefTableBody.appendChild(row);
    });

    el.reliefTableBody.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("tr");
        const id = row.getAttribute("data-id");

        if (!confirm("Delete this relief center?")) return;

        const { ok, data: res } = await apiCall(
          `/api/relief-centers/${id}`, "DELETE", null, getAdminToken()
        );

        if (!ok) {
          alert(res.message || "Delete failed.");
          return;
        }

        row.remove();
        updateTableState();
      });
    });

    updateTableState();
  };

  // SAVE RELIEF CENTER
  el.reliefForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const centerName = document.getElementById("centerName").value.trim();
    const reliefType = document.getElementById("reliefType").value.trim();
    const address = document.getElementById("address").value.trim();
    const phoneNumber = document.getElementById("phoneNumber").value.trim();

    if (!centerName || !reliefType || !address || !phoneNumber) {
      alert("Please fill all fields.");
      return;
    }

    const { ok, data } = await apiCall("/api/relief-centers", "POST", {
      centerName, reliefType, address, phoneNumber
    }, getAdminToken());

    if (!ok) {
      if (data.message?.includes("expired") || data.message?.includes("token")) {
        alert("Your session has expired. Please sign in again.");
        doLogout();
        return;
      }
      alert(data.message || "Failed to save relief center.");
      return;
    }

    alert("Relief center saved successfully.");
    el.reliefForm.reset();
    showDashboard();
  });

  el.clearFormBtn?.addEventListener("click", () => el.reliefForm.reset());

  el.sendSmsBtn?.addEventListener("click", async () => {
    // Read address from the form — this is the "center location" for proximity check
    const centerAddress = (document.getElementById("address")?.value || "").trim();

    if (!centerAddress) {
      alert("⚠️ Please enter the Relief Center Address in the form first.\nThe system needs it to find nearby registered users.");
      document.getElementById("address")?.focus();
      return;
    }

    const defaultMsg =
      `🚨 Emergency Alert: A new relief center has been set up at "${centerAddress}". ` +
      `Please visit the Disaster Supply Locator app for full details and directions.`;

    const message = prompt("Edit the SMS message to send to all nearby users:", defaultMsg);
    if (!message || !message.trim()) return;

    const radiusInput = prompt("Send SMS to users within how many km? (default: 50)", "50");
    if (radiusInput === null) return;
    const radius_km = parseFloat(radiusInput) || 50;

    if (!confirm(
      `📲 This will automatically send SMS to ALL registered users within ${radius_km} km of:\n"${centerAddress}"\n\nProceed?`
    )) return;

    // Show loading state on button
    const origText = el.sendSmsBtn.textContent;
    el.sendSmsBtn.textContent = "Sending…";
    el.sendSmsBtn.disabled = true;

    try {
      const res = await fetch(`${API}/api/send-sms-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          center_address: centerAddress,
          message: message.trim(),
          radius_km
        })
      });
      const data = await res.json();

      if (res.ok) {
        const d = data.data || {};
        let summary = `✅ Bulk SMS Complete!\n\n`;
        summary += `📨 Sent:    ${d.sent ?? 0} user(s)\n`;
        summary += `⏭️ Skipped: ${d.skipped ?? 0} user(s) (too far / geocode failed)\n`;
        summary += `❌ Failed:  ${d.failed ?? 0} user(s)\n`;
        if (d.details_sent && d.details_sent.length) {
          summary += `\nRecipients:\n`;
          d.details_sent.forEach(u => {
            summary += `  • ${u.name} (${u.phone}) — ${u.distance_km} km away\n`;
          });
        }

        if (d.details_failed && d.details_failed.length) {
          summary += `\n❌ Failed — reasons:\n`;
          d.details_failed.forEach(u => {
            summary += `  • ${u.name} (${u.phone}): ${u.reason}\n`;
          });
        }
        alert(summary);
      } else {
        alert("❌ " + (data.message || "Bulk SMS failed. Check the backend logs."));
      }
    } catch (e) {
      alert("❌ Network error: Could not reach the server. Make sure the backend is running.");
    } finally {
      el.sendSmsBtn.textContent = origText;
      el.sendSmsBtn.disabled = false;
    }
  });

  [el.addCenterBtn, el.addCenterTopBtn, el.editBtn].forEach((btn) =>
    btn?.addEventListener("click", showManage)
  );

  [el.backToDashboardBtn, el.bottomBackBtn].forEach((btn) =>
    btn?.addEventListener("click", showDashboard)
  );

  el.logoutTopBtn?.addEventListener("click", doLogout);

  showDashboard();
}

/* =========================
   USER DASHBOARD
========================= */
async function initUserDashboard() {
  const searchBtn = document.getElementById("searchAddressBtn");
  const addressInput = document.getElementById("userAddressInput");
  const logoutBtn = document.getElementById("userLogoutBtn");
  const emergencyBtn = document.getElementById("emergencyBtn");
  const reliefCenterList = document.getElementById("reliefCenterList");
  const emptyReliefState = document.getElementById("emptyReliefState");

  // ── BUG FIX #1 (continued) ───────────────────────────────────────────────
  // Map is initialized HERE, inside initUserDashboard, so it only runs on
  // user-dashboard.html where the #leafletMap element actually exists.
  // ─────────────────────────────────────────────────────────────────────────
  const map = L.map("leafletMap").setView([20.5937, 78.9629], 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 18
  }).addTo(map);

  detectUserLocation(map);

  // Custom marker icons
  const makeIcon = (color) => L.divIcon({
    className: "",
    html: `<div style="
      width:16px;height:16px;border-radius:50%;
      background:${color};border:2px solid white;
      box-shadow:0 1px 4px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10]
  });

  const iconMap = {
    medical: makeIcon("#e53935"),
    food: makeIcon("#1e88e5"),
    shelter: makeIcon("#43a047"),
    default: makeIcon("#8e24aa")
  };

  function getMarkerIcon(reliefType = "") {
    const t = reliefType.toLowerCase();
    if (t.includes("medical")) return iconMap.medical;
    if (t.includes("food")) return iconMap.food;
    if (t.includes("shelter")) return iconMap.shelter;
    return iconMap.default;
  }

  // Geocode address using free Nominatim API
  async function geocodeAddress(address) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
      const res = await fetch(url, { headers: { "Accept-Language": "en" } });
      const json = await res.json();
      if (json && json.length > 0) {
        return { lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon) };
      }
    } catch (err) {
      console.error("Geocoding error:", err);
    }
    return null;
  }

  // Load relief centers from backend
  const { ok, data } = await apiCall("/api/relief-centers");
  const centers = ok ? (data.data || []) : [];
  renderReliefCenters(centers, reliefCenterList, emptyReliefState);

  // Place markers for each relief center on the map
  const markerList = [];
  for (const center of centers) {
    if (!center.address) continue;
    const coords = await geocodeAddress(center.address);
    if (!coords) continue;
    const marker = L.marker([coords.lat, coords.lon], {
      icon: getMarkerIcon(center.reliefType)
    }).addTo(map);
    marker.bindPopup(`
      <b>${center.centerName}</b><br>
      ${center.reliefType}<br>
      📍 ${center.address}<br>
      📞 ${center.phoneNumber || "--"}
    `);
    markerList.push(marker);
  }

  // Fit map to show all markers
  if (markerList.length > 0) {
    const group = L.featureGroup(markerList);
    map.fitBounds(group.getBounds().pad(0.2));
  }

  // User location marker (reusable)
  let userMarker = null;

  // ── BUG FIX #2 ────────────────────────────────────────────────────────────
  // REMOVED the first duplicate searchBtn listener that was added earlier in
  // the original file (lines 513–534). It was an incomplete older version that
  // called the undefined loadReliefCenters() and conflicted with this correct
  // listener, causing double alerts and double map pins on every search click.
  // ──────────────────────────────────────────────────────────────────────────
  searchBtn?.addEventListener("click", async () => {
    const userAddress = addressInput.value.trim();
    if (!userAddress) {
      alert("Please enter your address to search nearby relief centers.");
      return;
    }

    const coords = await geocodeAddress(userAddress);
    if (!coords) {
      alert("Address not found. Please try a more specific address.");
      return;
    }

    // Remove old user marker
    if (userMarker) map.removeLayer(userMarker);

    // Add new user location pin
    userMarker = L.marker([coords.lat, coords.lon], {
      icon: L.divIcon({
        className: "",
        html: `<div style="
          width:20px;height:20px;border-radius:50%;
          background:#ff9800;border:3px solid white;
          box-shadow:0 2px 6px rgba(0,0,0,0.5);
        "></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        popupAnchor: [0, -12]
      })
    }).addTo(map);
    userMarker.bindPopup(`📍 <b>Your Location</b><br>${userAddress}`).openPopup();
    map.setView([coords.lat, coords.lon], 11);
  });

  emergencyBtn?.addEventListener("click", async () => {

    if (!confirm("Find nearest help and navigate?")) return;

    if (!navigator.geolocation) {
      alert("Location not supported");
      return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
      const userLat = position.coords.latitude;
      const userLng = position.coords.longitude;

      const { ok, data } = await apiCall("/api/relief-centers");
      if (!ok) {
        alert("Could not load relief centers.");
        return;
      }

      const centers = data.data || [];

      let nearest = null;
      let minDistance = Infinity;

      for (const center of centers) {

        await new Promise(r => setTimeout(r, 800)); // ⏳ avoid API block

        const coords = await getCoordinates(center.address);
        if (!coords) continue;

        const dist = calculateDistance(userLat, userLng, coords.lat, coords.lng);

        if (dist < minDistance) {
          minDistance = dist;
          nearest = { ...center, ...coords };
        }
      }

      if (nearest) {
        openDirections(nearest.lat, nearest.lng); // 🚗 open navigation
      } else {
        alert("No nearby relief center found.");
      }

    }, () => {
      alert("Location permission denied.");
    });

  });

  logoutBtn?.addEventListener("click", () => {
    sessionStorage.removeItem("user_email");
    sessionStorage.removeItem("user_name");
    goTo("user-auth.html");
  });

  // ── DOWNLOAD OFFLINE MAP ─────────────────────────────────────────────────
  const downloadBtn = document.getElementById("downloadOfflineMapBtn");
  const progressBox = document.getElementById("offlineProgress");
  const progressText = document.getElementById("offlineProgressText");

  downloadBtn?.addEventListener("click", async () => {
    downloadBtn.disabled = true;
    downloadBtn.innerHTML = "<span>⏳</span> Preparing…";
    progressBox.style.display = "block";
    progressText.textContent = "Loading relief center data…";

    try {
      // 1. Fetch all relief centers
      const { ok, data } = await apiCall("/api/relief-centers");
      if (!ok) throw new Error("Could not load relief centers.");
      const reliefCenters = data.data || [];

      if (!reliefCenters.length) {
        alert("No relief centers found to download.");
        return;
      }

      // 2. Geocode each center to get lat/lon for map links
      const enriched = [];
      for (let i = 0; i < reliefCenters.length; i++) {
        const c = reliefCenters[i];
        progressText.textContent = `Geocoding ${i + 1} of ${reliefCenters.length}: ${c.centerName}…`;
        await new Promise(r => setTimeout(r, 800)); // Nominatim rate limit
        let lat = null, lon = null;
        try {
          const gRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(c.address)}&limit=1`, { headers: { "Accept-Language": "en" } });
          const gData = await gRes.json();
          if (gData && gData.length) { lat = parseFloat(gData[0].lat); lon = parseFloat(gData[0].lon); }
        } catch (_) { }
        enriched.push({ ...c, lat, lon });
      }

      progressText.textContent = "Generating your offline file…";

      // 3. Build self-contained HTML
      const now = new Date().toLocaleString();
      const typeColor = t => {
        const s = (t || "").toLowerCase();
        if (s.includes("medical")) return { bg: "#fee2e2", badge: "#ef4444", label: "Medical" };
        if (s.includes("food")) return { bg: "#dcfce7", badge: "#16a34a", label: "Food & Water" };
        return { bg: "#dbeafe", badge: "#2563eb", label: "Shelter" };
      };

      const centerCards = enriched.map(c => {
        const col = typeColor(c.reliefType);
        const mapsUrl = c.lat && c.lon
          ? `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lon}`
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`;
        return `
          <div style="background:${col.bg};border-radius:14px;padding:20px 22px;margin-bottom:16px;border:1.5px solid ${col.badge}33;page-break-inside:avoid;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
              <span style="background:${col.badge};color:#fff;border-radius:50%;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:0.9rem;flex-shrink:0;">${col.label[0]}</span>
              <div>
                <div style="font-weight:800;font-size:1rem;color:#0f172a;">${c.centerName || "—"}</div>
                <span style="background:${col.badge};color:#fff;font-size:0.72rem;font-weight:700;border-radius:20px;padding:2px 10px;">${c.reliefType || ""}</span>
              </div>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
              <tr><td style="padding:5px 0;color:#475569;font-weight:700;width:120px;">📍 Address</td><td style="color:#1e293b;font-weight:600;">${c.address || "—"}</td></tr>
              <tr><td style="padding:5px 0;color:#475569;font-weight:700;">📞 Phone</td><td style="color:#1e293b;font-weight:600;">${c.phoneNumber || "—"}</td></tr>
              <tr><td style="padding:5px 0;color:#475569;font-weight:700;">🕒 Updated</td><td style="color:#1e293b;font-weight:600;">${c.lastUpdated ? new Date(c.lastUpdated).toLocaleString() : "—"}</td></tr>
              ${c.lat ? `<tr><td style="padding:5px 0;color:#475569;font-weight:700;">📌 Coords</td><td style="color:#1e293b;font-weight:600;">${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}</td></tr>` : ""}
            </table>
            <a href="${mapsUrl}" target="_blank" style="display:inline-block;margin-top:12px;padding:9px 18px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-size:0.85rem;font-weight:800;">🚗 Get Directions</a>
          </div>`;
      }).join("");

      // OSM static iframe src (loads tiles when online, skips gracefully offline)
      const centerLat = enriched.find(c => c.lat)?.lat || 20.5937;
      const centerLon = enriched.find(c => c.lon)?.lon || 78.9629;

      const offlineHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Offline Relief Map — Disaster Supply Locator</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:"Segoe UI",Arial,sans-serif;background:#eef2f7;color:#0f172a;min-height:100vh;}
    .header{background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#fff;padding:28px 32px;}
    .header h1{font-size:1.9rem;font-weight:800;margin-bottom:4px;}
    .header p{font-size:0.9rem;opacity:0.85;}
    .badge-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;}
    .badge{background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.3);border-radius:20px;padding:4px 14px;font-size:0.78rem;font-weight:700;}
    .container{max-width:860px;margin:0 auto;padding:28px 24px;}
    .meta-bar{background:#fff;border-radius:12px;padding:14px 20px;margin-bottom:22px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;border:1px solid #dbeafe;box-shadow:0 2px 8px rgba(37,99,235,0.07);}
    .meta-item{font-size:0.85rem;color:#475569;font-weight:600;}
    .meta-item strong{color:#1e293b;}
    .section-title{font-size:1.2rem;font-weight:800;color:#1e293b;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #dbeafe;}
    .map-frame{border-radius:14px;overflow:hidden;border:1.5px solid #bfdbfe;box-shadow:0 4px 16px rgba(37,99,235,0.1);margin-bottom:28px;background:#e2e8f0;}
    .map-frame iframe{width:100%;height:340px;border:none;display:block;}
    .map-fallback{padding:28px;text-align:center;color:#475569;font-size:0.88rem;}
    .alert-box{background:#fffbeb;border:1.5px solid #fcd34d;border-radius:10px;padding:12px 16px;margin-bottom:22px;font-size:0.83rem;color:#78350f;font-weight:600;}
    .footer{background:#fff;border-top:1px solid #e5e7eb;padding:18px 32px;text-align:center;color:#64748b;font-size:0.85rem;margin-top:32px;}
    @media print{.header{-webkit-print-color-adjust:exact;print-color-adjust:exact;} body{background:#fff;}}
    @media(max-width:600px){.header{padding:20px 18px;} .container{padding:16px;}}
  </style>
</head>
<body>
  <div class="header">
    <h1>🗺️ Disaster Supply Locator</h1>
    <p>Offline Relief Center Reference — Downloaded on ${now}</p>
    <div class="badge-row">
      <span class="badge">📥 Offline Ready</span>
      <span class="badge">🏥 ${enriched.filter(c => (c.reliefType || "").toLowerCase().includes("medical")).length} Medical</span>
      <span class="badge">🍲 ${enriched.filter(c => (c.reliefType || "").toLowerCase().includes("food")).length} Food & Water</span>
      <span class="badge">🏠 ${enriched.filter(c => !(c.reliefType || "").toLowerCase().includes("medical") && !(c.reliefType || "").toLowerCase().includes("food")).length} Shelter</span>
    </div>
  </div>

  <div class="container">
    <div class="meta-bar">
      <div class="meta-item">📋 Total Centers: <strong>${enriched.length}</strong></div>
      <div class="meta-item">🕒 Downloaded: <strong>${now}</strong></div>
      <div class="meta-item">🌐 Source: <strong>Disaster Supply Locator</strong></div>
    </div>

    <div class="alert-box">
      ⚠️ <strong>Offline Mode:</strong> The map and "Get Directions" links require an internet connection.
      All center names, addresses, and phone numbers below are available offline.
    </div>

    <div class="section-title">🗺️ Map Overview</div>
    <div class="map-frame">
      <iframe
        src="https://www.openstreetmap.org/export/embed.html?bbox=${centerLon - 1},${centerLat - 1},${centerLon + 1},${centerLat + 1}&layer=mapnik"
        loading="lazy"
        title="Relief Centers Map">
      </iframe>
      <div class="map-fallback" style="display:none;" id="mapFallback">
        🌐 Map requires internet. Use the addresses below to navigate.
      </div>
    </div>

    <div class="section-title">🏥 Relief Centers (${enriched.length})</div>
    ${centerCards}
  </div>

  <div class="footer">
    © 2026 Disaster Supply Locator &nbsp;|&nbsp; Downloaded ${now} &nbsp;|&nbsp;
    This file contains ${enriched.length} relief center(s) for offline reference.
  </div>
</body>
</html>`;

      // 4. Trigger download
      const blob = new Blob([offlineHTML], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `relief-map-offline-${new Date().toISOString().slice(0, 10)}.html`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      progressText.textContent = "✅ Offline map downloaded! Open the .html file anytime without internet.";
      downloadBtn.innerHTML = "<span>✅</span> Downloaded!";
      setTimeout(() => {
        downloadBtn.innerHTML = "<span>📥</span> Download Offline Map";
        downloadBtn.disabled = false;
        progressBox.style.display = "none";
      }, 4000);

    } catch (err) {
      alert("❌ " + err.message);
      downloadBtn.innerHTML = "<span>📥</span> Download Offline Map";
      downloadBtn.disabled = false;
      progressBox.style.display = "none";
    }
  });
}


/* =========================
   RENDER RELIEF CENTER CARDS
========================= */
function renderReliefCenters(reliefCenters, reliefCenterList, emptyReliefState) {
  if (!reliefCenterList || !emptyReliefState) return;
  reliefCenterList.innerHTML = "";

  if (!reliefCenters.length) {
    emptyReliefState.style.display = "block";
    return;
  }

  emptyReliefState.style.display = "none";

  reliefCenters.forEach((center, index) => {
    const card = document.createElement("div");
    card.className = "relief-card";
    card.innerHTML = `
      <div class="relief-icon ${getIconClass(center.reliefType)}">${getIconText(center.reliefType)}</div>
      <div class="relief-content">
        <p class="relief-type">${center.reliefType}</p>
        <p class="org-name">${center.centerName || ""}</p>
        <p class="updated-time">Last Updated: ${center.lastUpdated ? new Date(center.lastUpdated).toLocaleString() : "--"}</p>
        <p class="contact-number">Contact Number: ${center.phoneNumber || "--"}</p>
        <div class="address-box" id="addressBox${index}">
          ${center.address || "Address not available"}
        </div>
      </div>
      <button class="address-btn" data-target="addressBox${index}">Address</button>
    `;
    reliefCenterList.appendChild(card);
  });

  document.querySelectorAll(".address-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const targetBox = document.getElementById(button.getAttribute("data-target"));
      targetBox?.classList.toggle("show");
    });
  });
}

function getIconClass(reliefType = "") {
  const type = reliefType.toLowerCase();
  if (type.includes("medical")) return "medical-icon";
  if (type.includes("food")) return "food-icon";
  return "shelter-icon";
}

function getIconText(reliefType = "") {
  const type = reliefType.toLowerCase();
  if (type.includes("medical")) return "M";
  if (type.includes("food")) return "F";
  return "S";
}
async function detectUserLocation(map) {
  if (!navigator.geolocation) {
    alert("Geolocation not supported");
    return;
  }

  navigator.geolocation.getCurrentPosition(async (position) => {
    const userLat = position.coords.latitude;
    const userLng = position.coords.longitude;

    // 📍 User marker
    map.setView([userLat, userLng], 13);

    L.marker([userLat, userLng])
      .addTo(map)
      .bindPopup("📍 You are here")
      .openPopup();

    // 📡 Fetch centers
    const { ok, data } = await apiCall("/api/relief-centers");
    if (!ok) return;

    const centers = data.data;

    let nearest = null;
    let minDistance = Infinity;

    for (const center of centers) {

      console.log("Processing:", center.address);

      // ⏳ Delay to avoid API block
      await new Promise(r => setTimeout(r, 1000));

      const coords = await getCoordinates(center.address);

      if (!coords) {
        console.log("FAILED:", center.address);
        continue;
      }

      const dist = calculateDistance(
        userLat,
        userLng,
        coords.lat,
        coords.lng
      );

      // 📍 Show all centers
      L.marker([coords.lat, coords.lng])
        .addTo(map)
        .bindPopup(`
  🏕️ <b>${center.centerName}</b><br>
  <button onclick="openDirections(${coords.lat}, ${coords.lng})"
    style="margin-top:6px;padding:6px 10px;border:none;border-radius:6px;background:#1e88e5;color:white;cursor:pointer;">
    🚗 Get Directions
  </button>
`);

      if (dist < minDistance) {
        minDistance = dist;
        nearest = { ...center, ...coords };
      }
    }

    // 🔥 Highlight nearest
    if (nearest) {
      L.circleMarker([nearest.lat, nearest.lng], {
        color: "red",
        radius: 10
      })
        .addTo(map)
        .bindPopup(`
  🔥 <b>Nearest: ${nearest.centerName}</b><br>
  <button onclick="openDirections(${nearest.lat}, ${nearest.lng})"
    style="margin-top:6px;padding:6px 10px;border:none;border-radius:6px;background:#e53935;color:white;cursor:pointer;">
    🚗 Go Now
  </button>
`)
        .openPopup();

      map.setView([nearest.lat, nearest.lng], 14);
    }

  });
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getCoordinates(address) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`
  );
  const data = await res.json();

  if (!data.length) return null;

  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon)
  };
}

function openDirections(lat, lng) {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  window.open(url, "_blank");
}

