import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { _setPageConfig, WatchPage } from "./components/WatchPage.jsx";
import { setDevicePreset, PRESETS } from "./shims/device.js";

globalThis.Page = _setPageConfig;

// Preset from ?device=bip-6|active-3, default Bip 6.
const initialDevice = /[?&]device=active-3/.test(window.location.search)
  ? "active-3"
  : "bip-6";
setDevicePreset(initialDevice);

async function init() {
  await import("../../page/index.js");
  ReactDOM.createRoot(document.getElementById("root")).render(<App />);
}

init();

function App() {
  const [deviceKey, setDeviceKey] = useState(initialDevice);
  const preset = PRESETS[deviceKey];
  const round = preset.shape === "r";

  function switchDevice(key) {
    setDevicePreset(key);
    setDeviceKey(key);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: 20 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {Object.entries(PRESETS).map(([key, p]) => (
          <button
            key={key}
            onClick={() => switchDevice(key)}
            style={{
              padding: "8px 16px", cursor: "pointer",
              background: key === deviceKey ? "#ffc24b" : "#2a3340",
              color: key === deviceKey ? "#111" : "#eee",
              border: "none", borderRadius: 8, fontSize: 15,
            }}
          >
            {p.name} ({p.width}×{p.height})
          </button>
        ))}
        <a href="?player=p1" style={{ color: "#ffc24b" }}>P1 tab</a>
        <a href="?player=p2" style={{ color: "#ffc24b" }}>P2 tab</a>
      </div>
      {/* Round preset: clip the runner's rounded-rect frame to a circle. */}
      <div
        key={deviceKey}
        style={round ? { borderRadius: "50%", overflow: "hidden", lineHeight: 0 } : { lineHeight: 0 }}
      >
        <WatchPage width={preset.width} height={preset.height} />
      </div>
      <div style={{ fontSize: 13, color: "#a9b4c0", maxWidth: 520, textAlign: "center" }}>
        Same page/index.js as the watch. Open a second tab with ?player=p2
        to play both sides. Start with `make web`; /api is proxied to
        CHESS_SERVER_URL from .env.
      </div>
    </div>
  );
}
