// Board: 64 FILL_RECT cells (each clickable), pieces as IMG, dots,
// selection frame, last-move tint, check tint.
import { parseFen } from "../shared/fen.js";
import { squareRect } from "./layout.js";
import { THEME } from "./theme.js";

function fileOf(uci) { return uci.charCodeAt(0) - 97; }
function rankIdxOf(uci) { return Number(uci[1]) - 1; }

export function renderBoard(hmUI, widgets, opts) {
  const { layout, state, selected, targets, pendingMove, onSquare } = opts;
  const flipped = state.you.color === "b";
  const board = parseFen(state.game.fen);
  const { x: bx, y: by, cell, piece } = layout.board;
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
      const cellWidget = hmUI.createWidget(hmUI.widget.FILL_RECT, {
        x: rect.x, y: rect.y, w: rect.w, h: rect.h, color,
        click_func: () => onSquare(uci),
      });
      widgets.push(cellWidget);
      // Piece image (centred in the cell).
      const pieceObj = board[7 - rankIdx][file];
      if (pieceObj) {
        const src = `pieces/${layout.shape}/${pieceObj.color}${pieceObj.type}.png`;
        widgets.push(
          hmUI.createWidget(hmUI.widget.IMG, {
            x: rect.x + Math.floor((cell - piece) / 2),
            y: rect.y + Math.floor((cell - piece) / 2),
            w: piece, h: piece, src,
          }),
        );
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
      widgets.push(
        hmUI.createWidget(hmUI.widget.FILL_RECT, { ...f, color: THEME.selection }),
      );
    }
  }

  // Legal-move dots on target squares.
  for (const target of targets || []) {
    const r = squareRect(layout, fileOf(target), rankIdxOf(target), flipped);
    const d = 14;
    widgets.push(
      hmUI.createWidget(hmUI.widget.FILL_RECT, {
        x: r.x + Math.floor((cell - d) / 2),
        y: r.y + Math.floor((cell - d) / 2),
        w: d, h: d, radius: 7, color: THEME.legalDot,
      }),
    );
  }

  // Pending-move pulse: dim the board while a send is in flight.
  if (pendingMove) {
    widgets.push(
      hmUI.createWidget(hmUI.widget.FILL_RECT, {
        x: bx, y: by, w: layout.board.size, h: layout.board.size,
        color: 0x660e1116,
      }),
    );
  }
}
