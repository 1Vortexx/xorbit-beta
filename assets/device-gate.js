// ── Device gate ──────────────────────────────────────────────────────
// Loaded in the <head> of index.html, app.html and auth.html.
//   • access_settings.deface is true → index.html (the only page that sets
//     data-deface-redirect on this script tag) goes to the decoy page.
//   • access_settings.lockout is true → blocked, whoever it is.
//   • Device has a UUID  → blocked if that UUID is in banned_devices.
//   • Device has no UUID → blocked if access_settings.public_access is false.
// Blocked devices are sent to blocked.html. If Supabase can't be reached
// on page load, the page is replaced with a connection error screen.
(function () {
  var SUPABASE_URL = "https://rujvmtvozorylfzsqppc.supabase.co";
  var SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1anZtdHZvem9yeWxmenNxcHBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc0NjQxNDEsImV4cCI6MjA3MzA0MDE0MX0.b7jJz3Se_oXXDwwd0dWQ8-rEvhY0aU4JDHQVioE39iY";
  var UUID_KEY = "xorbit_device_uuid";
  var DEFACE_REDIRECT =
    document.currentScript && document.currentScript.getAttribute("data-deface-redirect");
  var TIMEOUT_MS = 6000;

  function readUUID() {
    try {
      var uuid = localStorage.getItem(UUID_KEY);
      // auth.html only treats 6-character codes as valid
      return uuid && uuid.length === 6 ? uuid : null;
    } catch (e) {
      return null;
    }
  }

  function query(path) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    return fetch(SUPABASE_URL + "/rest/v1/" + path, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + SUPABASE_ANON_KEY,
      },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Device gate query failed: " + res.status);
        return res.json();
      })
      .finally(function () { clearTimeout(timer); });
  }

  function block(title, name, reason) {
    try {
      sessionStorage.setItem("ban_title", title);
      sessionStorage.setItem("banned_username", name);
      sessionStorage.setItem("ban_reason", reason);
    } catch (e) {}
    // auth.html runs inside app.html's iframe — send the whole tab
    var target = window;
    try { if (window.top.location.href) target = window.top; } catch (e) {}
    target.location.replace("blocked.html");
  }

  // Replaces the page with a "could not connect" screen
  function showConnectionError() {
    try { window.stop(); } catch (e) {}
    document.open();
    document.write(
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
      "<title>Connection Error - X-ORBIT</title></head>" +
      '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;">' +
      '<div style="text-align:center;max-width:480px;padding:0 24px;">' +
      '<div style="font-size:10px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.18);margin-bottom:16px;">Internal Server Error</div>' +
      '<h1 style="font-size:28px;font-weight:700;letter-spacing:-0.03em;color:#fff;margin:0 0 12px;">Could not connect to the server</h1>' +
      '<p style="font-size:13.5px;color:rgba(255,255,255,0.4);line-height:1.7;margin:0 0 32px;">X-ORBIT could not connect to the server due to an internal server error. Please try again.</p>' +
      '<button onclick="location.reload()" style="font:inherit;font-size:13px;font-weight:600;color:#000;background:#fff;border:none;border-radius:6px;padding:10px 22px;cursor:pointer;">Try Again</button>' +
      "</div></body></html>"
    );
    document.close();
  }

  function getSettings() {
    return query("access_settings?select=public_access,lockout,deface&id=eq.1&limit=1").then(
      function (rows) { return rows[0] || {}; }
    );
  }

  function getDeviceBan(uuid) {
    return query(
      "banned_devices?select=device_uuid,reason&limit=1&device_uuid=eq." +
        encodeURIComponent(uuid)
    ).then(function (rows) { return rows[0] || null; });
  }

  function blockLockout() {
    block(
      "X-ORBIT Unavailable",
      "Site lockout",
      "X-ORBIT has been disabled by an administrator. Please check back later."
    );
  }

  function blockDevice(uuid, reason) {
    block(
      "Device Banned",
      "Device " + uuid,
      reason ||
        "This device has been banned from X-ORBIT. Please contact support for more information."
    );
  }

  // The checks below resolve true if the page must not load (a redirect has
  // started), and reject if Supabase could not be reached.

  // Full check, run on page load
  function check() {
    var uuid = readUUID();
    return Promise.all([getSettings(), uuid ? getDeviceBan(uuid) : null]).then(
      function (results) {
        var settings = results[0];
        var ban = results[1];
        if (DEFACE_REDIRECT && settings.deface === true) {
          window.location.replace(DEFACE_REDIRECT);
        } else if (settings.lockout === true) {
          blockLockout();
        } else if (ban) {
          blockDevice(uuid, ban.reason);
        } else if (!uuid && settings.public_access === false) {
          block("Access Closed", "Unregistered device", "X-ORBIT is not open to new devices right now.");
        } else {
          return false;
        }
        return true;
      }
    );
  }

  function checkDeviceBan() {
    var uuid = readUUID();
    if (!uuid) return Promise.resolve(false);
    return getDeviceBan(uuid).then(function (ban) {
      if (!ban) return false;
      blockDevice(uuid, ban.reason);
      return true;
    });
  }

  function checkLockout() {
    return getSettings().then(function (settings) {
      if (settings.lockout !== true) return false;
      blockLockout();
      return true;
    });
  }

  // For re-checks while the page is open: a failed lookup is ignored so a
  // network blip doesn't kick out an active session.
  function ignoreFailure(checkFn) {
    return function () {
      return checkFn().catch(function (e) {
        console.error("Device gate re-check failed:", e);
        return false;
      });
    };
  }

  // Keep the page hidden until the first check comes back.
  // `ready` resolves true only if the page is allowed to load.
  var root = document.documentElement;
  root.style.visibility = "hidden";
  var ready = check().then(
    function (blocked) {
      if (!blocked) root.style.visibility = "";
      return !blocked;
    },
    function (e) {
      console.error("Device gate check failed:", e);
      showConnectionError();
      return false;
    }
  );

  window.xorbitDeviceGate = {
    ready: ready,
    recheckDeviceBan: ignoreFailure(checkDeviceBan),
    recheckLockout: ignoreFailure(checkLockout),
  };
})();
