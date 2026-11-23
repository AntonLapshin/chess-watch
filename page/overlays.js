// Overlays: first-run picker, menu, confirms, promotion, offer, result.
// Every overlay is a full-screen dim + centred panel, built from the same
// widgets as the board (FILL_RECT / TEXT / BUTTON).
import { resultText } from "../shared/protocol.js";
import { THEME } from "./theme.js";

function backdrop(hmUI, widgets, layout, onClose) {
  // Same trap as the board (0.2.2): click_func is silently ignored on
  // FILL_RECT on-device, so tapping outside the panel never closed the
  // overlay. addEventListener(CLICK_DOWN) is the working pattern.
  const bg = hmUI.createWidget(hmUI.widget.FILL_RECT, {
    x: 0, y: 0, w: layout.width, h: layout.height,
    color: THEME.overlay,
  });
  if (onClose) bg.addEventListener(hmUI.event.CLICK_DOWN, onClose);
  widgets.push(bg);
}

function panel(hmUI, widgets, layout, h) {
  const w = Math.min(layout.width - 40, 320);
  const x = Math.floor((layout.width - w) / 2);
  const y = Math.floor((layout.height - h) / 2);
  widgets.push(
    hmUI.createWidget(hmUI.widget.FILL_RECT, {
      x, y, w, h, radius: 16, color: 0x1c2530,
    }),
  );
  return { x, y, w, h };
}

function text(hmUI, widgets, x, y, w, h, str, size, color) {
  widgets.push(
    hmUI.createWidget(hmUI.widget.TEXT, {
      x, y, w, h, text: str, text_size: size || 20,
      color: color || THEME.text,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
    }),
  );
}

function button(hmUI, widgets, x, y, w, h, label, onClick, danger) {
  widgets.push(
    hmUI.createWidget(hmUI.widget.BUTTON, {
      x, y, w, h, text: label, text_size: 20, radius: 10,
      normal_color: danger ? THEME.danger : THEME.button,
      color: THEME.buttonText,
      click_func: onClick,
    }),
  );
}

export function renderPicker(hmUI, widgets, layout, onPick) {
  backdrop(hmUI, widgets, layout);
  const p = panel(hmUI, widgets, layout, 220);
  text(hmUI, widgets, p.x, p.y + 16, p.w, 30, "Chess Watch", 26);
  text(hmUI, widgets, p.x, p.y + 52, p.w, 24, "Which player are you?", 18, THEME.textSecondary);
  button(hmUI, widgets, p.x + 20, p.y + 92, p.w - 40, 48, "Player 1 — White", () => onPick("p1"));
  button(hmUI, widgets, p.x + 20, p.y + 152, p.w - 40, 48, "Player 2 — Black", () => onPick("p2"));
}

export function renderMenu(hmUI, widgets, layout, opts) {
  backdrop(hmUI, widgets, layout, opts.onClose);
  // After the game ends, Offer draw / Take back / Resign are meaningless
  // (the server answers game_over) — only Start over stays, plus the
  // always-available items. Panel height scales with the item count:
  // 64 + 8*40 = 384, the previous fixed height.
  const items = opts.finished
    ? [
        ["Start over", opts.onRestart],
        [opts.hapticsOn ? "Vibrate: on" : "Vibrate: off", opts.onToggleHaptics],
        ["Test link", opts.onTestLink],
        ["Switch player", opts.onSwitchPlayer],
        ["Close", opts.onClose],
      ]
    : [
        ["Offer draw", opts.onOfferDraw],
        ["Take back a move", opts.onTakeback],
        ["Start over", opts.onRestart],
        ["Resign", opts.onResign, true],
        [opts.hapticsOn ? "Vibrate: on" : "Vibrate: off", opts.onToggleHaptics],
        ["Test link", opts.onTestLink],
        ["Switch player", opts.onSwitchPlayer],
        ["Close", opts.onClose],
      ];
  const p = panel(hmUI, widgets, layout, 64 + items.length * 40);
  const bw = p.w - 40;
  let y = p.y + 16;
  text(hmUI, widgets, p.x, y, p.w, 28, "Menu", 22);
  y += 44;
  for (const [label, fn, danger] of items) {
    button(hmUI, widgets, p.x + 20, y, bw, 36, label, fn, danger);
    y += 40;
  }
}

export function renderConfirm(hmUI, widgets, layout, opts) {
  backdrop(hmUI, widgets, layout, opts.onNo);
  const p = panel(hmUI, widgets, layout, 190);
  text(hmUI, widgets, p.x + 10, p.y + 18, p.w - 20, 30, opts.title, 22);
  text(hmUI, widgets, p.x + 10, p.y + 54, p.w - 20, 48, opts.text, 18, THEME.textSecondary);
  button(hmUI, widgets, p.x + 20, p.y + 118, Math.floor((p.w - 60) / 2), 48, "Yes", opts.onYes, opts.danger);
  button(hmUI, widgets, p.x + 40 + Math.floor((p.w - 60) / 2), p.y + 118, Math.floor((p.w - 60) / 2), 48, "No", opts.onNo);
}

export function renderPromotion(hmUI, widgets, layout, onPick, onCancel) {
  backdrop(hmUI, widgets, layout, onCancel);
  const p = panel(hmUI, widgets, layout, 180);
  text(hmUI, widgets, p.x, p.y + 16, p.w, 30, "Promote to", 22);
  const labels = ["Queen", "Rook", "Bishop", "Knight"];
  const pieces = ["q", "r", "b", "n"];
  const bw = Math.floor((p.w - 40 - 3 * 10) / 4);
  pieces.forEach((piece, i) => {
    button(
      hmUI, widgets,
      p.x + 20 + i * (bw + 10), p.y + 66, bw, 56,
      labels[i].slice(0, 1), () => onPick(piece),
    );
  });
  text(hmUI, widgets, p.x, p.y + 132, p.w, 28, "Q  R  B  N", 18, THEME.textSecondary);
}

export function renderOffer(hmUI, widgets, layout, offer, state, opts) {
  backdrop(hmUI, widgets, layout);
  const p = panel(hmUI, widgets, layout, 220);
  const names = { offer_restart: "Start over", offer_takeback: "Take back", offer_draw: "Draw" };
  const title = `${state.opponent.name} offers: ${names[offer.type] || offer.type}`;
  const remaining = Math.max(0, Math.round(offer.expires_at - state.server_time));
  text(hmUI, widgets, p.x + 10, p.y + 16, p.w - 20, 56, title, 20);
  text(hmUI, widgets, p.x, p.y + 76, p.w, 28, `Expires in ${remaining}s`, 18, THEME.textSecondary);
  button(hmUI, widgets, p.x + 20, p.y + 118, Math.floor((p.w - 60) / 2), 48, "Accept", opts.onAccept);
  button(hmUI, widgets, p.x + 40 + Math.floor((p.w - 60) / 2), p.y + 118, Math.floor((p.w - 60) / 2), 48, "Decline", opts.onDecline, true);
}

export function renderResult(hmUI, widgets, layout, state, role, opts) {
  backdrop(hmUI, widgets, layout);
  // One button only: OK dismisses to the board, which stays look-only
  // for as long as the player wants (tapping a square does nothing after
  // the game ends). There is no "Play again" here on purpose — a rematch
  // is Menu → Start over, so the dialog never needs to come back.
  const p = panel(hmUI, widgets, layout, 196);
  text(hmUI, widgets, p.x + 10, p.y + 18, p.w - 20, 34, resultText(state, role), 22);
  const recent = (state.game.recent_moves || []).map((m) => m.san).join(" ");
  text(hmUI, widgets, p.x + 10, p.y + 62, p.w - 20, 56, recent || "No moves played", 16, THEME.textSecondary);
  button(hmUI, widgets, p.x + 20, p.y + 128, p.w - 40, 48, "OK", opts.onOk);
}

// Diagnostics overlay: the durable home of the "Test link" result. Unlike
// the lines on the Connecting screen, this panel is an overlay, so a poll
// failure swapping in the offline board cannot wipe it, and it is reachable
// from Menu at any time — including while the board is showing. Lines are
// kept short (<= ~32 chars) so they fit the round panel at 16 px. The
// lines use a tighter 22 px step (16 px text) so the panel still fits all
// 14 lines of a full online diagnostic on the 450 px Bip 6 display
// (title + lines + buttons = 104 + 14*22 + 48 = 460, capped at 426).
export function renderDiag(hmUI, widgets, layout, lines, opts) {
  backdrop(hmUI, widgets, layout, opts.onClose);
  const h = Math.min(layout.height - 24, 104 + lines.length * 22 + 48);
  const p = panel(hmUI, widgets, layout, h);
  text(hmUI, widgets, p.x, p.y + 14, p.w, 28, opts.busy ? "Testing…" : "Link test", 22);
  lines.forEach((line, i) => {
    text(hmUI, widgets, p.x + 12, p.y + 44 + i * 22, p.w - 24, 22, line, 16, THEME.textSecondary);
  });
  const by = p.y + h - 52;
  const half = Math.floor((p.w - 60) / 2);
  button(hmUI, widgets, p.x + 20, by, half, 40, "Test again", opts.onRetest);
  button(hmUI, widgets, p.x + 40 + half, by, half, 40, "Close", opts.onClose);
}
