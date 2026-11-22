// Board: 64 FILL_RECT cells (each clickable), pieces as IMG, dots,
// selection frame, last-move tint, check tint.
//
// Zepp tap rule — every widget that covers a square must carry the tap
// handler itself: the topmost widget at the tap point gets the event and
// nothing bubbles to the widget below (unlike the DOM, where the web
// harness's cell onClick fires through the <img>). And the handler must
// be addEventListener(CLICK_DOWN): `click_func` works on BUTTON, but on a
// FILL_RECT it silently does nothing on-device — 0.2.2 gave the cells,
// dots and frame `click_func`, the unit tests passed (their stub treated
// it as a live tap path), the harness worked (its shim maps click_func
// to a click), and on the real watch every dot/cell tap died. The piece
// IMG covers ~90% of its cell (38/42 px on Bip 6, 37/41 px on Active 3),
// so a piece without a handler made its whole square untappable — taps on
// pieces did nothing on-device while the same code worked in the browser.
// The legal-move dots (14 px, centred on target squares) and the
// selection frame swallow taps the same way, so they carry it too.
// addEventListener(CLICK_DOWN) is the pattern proven on-device for
// FILL_RECT and IMG alike (dragon-army uses it for both).
//
// No dim overlay while a move is in flight: 0.2.4 dimmed the whole board
// until the server answered, which read as a ~1 s black screen after
// every tap. The move is now optimistic (page/index.js applies it to
// the displayed board the moment it is tapped), so the board already
// shows the new position while the send is in flight; taps are still
// ignored meanwhile (see page/index.js _pendingMove).
import { parseFen } from "../shared/fen.js";
import { squareRect } from "./layout.js";
import { THEME } from "./theme.js";

function fileOf(uci) { return uci.charCodeAt(0) - 97; }
function rankIdxOf(uci) { return Number(uci[1]) - 1; }

export function renderBoard(hmUI, widgets, opts) {
  const { layout, state, selected, targets, onSquare } = opts;
  const flipped = state.you.color === "b";
  const board = parseFen(state.game.fen);
  const { cell, piece } = layout.board;
  const lastMove = state.game.last_move;
  const checkSq = state.game.check ? state.game.check_square : null;

  for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
    for (let file = 0; file < 8; file++) {
      const rect = squareRect(layout, file, rankIdx, flipped);
      const isLight = (file + rankIdx) % 2 === 1;
      let color = isLight ? THEME.lightSquare : THEME.darkSquare;
      const uci = String.fromCharCode(97 + file) + (rankIdx + 1);
      if (lastMove && (uci === lastMove.from || uci === lastMove.to)) {
        color = THEME.lastMove;
      }
      if (checkSq && uci === checkSq) color = THEME.check;
      // FILL_RECT taps need addEventListener(CLICK_DOWN) — click_func
      // is silently ignored on this widget type on-device (0.2.2).
      const cellWidget = hmUI.createWidget(hmUI.widget.FILL_RECT, {
        x: rect.x, y: rect.y, w: rect.w, h: rect.h, color,
      });
      cellWidget.addEventListener(hmUI.event.CLICK_DOWN, () => onSquare(uci));
      widgets.push(cellWidget);
      // Piece image (centred in the cell). It sits ON TOP of the cell
      // rect, so it needs its own handler — without one the tap dies here
      // and onSquare() never runs. addEventListener(CLICK_DOWN) is the
      // pattern proven on-device (dragon-army uses it for IMG taps).
      const pieceObj = board[7 - rankIdx][file];
      if (pieceObj) {
        const src = `pieces/${layout.shape}/${pieceObj.color}${pieceObj.type}.png`;
        const pieceWidget = hmUI.createWidget(hmUI.widget.IMG, {
          x: rect.x + Math.floor((cell - piece) / 2),
          y: rect.y + Math.floor((cell - piece) / 2),
          w: piece, h: piece, src,
        });
        pieceWidget.addEventListener(hmUI.event.CLICK_DOWN, () => onSquare(uci));
        widgets.push(pieceWidget);
      }
    }
  }

  // Selection frame: 4 thin rects around the selected square.
  if (selected) {
    const r = squareRect(layout, fileOf(selected), rankIdxOf(selected), flipped);
    const t = 3;
    const frame = [
      { x: r.x, y: r.y, w: r.w, h: t },
      { x: r.x, y: r.y + r.h - t, w: r.w, h: t },
      { x: r.x, y: r.y, w: t, h: r.h },
      { x: r.x + r.w - t, y: r.y, w: t, h: r.h },
    ];
    for (const f of frame) {
      const frameWidget = hmUI.createWidget(hmUI.widget.FILL_RECT, {
        ...f, color: THEME.selection,
      });
      frameWidget.addEventListener(hmUI.event.CLICK_DOWN, () => onSquare(selected));
      widgets.push(frameWidget);
    }
  }

  // Legal-move dots on target squares. A dot sits on top of its cell, so
  // it needs its own handler — tapping the dot IS tapping the square.
  for (const target of targets || []) {
    const r = squareRect(layout, fileOf(target), rankIdxOf(target), flipped);
    const d = 14;
    const dotWidget = hmUI.createWidget(hmUI.widget.FILL_RECT, {
      x: r.x + Math.floor((cell - d) / 2),
      y: r.y + Math.floor((cell - d) / 2),
      w: d, h: d, radius: 7, color: THEME.legalDot,
    });
    dotWidget.addEventListener(hmUI.event.CLICK_DOWN, () => onSquare(target));
    widgets.push(dotWidget);
  }

}
