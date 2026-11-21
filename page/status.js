// Top status bar: turn / check / connection + opponent presence.
import { THEME } from "./theme.js";

export function renderStatus(hmUI, widgets, layout, state, connected) {
  const { x, y, w, h } = layout.status;
  const g = state.game;
  // Round display: the bar is narrower and sits under the circle edge, so
  // use compact labels and a smaller font to avoid wrapping/clipping.
  const compact = layout.shape === "r";
  let text = "";
  if (g.status === "finished") {
    text = g.result === "draw" ? "Draw" : g.result === state.you.color ? "You win" : "You lose";
  } else if (g.turn === state.you.color) {
    text = g.check ? "Check! Your move" : "Your move";
  } else {
    text = g.check ? "Check! Opp." : compact ? "Opp. turn" : "Opponent's turn";
  }
  const opp = state.opponent.online ? "●" : "○";
  widgets.push(
    hmUI.createWidget(hmUI.widget.TEXT, {
      x, y, w, h,
      text: `${text}  ${opp} ${state.opponent.name}`,
      text_size: compact ? 18 : 20,
      color: THEME.text,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
    }),
  );
  // Connection dot: green when the poll loop is live, red when offline.
  const dotColor = connected ? THEME.online : THEME.offline;
  widgets.push(
    hmUI.createWidget(hmUI.widget.FILL_RECT, {
      x: x + w - 14, y: y + 8, w: 12, h: 12,
      radius: 6, color: dotColor,
    }),
  );
}
