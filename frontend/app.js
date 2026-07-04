// ============================================================================
// TransportFlow frontend (vanilla JS) — talks to the Flask backend in ../backend
// ============================================================================
const API_BASE = "http://localhost:5000/api"; // change if you deploy the backend elsewhere

const STATUSES = ["Pending","Driver Assigned","Goods Loaded","In Transit","Delivered","Payment Received"];
const state = { view: "dashboard", bookings: [], drivers: [], clients: [], dashboard: null };

const fmt = n => new Intl.NumberFormat("en-IN").format(n || 0);
const comm = b => b.commission_type === "percent" ? Math.round((b.agreed_rate * b.commission_value) / 100) : (Number(b.commission_value) || 0);
const dpay = b => (Number(b.agreed_rate) || 0) - comm(b);
const todayISO = () => new Date().toISOString().split("T")[0];

function statusColor(s){
  const map = {
    "Pending":            {background:"rgba(255,183,3,.14)",  color:"#ffb703", glow:"rgba(255,183,3,.35)"},
    "Driver Assigned":    {background:"rgba(59,130,246,.14)", color:"#60a5fa", glow:"rgba(59,130,246,.35)"},
    "Goods Loaded":       {background:"rgba(167,139,250,.14)",color:"#a78bfa", glow:"rgba(167,139,250,.35)"},
    "In Transit":         {background:"rgba(251,133,0,.16)",  color:"#fb8500", glow:"rgba(251,133,0,.35)"},
    "Delivered":          {background:"rgba(6,214,160,.14)",  color:"#06d6a0", glow:"rgba(6,214,160,.35)"},
    "Payment Received":   {background:"rgba(6,214,160,.22)",  color:"#06d6a0", glow:"rgba(6,214,160,.5)"},
  };
  return map[s] || {background:"rgba(137,147,164,.14)", color:"#8993a4", glow:"transparent"};
}
function statusDot(s){
  const sc = statusColor(s);
  return `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${sc.color};box-shadow:0 0 6px ${sc.glow};margin-right:2px;"></span>`;
}

// ---------------------------------------------------------------------------
// Toast + confirm
// ---------------------------------------------------------------------------
function notify(msg, type = "success"){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast" + (type === "error" ? " error" : "");
  t.hidden = false;
  clearTimeout(notify._timer);
  notify._timer = setTimeout(() => { t.hidden = true; }, 3000);
}

function confirmDialog(msg, onYes){
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
    <div class="modal-backdrop" id="cfmBackdrop">
      <div class="modal-box" style="max-width:360px;text-align:center;padding:24px;">
        <div style="font-weight:700;margin-bottom:14px;">${msg}</div>
        <div class="form-actions">
          <button class="btn btn-outline" id="cfmNo" style="flex:1;">Cancel</button>
          <button class="btn" id="cfmYes" style="flex:1;background:var(--danger);">Delete</button>
        </div>
      </div>
    </div>`;
  document.getElementById("cfmBackdrop").onclick = e => { if (e.target.id === "cfmBackdrop") closeModal(); };
  document.getElementById("cfmNo").onclick = closeModal;
  document.getElementById("cfmYes").onclick = () => { closeModal(); onYes(); };
}

function closeModal(){ document.getElementById("modalRoot").innerHTML = ""; }

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function api(path, opts = {}){
  const res = await fetch(API_BASE + path, opts);
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok || data.success === false){
    throw new Error(data.message || "Something went wrong");
  }
  return data;
}

// ---------------------------------------------------------------------------
// PIN Login
// ---------------------------------------------------------------------------
let pinBuffer = "";
function initLogin(){
  const dotsEl = document.getElementById("pinDots");
  dotsEl.innerHTML = "";
  for (let i = 0; i < 4; i++){
    const s = document.createElement("span");
    dotsEl.appendChild(s);
  }
  const padEl = document.getElementById("pinPad");
  padEl.innerHTML = "";
  ["1","2","3","4","5","6","7","8","9","","0","del"].forEach(k => {
    const b = document.createElement("button");
    if (k === "") { b.style.visibility = "hidden"; }
    else if (k === "del") { b.innerHTML = "⌫"; b.onclick = () => pinPress("del"); }
    else { b.textContent = k; b.onclick = () => pinPress(k); }
    padEl.appendChild(b);
  });
}

function pinPress(k){
  const err = document.getElementById("loginError");
  err.hidden = true;
  if (k === "del") pinBuffer = pinBuffer.slice(0, -1);
  else if (pinBuffer.length < 4) pinBuffer += k;

  document.querySelectorAll("#pinDots span").forEach((s, i) => {
    s.classList.toggle("filled", i < pinBuffer.length);
  });

  if (pinBuffer.length === 4){
    api("/login", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({pin: pinBuffer}),
    }).then(() => {
      document.getElementById("loginScreen").hidden = true;
      document.getElementById("appShell").hidden = false;
      boot();
    }).catch(() => {
      err.hidden = false;
      pinBuffer = "";
      document.querySelectorAll("#pinDots span").forEach(s => s.classList.remove("filled"));
    });
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function setView(view){
  state.view = view;
  document.querySelectorAll(".sl, .bb").forEach(el => {
    el.classList.toggle("active", el.dataset.view === view);
  });
  document.getElementById("topbarTitle").textContent = view.charAt(0).toUpperCase() + view.slice(1);
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarOverlay").hidden = true;
  render();
}

document.querySelectorAll(".sl[data-view], .bb[data-view]").forEach(el => {
  el.addEventListener("click", () => setView(el.dataset.view));
});
document.getElementById("menuBtn").addEventListener("click", () => {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebarOverlay").hidden = false;
});
document.getElementById("sidebarOverlay").addEventListener("click", () => {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarOverlay").hidden = true;
});
document.getElementById("logoutBtn").addEventListener("click", () => {
  document.getElementById("appShell").hidden = true;
  document.getElementById("loginScreen").hidden = false;
  pinBuffer = "";
  initLogin();
});

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
async function loadAll(){
  const [bookings, drivers, clients, dashboard] = await Promise.all([
    api("/bookings"), api("/drivers"), api("/clients"), api("/dashboard"),
  ]);
  state.bookings = bookings; state.drivers = drivers; state.clients = clients; state.dashboard = dashboard;
  updateBadges();
}

function updateBadges(){
  const badge = state.bookings.filter(b =>
    (b.status === "Delivered" && !b.payment_received) || (b.payment_received && !b.driver_paid)
  ).length;
  const pb = document.getElementById("paymentsBadge"), tb = document.getElementById("topbarBadge");
  [pb, tb].forEach(el => { el.textContent = badge; el.hidden = badge === 0; });
}

async function boot(){
  try { await loadAll(); } catch(e){ notify(e.message, "error"); }
  setView("dashboard");
}

// ---------------------------------------------------------------------------
// Render router
// ---------------------------------------------------------------------------
function render(){
  const main = document.getElementById("mainContent");
  if (state.view === "dashboard") main.innerHTML = renderDashboard();
  else if (state.view === "bookings") { main.innerHTML = renderBookings(); wireBookingsList(); }
  else if (state.view === "drivers") { main.innerHTML = renderDrivers(); wireDriversList(); }
  else if (state.view === "clients") { main.innerHTML = renderClients(); wireClientsList(); }
  else if (state.view === "payments") { main.innerHTML = renderPayments(); wirePayments(); }
  else if (state.view === "reports") main.innerHTML = renderReports();
  if (state.view === "dashboard") wireDashboard();
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function renderDashboard(){
  const d = state.dashboard || {};
  const recent = state.bookings.slice(0, 5);
  return `
    <div class="grid-3">
      <div class="stat-card"><div class="stat-num" data-count="${d.total_bookings ?? 0}" data-prefix="">0</div><div class="stat-label">Total Bookings</div></div>
      <div class="stat-card"><div class="stat-num" data-count="${d.total_revenue ?? 0}" data-prefix="₹">₹0</div><div class="stat-label">Total Revenue</div></div>
      <div class="stat-card"><div class="stat-num" data-count="${d.total_commission ?? 0}" data-prefix="₹">₹0</div><div class="stat-label">Commission Earned</div></div>
    </div>
    <div class="card" style="margin-top:16px;">
      <div class="section-title">Recent Bookings</div>
      ${recent.length ? recent.map(rowBooking).join("") : emptyState("No bookings yet")}
      <button class="btn" id="newBookingFromDash" style="margin-top:12px;width:100%;justify-content:center;"><i class="fa-solid fa-plus"></i> New Booking</button>
    </div>`;
}
function animateStatNumbers(){
  document.querySelectorAll(".stat-num[data-count]").forEach(el => {
    const target = Number(el.dataset.count) || 0;
    const prefix = el.dataset.prefix || "";
    const duration = 700;
    const start = performance.now();
    function tick(now){
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      el.textContent = prefix + fmt(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}
function wireDashboard(){
  document.getElementById("newBookingFromDash")?.addEventListener("click", () => openBookingForm(null));
  main_wireRowClicks();
  animateStatNumbers();
}
function main_wireRowClicks(){
  document.querySelectorAll("[data-open-booking]").forEach(el => {
    el.addEventListener("click", () => openBookingDetail(el.dataset.openBooking));
  });
}

function rowBooking(b){
  const sc = statusColor(b.status);
  return `
    <div class="list-row" data-open-booking="${b.id}" style="cursor:pointer;">
      <div class="avatar">${(b.client_name||"?")[0]}</div>
      <div style="flex:1;min-width:0;">
        <div class="ticket-bilti">${b.bilti_no}</div>
        <div class="ticket-route"><i class="fa-solid fa-location-arrow"></i> ${b.pickup_location} → ${b.drop_location}</div>
      </div>
      <span class="badge" style="background:${sc.background};color:${sc.color};">${statusDot(b.status)}${b.status}</span>
    </div>`;
}
function emptyState(msg){ return `<div class="empty-state">${msg}</div>`; }

// ---------------------------------------------------------------------------
// Bookings list
// ---------------------------------------------------------------------------
function renderBookings(){
  return `
    <div class="searchbar"><i class="fa-solid fa-magnifying-glass"></i><input id="bookingSearch" placeholder="Search bilti no, client, route..."></div>
    <button class="btn" id="newBookingBtn" style="width:100%;justify-content:center;margin-bottom:14px;"><i class="fa-solid fa-plus"></i> New Booking</button>
    <div id="bookingsListWrap">${bookingsListHTML(state.bookings)}</div>`;
}
function bookingsListHTML(list){
  if (!list.length) return emptyState("No bookings found");
  return list.map(b => {
    const sc = statusColor(b.status);
    return `
    <div class="ticket">
      <div class="ticket-main" data-open-booking="${b.id}">
        <div class="avatar">${(b.client_name||"?")[0]}</div>
        <div class="ticket-body">
          <div class="ticket-bilti">${b.bilti_no}</div>
          <div style="font-size:12.5px;color:var(--text);margin-top:1px;">${b.client_name || "—"}</div>
          <div class="ticket-route"><i class="fa-solid fa-location-arrow"></i> ${b.pickup_location} → ${b.drop_location}</div>
        </div>
      </div>
      <div class="ticket-divider"></div>
      <div class="ticket-stub">
        <span class="badge" style="background:${sc.background};color:${sc.color};">${statusDot(b.status)}${b.status}</span>
        <div class="amt">₹${fmt(b.agreed_rate)}</div>
      </div>
      <div class="ticket-actions">
        <button class="icon-action" data-edit-booking="${b.id}"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-action danger" data-del-booking="${b.id}"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`;
  }).join("");
}
function wireBookingsList(){
  document.getElementById("newBookingBtn").addEventListener("click", () => openBookingForm(null));
  document.getElementById("bookingSearch").addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    const filtered = state.bookings.filter(b =>
      (b.bilti_no||"").toLowerCase().includes(q) ||
      (b.client_name||"").toLowerCase().includes(q) ||
      (b.pickup_location||"").toLowerCase().includes(q) ||
      (b.drop_location||"").toLowerCase().includes(q)
    );
    document.getElementById("bookingsListWrap").innerHTML = bookingsListHTML(filtered);
    wireRowActions();
  });
  wireRowActions();
  main_wireRowClicks();
}
function wireRowActions(){
  document.querySelectorAll("[data-edit-booking]").forEach(el =>
    el.addEventListener("click", () => openBookingForm(state.bookings.find(b => b.id == el.dataset.editBooking))));
  document.querySelectorAll("[data-del-booking]").forEach(el =>
    el.addEventListener("click", () => confirmDialog("Delete this booking?", () => deleteBooking(el.dataset.delBooking))));
  document.querySelectorAll("[data-open-booking]").forEach(el =>
    el.addEventListener("click", () => openBookingDetail(el.dataset.openBooking)));
}

async function deleteBooking(id){
  try { await api(`/bookings/${id}`, {method:"DELETE"}); await loadAll(); render(); notify("Booking deleted!"); }
  catch(e){ notify(e.message, "error"); }
}

function openBookingDetail(id){
  const b = state.bookings.find(x => x.id == id);
  if (!b) return;
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
    <div class="modal-backdrop" id="detailBackdrop">
      <div class="modal-box">
        <div class="modal-head"><span class="fd" style="font-weight:700;font-size:17px;">${b.bilti_no}</span>
          <button class="icon-btn" id="closeDetail"><i class="fa-solid fa-xmark"></i></button></div>
        <div class="modal-body">
          ${b.goods_image_url ? `<img src="${b.goods_image_url}" class="image-preview" alt="Goods photo">` : ""}
          <div class="field"><label>Client</label><div>${b.client_name || "—"} (${b.client_company || ""})</div></div>
          <div class="field"><label>Driver</label><div>${b.driver_name || "Not assigned"}</div></div>
          <div class="field"><label>Route</label><div>${b.pickup_location} → ${b.drop_location}</div></div>
          <div class="field"><label>Goods</label><div>${b.goods_description || "—"} · ${b.weight || "—"}</div></div>
          <div class="field"><label>Agreed Rate</label><div>₹${fmt(b.agreed_rate)}</div></div>
          <div class="field"><label>Commission</label><div>₹${fmt(comm(b))} (driver gets ₹${fmt(dpay(b))})</div></div>
          <div class="field"><label>Status</label><div>${b.status}</div></div>
          <div class="form-actions">
            <button class="btn btn-outline" id="advanceStatusBtn" style="flex:1;">Advance Status</button>
            <button class="btn" id="editFromDetail" style="flex:1;">Edit</button>
          </div>
        </div>
      </div>
    </div>`;
  document.getElementById("detailBackdrop").onclick = e => { if (e.target.id === "detailBackdrop") closeModal(); };
  document.getElementById("closeDetail").onclick = closeModal;
  document.getElementById("editFromDetail").onclick = () => openBookingForm(b);
  document.getElementById("advanceStatusBtn").onclick = async () => {
    try { await api(`/bookings/${b.id}/status`, {method:"PATCH"}); await loadAll(); closeModal(); render(); notify("Status updated!"); }
    catch(e){ notify(e.message, "error"); }
  };
}

// ---------------------------------------------------------------------------
// Booking Form (the multipart -> Flask -> Cloudinary -> MySQL -> ack flow)
// ---------------------------------------------------------------------------
function openBookingForm(booking){
  const root = document.getElementById("modalRoot");
  const clientOptions = state.clients.map(c => `<option value="${c.id}" ${booking?.client_id==c.id?"selected":""}>${c.name} (${c.company||""})</option>`).join("");
  const driverOptions = `<option value="">Not assigned</option>` + state.drivers.map(d => `<option value="${d.id}" ${booking?.driver_id==d.id?"selected":""}>${d.name} — ${d.truck_number||""}</option>`).join("");

  root.innerHTML = `
    <div class="modal-backdrop" id="bkBackdrop">
      <div class="modal-box">
        <div class="modal-head"><span class="fd" style="font-weight:700;font-size:17px;">${booking ? "Edit Booking" : "New Booking"}</span>
          <button class="icon-btn" id="bkClose"><i class="fa-solid fa-xmark"></i></button></div>
        <div class="modal-body">
          <form id="bookingForm">
            <div class="field"><label>Client *</label><select name="client_id" required><option value="">Select client</option>${clientOptions}</select></div>
            <div class="field"><label>Driver</label><select name="driver_id">${driverOptions}</select></div>
            <div class="grid-2">
              <div class="field"><label>Pickup Location *</label><input name="pickup_location" required value="${booking?.pickup_location||""}"></div>
              <div class="field"><label>Drop Location *</label><input name="drop_location" required value="${booking?.drop_location||""}"></div>
            </div>
            <div class="grid-2">
              <div class="field"><label>Truck Type</label><input name="truck_type" value="${booking?.truck_type||""}"></div>
              <div class="field"><label>Weight</label><input name="weight" value="${booking?.weight||""}" placeholder="e.g. 12 Ton"></div>
            </div>
            <div class="field"><label>Goods Description</label><input name="goods_description" value="${booking?.goods_description||""}"></div>
            <div class="grid-2">
              <div class="field"><label>Agreed Rate (₹) *</label><input name="agreed_rate" type="number" step="0.01" required value="${booking?.agreed_rate||""}"></div>
              <div class="field"><label>Booking Date *</label><input name="booking_date" type="date" required value="${booking?.booking_date?.slice(0,10) || todayISO()}"></div>
            </div>
            <div class="grid-2">
              <div class="field"><label>Commission Type</label>
                <select name="commission_type">
                  <option value="percent" ${booking?.commission_type==="percent"?"selected":""}>Percent (%)</option>
                  <option value="flat" ${booking?.commission_type==="flat"?"selected":""}>Flat (₹)</option>
                </select>
              </div>
              <div class="field"><label>Commission Value</label><input name="commission_value" type="number" step="0.01" value="${booking?.commission_value||0}"></div>
            </div>
            <div class="field"><label>Notes</label><textarea name="notes" rows="2">${booking?.notes||""}</textarea></div>

            <div class="field">
              <label>Goods Photo (uploads to Cloudinary)</label>
              <div class="image-drop" id="imageDrop">
                ${booking?.goods_image_url ? `<img src="${booking.goods_image_url}" class="image-preview" id="imgPreview">` : `<div id="imgPreviewText"><i class="fa-solid fa-image"></i> Click to choose a photo</div>`}
              </div>
              <input type="file" id="goodsImageInput" name="goods_image" accept="image/png,image/jpeg,image/webp" hidden>
              <div class="upload-progress" id="uploadProgressWrap" hidden><div class="upload-progress-bar" id="uploadProgressBar"></div></div>
            </div>

            <div class="form-actions">
              <button type="button" class="btn btn-outline" id="bkCancel" style="flex:1;">Cancel</button>
              <button type="submit" class="btn" id="bkSubmit" style="flex:1;">${booking ? "Save Changes" : "Create Booking"}</button>
            </div>
          </form>
        </div>
      </div>
    </div>`;

  document.getElementById("bkBackdrop").onclick = e => { if (e.target.id === "bkBackdrop") closeModal(); };
  document.getElementById("bkClose").onclick = closeModal;
  document.getElementById("bkCancel").onclick = closeModal;

  const dropEl = document.getElementById("imageDrop");
  const fileInput = document.getElementById("goodsImageInput");
  dropEl.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const f = fileInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      dropEl.innerHTML = `<img src="${reader.result}" class="image-preview" id="imgPreview">`;
    };
    reader.readAsDataURL(f);
  });

  document.getElementById("bookingForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = document.getElementById("bkSubmit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";

    // Step 1: build multipart form-data (fields + optional image file)
    const fd = new FormData(form);

    try {
      // Step 2 (validation) & 3 (cloudinary upload) & 4 (mysql insert) all happen server-side in Flask.
      // Step 5: we read the acknowledgement below.
      let result;
      if (booking) result = await apiUpload(`/bookings/${booking.id}`, fd, "PUT");
      else result = await apiUpload("/bookings", fd, "POST");

      await loadAll();
      closeModal();
      render();
      notify(result.message || "Saved!");
    } catch(err){
      notify(err.message, "error");
      submitBtn.disabled = false;
      submitBtn.textContent = booking ? "Save Changes" : "Create Booking";
    }
  });
}

// multipart upload helper (fetch doesn't set Content-Type manually for FormData — browser handles the boundary)
async function apiUpload(path, formData, method = "POST"){
  const res = await fetch(API_BASE + path, { method, body: formData });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok || data.success === false) throw new Error(data.message || "Upload failed");
  return data;
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------
function renderDrivers(){
  return `
    <button class="btn" id="newDriverBtn" style="width:100%;justify-content:center;margin-bottom:14px;"><i class="fa-solid fa-plus"></i> Add Driver</button>
    <div class="card">${state.drivers.length ? state.drivers.map(rowDriver).join("") : emptyState("No drivers yet")}</div>`;
}
function rowDriver(d){
  const trips = state.bookings.filter(b => b.driver_id == d.id).length;
  return `
    <div class="list-row">
      <div class="avatar">${(d.name||"?")[0]}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:14px;">${d.name}</div>
        <div style="font-size:12px;color:var(--muted);">${d.truck_type||"—"} · ${d.truck_number||"—"} · ${d.phone} · ${trips} trips</div>
      </div>
      <button class="icon-action" data-edit-driver="${d.id}"><i class="fa-solid fa-pen"></i></button>
      <button class="icon-action danger" data-del-driver="${d.id}"><i class="fa-solid fa-trash"></i></button>
    </div>`;
}
function wireDriversList(){
  document.getElementById("newDriverBtn").addEventListener("click", () => openDriverForm(null));
  document.querySelectorAll("[data-edit-driver]").forEach(el =>
    el.addEventListener("click", () => openDriverForm(state.drivers.find(d => d.id == el.dataset.editDriver))));
  document.querySelectorAll("[data-del-driver]").forEach(el =>
    el.addEventListener("click", () => confirmDialog("Delete this driver?", async () => {
      try { await api(`/drivers/${el.dataset.delDriver}`, {method:"DELETE"}); await loadAll(); render(); notify("Driver deleted!"); }
      catch(e){ notify(e.message, "error"); }
    })));
}
function openDriverForm(driver){
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
    <div class="modal-backdrop" id="drBackdrop">
      <div class="modal-box">
        <div class="modal-head"><span class="fd" style="font-weight:700;font-size:17px;">${driver ? "Edit Driver" : "Add Driver"}</span>
          <button class="icon-btn" id="drClose"><i class="fa-solid fa-xmark"></i></button></div>
        <div class="modal-body">
          <form id="driverForm">
            <div class="field"><label>Name *</label><input name="name" required value="${driver?.name||""}"></div>
            <div class="field"><label>Phone *</label><input name="phone" required value="${driver?.phone||""}"></div>
            <div class="grid-2">
              <div class="field"><label>Truck Type</label><input name="truckType" value="${driver?.truck_type||""}"></div>
              <div class="field"><label>Truck Number</label><input name="truckNumber" value="${driver?.truck_number||""}"></div>
            </div>
            <div class="grid-2">
              <div class="field"><label>Bank</label><input name="bank" value="${driver?.bank_name||""}"></div>
              <div class="field"><label>Account No.</label><input name="bankAccount" value="${driver?.bank_account||""}"></div>
            </div>
            <div class="grid-2">
              <div class="field"><label>UPI</label><input name="upi" value="${driver?.upi||""}"></div>
              <div class="field"><label>IFSC</label><input name="ifsc" value="${driver?.ifsc||""}"></div>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-outline" id="drCancel" style="flex:1;">Cancel</button>
              <button type="submit" class="btn" style="flex:1;">${driver ? "Save Changes" : "Add Driver"}</button>
            </div>
          </form>
        </div>
      </div>
    </div>`;
  document.getElementById("drBackdrop").onclick = e => { if (e.target.id === "drBackdrop") closeModal(); };
  document.getElementById("drClose").onclick = closeModal;
  document.getElementById("drCancel").onclick = closeModal;
  document.getElementById("driverForm").addEventListener("submit", async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      const result = driver
        ? await api(`/drivers/${driver.id}`, {method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)})
        : await api("/drivers", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)});
      await loadAll(); closeModal(); render(); notify(result.message);
    } catch(err){ notify(err.message, "error"); }
  });
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------
function renderClients(){
  return `
    <button class="btn" id="newClientBtn" style="width:100%;justify-content:center;margin-bottom:14px;"><i class="fa-solid fa-plus"></i> Add Client</button>
    <div class="card">${state.clients.length ? state.clients.map(rowClient).join("") : emptyState("No clients yet")}</div>`;
}
function rowClient(c){
  const trips = state.bookings.filter(b => b.client_id == c.id).length;
  return `
    <div class="list-row">
      <div class="avatar">${(c.company||c.name||"?")[0]}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:14px;">${c.company || c.name}</div>
        <div style="font-size:12px;color:var(--muted);">${c.city||"—"} · ${c.phone} · ${trips} trips</div>
      </div>
      <button class="icon-action" data-edit-client="${c.id}"><i class="fa-solid fa-pen"></i></button>
      <button class="icon-action danger" data-del-client="${c.id}"><i class="fa-solid fa-trash"></i></button>
    </div>`;
}
function wireClientsList(){
  document.getElementById("newClientBtn").addEventListener("click", () => openClientForm(null));
  document.querySelectorAll("[data-edit-client]").forEach(el =>
    el.addEventListener("click", () => openClientForm(state.clients.find(c => c.id == el.dataset.editClient))));
  document.querySelectorAll("[data-del-client]").forEach(el =>
    el.addEventListener("click", () => confirmDialog("Delete this client?", async () => {
      try { await api(`/clients/${el.dataset.delClient}`, {method:"DELETE"}); await loadAll(); render(); notify("Client deleted!"); }
      catch(e){ notify(e.message, "error"); }
    })));
}
function openClientForm(client){
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
    <div class="modal-backdrop" id="clBackdrop">
      <div class="modal-box">
        <div class="modal-head"><span class="fd" style="font-weight:700;font-size:17px;">${client ? "Edit Client" : "Add Client"}</span>
          <button class="icon-btn" id="clClose"><i class="fa-solid fa-xmark"></i></button></div>
        <div class="modal-body">
          <form id="clientForm">
            <div class="field"><label>Contact Name *</label><input name="name" required value="${client?.name||""}"></div>
            <div class="field"><label>Company</label><input name="company" value="${client?.company||""}"></div>
            <div class="field"><label>Phone *</label><input name="phone" required value="${client?.phone||""}"></div>
            <div class="field"><label>City</label><input name="city" value="${client?.city||""}"></div>
            <div class="field"><label>Address</label><textarea name="address" rows="2">${client?.address||""}</textarea></div>
            <div class="form-actions">
              <button type="button" class="btn btn-outline" id="clCancel" style="flex:1;">Cancel</button>
              <button type="submit" class="btn" style="flex:1;">${client ? "Save Changes" : "Add Client"}</button>
            </div>
          </form>
        </div>
      </div>
    </div>`;
  document.getElementById("clBackdrop").onclick = e => { if (e.target.id === "clBackdrop") closeModal(); };
  document.getElementById("clClose").onclick = closeModal;
  document.getElementById("clCancel").onclick = closeModal;
  document.getElementById("clientForm").addEventListener("submit", async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try {
      const result = client
        ? await api(`/clients/${client.id}`, {method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)})
        : await api("/clients", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)});
      await loadAll(); closeModal(); render(); notify(result.message);
    } catch(err){ notify(err.message, "error"); }
  });
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
function renderPayments(){
  const pendingClient = state.bookings.filter(b => b.status === "Delivered" && !b.payment_received);
  const pendingDriver = state.bookings.filter(b => b.payment_received && !b.driver_paid);
  return `
    <div class="card"><div class="section-title">Awaiting Client Payment (${pendingClient.length})</div>
      ${pendingClient.length ? pendingClient.map(b => `
        <div class="list-row">
          <div style="flex:1;"><div style="font-weight:600;font-size:14px;">${b.bilti_no} · ${b.client_name}</div><div style="font-size:12px;color:var(--muted);">₹${fmt(b.agreed_rate)}</div></div>
          <button class="btn btn-sm" data-mark-received="${b.id}">Mark Received</button>
        </div>`).join("") : emptyState("All clear!")}
    </div>
    <div class="card"><div class="section-title">Awaiting Driver Payout (${pendingDriver.length})</div>
      ${pendingDriver.length ? pendingDriver.map(b => `
        <div class="list-row">
          <div style="flex:1;"><div style="font-weight:600;font-size:14px;">${b.bilti_no} · ${b.driver_name||"—"}</div><div style="font-size:12px;color:var(--muted);">Payout ₹${fmt(dpay(b))}</div></div>
          <button class="btn btn-sm" data-mark-driver-paid="${b.id}">Mark Paid</button>
        </div>`).join("") : emptyState("All clear!")}
    </div>`;
}
function wirePayments(){
  document.querySelectorAll("[data-mark-received]").forEach(el => el.addEventListener("click", async () => {
    try {
      await api(`/bookings/${el.dataset.markReceived}/payment`, {method:"PATCH", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({payment_received:true, payment_date: todayISO()})});
      await loadAll(); render(); notify("Payment marked received!");
    } catch(e){ notify(e.message, "error"); }
  }));
  document.querySelectorAll("[data-mark-driver-paid]").forEach(el => el.addEventListener("click", async () => {
    try {
      await api(`/bookings/${el.dataset.markDriverPaid}/payment`, {method:"PATCH", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({driver_paid:true, driver_paid_date: todayISO()})});
      await loadAll(); render(); notify("Driver marked paid!");
    } catch(e){ notify(e.message, "error"); }
  }));
}

// ---------------------------------------------------------------------------
// Reports (simple client-side aggregation, mirrors original Reports view)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Lightweight SVG charts (no external library — keeps the app dependency-free)
// ---------------------------------------------------------------------------
function svgBarChart(items, {width=300, height=190, barColor="#ffb703"}={}){
  if (!items.length) return emptyState("No data yet");
  const max = Math.max(...items.map(i => i.value), 1);
  const padBottom = 28, padTop = 24;
  const plotH = height - padBottom - padTop;
  const slot = width / items.length;
  const barW = Math.min(36, slot * 0.5);
  const bars = items.map((it, i) => {
    const h = Math.max(3, (it.value / max) * plotH);
    const cx = i * slot + slot / 2;
    const x = cx - barW / 2;
    const y = height - padBottom - h;
    return `
      <g style="animation-delay:${i * 80}ms" class="chart-bar-g">
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="6" fill="${barColor}" class="chart-bar"/>
        <text x="${cx.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" class="chart-val">₹${fmt(it.value)}</text>
        <text x="${cx.toFixed(1)}" y="${height - 8}" text-anchor="middle" class="chart-label">${it.label}</text>
      </g>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg">
    <line x1="0" y1="${height - padBottom}" x2="${width}" y2="${height - padBottom}" class="chart-baseline"/>
    ${bars}
  </svg>`;
}

function svgDonutChart(segments, {size=150, thickness=20}={}){
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const circles = segments.filter(s => s.value > 0).map((s, i) => {
    const frac = s.value / total;
    const dash = frac * circumference;
    const gap = circumference - dash;
    const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${thickness}"
      stroke-dasharray="${dash.toFixed(1)} ${gap.toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}"
      stroke-linecap="butt" class="donut-seg" style="animation-delay:${i * 90}ms"/>`;
    offset += dash;
    return el;
  }).join("");
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <g transform="rotate(-90 ${cx} ${cy})">${circles}</g>
    <text x="${cx}" y="${cy - 3}" text-anchor="middle" class="donut-total">${total}</text>
    <text x="${cx}" y="${cy + 15}" text-anchor="middle" class="donut-total-label">Bookings</text>
  </svg>`;
}

function renderReports(){
  const byClient = {};
  state.bookings.forEach(b => {
    const key = b.client_company || b.client_name || "Unknown";
    byClient[key] = byClient[key] || {rev:0, trips:0};
    byClient[key].rev += Number(b.agreed_rate)||0;
    byClient[key].trips += 1;
  });
  const topClients = Object.entries(byClient).sort((a,b)=>b[1].rev-a[1].rev).slice(0,5);
  const maxRev = topClients[0]?.[1].rev || 1;

  // Revenue by month, for the bar chart
  const monthMap = {};
  state.bookings.forEach(b => {
    if (!b.booking_date) return;
    const d = new Date(b.booking_date);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    monthMap[key] = monthMap[key] || {label: d.toLocaleDateString("en-IN", {month:"short"}), value:0};
    monthMap[key].value += Number(b.agreed_rate) || 0;
  });
  const monthData = Object.keys(monthMap).sort().map(k => monthMap[k]);

  // Status distribution, for the donut chart
  const statusEntries = Object.entries(state.dashboard?.by_status || {}).filter(([,c]) => c > 0);
  const donutSegments = statusEntries.map(([s,c]) => ({value:c, color: statusColor(s).color}));

  return `
    <div class="card">
      <div class="section-title">Revenue Trend</div>
      ${svgBarChart(monthData)}
    </div>
    <div class="card">
      <div class="section-title">Top Clients by Revenue</div>
      ${topClients.length ? topClients.map(([name, v], i) => `
        <div class="list-row">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:14px;">${name}</div>
            <div style="height:6px;background:var(--panel-2);border-radius:999px;margin-top:4px;">
              <div style="height:6px;border-radius:999px;background:${i===0?"var(--amber)":"var(--cargo)"};width:${(v.rev/maxRev*100)}%;box-shadow:0 0 8px ${i===0?"rgba(255,183,3,.5)":"rgba(6,214,160,.4)"};"></div>
            </div>
          </div>
          <div style="text-align:right;"><div style="font-weight:700;font-size:14px;">₹${fmt(v.rev)}</div><div style="font-size:11px;color:var(--muted);">${v.trips} trips</div></div>
        </div>`).join("") : emptyState("No data yet")}
    </div>
    <div class="card">
      <div class="section-title">Bookings by Status</div>
      <div class="chart-row">
        ${donutSegments.length ? svgDonutChart(donutSegments) : emptyState("No data yet")}
        <div class="chart-legend">
          ${statusEntries.map(([s,c]) => `
            <div class="chart-legend-item">
              <span class="chart-legend-dot" style="background:${statusColor(s).color};box-shadow:0 0 6px ${statusColor(s).glow};"></span>
              <span style="flex:1;">${s}</span>
              <strong>${c}</strong>
            </div>`).join("")}
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
initLogin();