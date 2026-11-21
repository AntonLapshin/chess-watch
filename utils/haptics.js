// Optional vibration wrapper. Vibrator availability is a plan §10 item 7
// open question; every call is guarded so a missing API is a no-op.
import { Vibrator } from "@zos/sensor";

let _vib = null;
let _enabled = true;

export function setHapticsEnabled(enabled) {
  _enabled = !!enabled;
}

function getVibrator() {
  if (_vib) return _vib;
  try {
    _vib = new Vibrator();
  } catch (_) {
    _vib = { start() {} };
  }
  return _vib;
}

export function vibrate() {
  if (!_enabled) return;
  try {
    getVibrator().start();
  } catch (_) {}
}
