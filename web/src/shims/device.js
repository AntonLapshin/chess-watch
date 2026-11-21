// getDeviceInfo() shim for the web harness (plan §10 item 5).
// The runner does not provide getDeviceInfo, so the preset switcher in
// main.jsx sets the active device here; layout.js then computes the same
// physical-pixel layout the watch would.
export const PRESETS = {
  "bip-6": { name: "Bip 6", width: 390, height: 450, screenShape: "square", shape: "s" },
  "active-3": { name: "Active 3 Premium", width: 466, height: 466, screenShape: "round", shape: "r" },
};

let _preset = PRESETS["bip-6"];

export function setDevicePreset(key) {
  if (PRESETS[key]) _preset = PRESETS[key];
  return _preset;
}

export function getDevicePreset() {
  return _preset;
}

export function getDeviceInfo() {
  return {
    width: _preset.width,
    height: _preset.height,
    screenShape: _preset.screenShape,
    deviceName: _preset.name,
  };
}
