// Chess Watch page: lifecycle + UI state machine. Full re-render on every
// state change (koala pattern: delete all widgets, recreate).
import hmUI from "@zos/ui";
import { getDeviceInfo } from "@zos/device";
import { BasePage } from "@zeppos/zml/base-page";
import { getLayout } from "./layout.js";
import { THEME } from "./theme.js";
import { renderBoard } from "./board.js";
import { renderStatus } from "./status.js";
import {
  renderPicker, renderMenu, renderConfirm, renderPromotion,
  renderOffer, renderResult,
} from "./overlays.js";
import { Controller } from "./controller.js";
import { loadRole, saveRole, clearRole, loadHapticsEnabled, saveHapticsEnabled } from "../utils/storage.js";
import { vibrate, setHapticsEnabled } from "../utils/haptics.js";
import { pieceAt, parseFen } from "../shared/fen.js";
import { targetsFor, isPromotionMove, errorMessage } from "../shared/protocol.js";

let _widgets = [];
let _layout = null;
let _role = null;
let _controller = null;
let _state = null;
let _connected = false;
let _selected = null;      // UCI square or null
let _overlay = null;       // null | 'menu' | 'confirm-resign' | 'confirm-restart' | 'promotion' | 'result'
let _pendingPromotion = null; // { from, to }
let _pendingMove = false;
let _toast = null;         // { text, until }
let _toastTimer = null;
let _offerTimer = null;
let _resultDismissedFor = null; // revision of the dismissed result screen
let _hapticsOn = true;
let _page = null;
let _lastCheck = false;
let _lastPly = -1;

function urlPlayerParam() {
  try {
    const m = /[?&]player=(p1|p2)/.exec(globalThis.location ? globalThis.location.search : "");
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}

function showToast(text) {
  _toast = { text, until: Date.now() + 2500 };
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    _toast = null;
    _page && _page.render();
  }, 2500);
  _page && _page.render();
}

function myTurn() {
  return _state && _state.game.status === "active" && _state.game.turn === _state.you.color;
}

function targets() {
  if (!_selected || !myTurn() || !_state) return [];
  return targetsFor(_state.game.legal_moves, _selected).map((m) => m.slice(2, 4));
}

function onState(state) {
  const prevPly = _lastPly;
  const prevCheck = _lastCheck;
  _state = state;
  _lastPly = state.game.ply;
  _lastCheck = state.game.check;
  _selected = null;
  _pendingMove = false;
  if (_controller) _controller.setRevision(state.revision);
  // Haptics: opponent moved, or we are now in check.
  if (state.game.ply > prevPly && prevPly >= 0 && state.game.ply > 0) vibrate();
  if (state.game.check && !prevCheck) vibrate();
  // Countdown refresh while an offer is pending.
  if (state.game.offer) {
    if (!_offerTimer) {
      _offerTimer = setInterval(() => _page && _page.render(), 1000);
    }
  } else if (_offerTimer) {
    clearInterval(_offerTimer);
    _offerTimer = null;
  }
  _page && _page.render();
}

function onConnection(connected) {
  if (_connected !== connected) {
    _connected = connected;
    _page && _page.render();
  }
}

async function doMove(from, to, promotion) {
  if (!_controller || _pendingMove) return;
  _pendingMove = true;
  _selected = null;
  _page && _page.render();
  const res = await _controller.submitMove(from, to, promotion);
  _pendingMove = false;
  if (!res.ok) {
    showToast(errorMessage(res.code));
  }
  _page && _page.render();
}

async function doAction(type, claim) {
  if (!_controller) return;
  const res = await _controller.submitAction(type, claim);
  if (!res.ok) showToast(errorMessage(res.code));
  else if (type === "resign") showToast("You resigned");
  _overlay = null;
  _page && _page.render();
}

function onSquare(uci) {
  if (!_state || _overlay || _pendingMove) return;
  if (!myTurn()) {
    if (_state.game.status === "finished") _overlay = "result";
    else showToast("Wait for your opponent");
    _page && _page.render();
    return;
  }
  const board = parseFen(_state.game.fen);
  const piece = pieceAt(board, uci);
  if (_selected) {
    const t = targets();
    if (t.includes(uci)) {
      if (isPromotionMove(_state.game.legal_moves, _selected, uci)) {
        _pendingPromotion = { from: _selected, to: uci };
        _overlay = "promotion";
      } else {
        doMove(_selected, uci, null);
      }
      _page && _page.render();
      return;
    }
  }
  if (piece && piece.color === _state.you.color) {
    _selected = uci;
  } else {
    _selected = null;
  }
  _page && _page.render();
}

function startController() {
  if (!_role || _controller) return;
  _controller = new Controller({
    role: _role,
    request: (req) => _page.request(req),
    onState,
    onConnection,
    onToast: showToast,
  });
  _controller.start();
}

function stopController() {
  if (_controller) {
    _controller.stop();
    _controller = null;
  }
}

Page(
  BasePage({
    build() {
      _page = this;
      let info = null;
      try {
        info = getDeviceInfo();
      } catch (_) {
        info = null;
      }
      _layout = getLayout(info);
      _hapticsOn = loadHapticsEnabled();
      setHapticsEnabled(_hapticsOn);
      _role = urlPlayerParam() || loadRole();
      if (_role) startController();
      this.render();
    },

    onShow() {
      if (_role && !_controller) startController();
      else if (_controller) _controller.refresh();
      this.render();
    },

    onHide() {
      stopController();
    },

    onDestroy() {
      stopController();
      if (_toastTimer) clearTimeout(_toastTimer);
      if (_offerTimer) clearInterval(_offerTimer);
    },

    render() {
      _widgets.forEach((w) => {
        try {
          hmUI.deleteWidget(w);
        } catch (_) {}
      });
      _widgets = [];
      if (!_layout) return;

      // Background.
      _widgets.push(
        hmUI.createWidget(hmUI.widget.FILL_RECT, {
          x: 0, y: 0, w: _layout.width, h: _layout.height, color: THEME.background,
        }),
      );

      if (!_role) {
        renderPicker(hmUI, _widgets, _layout, (role) => {
          _role = role;
          saveRole(role);
          startController();
          this.render();
        });
        return;
      }

      if (_state) {
        renderStatus(hmUI, _widgets, _layout, _state, _connected);
        renderBoard(hmUI, _widgets, {
          layout: _layout,
          state: _state,
          selected: _selected,
          targets: targets(),
          pendingMove: _pendingMove,
          onSquare,
        });
      } else {
        _widgets.push(
          hmUI.createWidget(hmUI.widget.TEXT, {
            x: 0, y: 200, w: _layout.width, h: 40,
            text: "Connecting…", text_size: 20, color: THEME.textSecondary,
            align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
          }),
        );
      }

      // Menu button.
      const m = _layout.menu;
      _widgets.push(
        hmUI.createWidget(hmUI.widget.BUTTON, {
          x: m.x, y: m.y, w: m.w, h: m.h, text: "Menu", text_size: 20,
          radius: 10, normal_color: THEME.button, color: THEME.buttonText,
          click_func: () => {
            _overlay = "menu";
            this.render();
          },
        }),
      );

      // Toast.
      if (_toast) {
        _widgets.push(
          hmUI.createWidget(hmUI.widget.TEXT, {
            x: 20, y: _layout.height - 84, w: _layout.width - 40, h: 30,
            text: _toast.text, text_size: 18, color: THEME.selection,
            align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
          }),
        );
      }

      // Incoming offer (only when addressed to us).
      const offer = _state && _state.game.offer;
      if (offer && offer.by !== _role && !_overlay) {
        renderOffer(hmUI, _widgets, _layout, offer, _state, {
          onAccept: () => doAction("accept"),
          onDecline: () => doAction("decline"),
        });
        return;
      }

      // Result screen (once per finished revision).
      if (
        _state && _state.game.status === "finished" &&
        _resultDismissedFor !== _state.revision && !_overlay
      ) {
        _overlay = "result";
      }

      if (_overlay === "menu") {
        renderMenu(hmUI, _widgets, _layout, {
          hapticsOn: _hapticsOn,
          onClose: () => { _overlay = null; this.render(); },
          onOfferDraw: () => { _overlay = null; doAction("offer_draw"); },
          onTakeback: () => { _overlay = null; doAction("offer_takeback"); },
          onRestart: () => { _overlay = "confirm-restart"; this.render(); },
          onResign: () => { _overlay = "confirm-resign"; this.render(); },
          onToggleHaptics: () => {
            _hapticsOn = !_hapticsOn;
            setHapticsEnabled(_hapticsOn);
            saveHapticsEnabled(_hapticsOn);
            this.render();
          },
          onSwitchPlayer: () => {
            stopController();
            clearRole();
            _role = null;
            _state = null;
            _overlay = null;
            this.render();
          },
        });
      } else if (_overlay === "confirm-resign") {
        renderConfirm(hmUI, _widgets, _layout, {
          title: "Resign?",
          text: "You lose immediately. This cannot be undone.",
          danger: true,
          onYes: () => doAction("resign"),
          onNo: () => { _overlay = null; this.render(); },
        });
      } else if (_overlay === "confirm-restart") {
        renderConfirm(hmUI, _widgets, _layout, {
          title: "Start over?",
          text: "Your opponent must accept. The board resets.",
          onYes: () => doAction("offer_restart"),
          onNo: () => { _overlay = null; this.render(); },
        });
      } else if (_overlay === "promotion") {
        renderPromotion(hmUI, _widgets, _layout, (piece) => {
          const p = _pendingPromotion;
          _pendingPromotion = null;
          _overlay = null;
          if (p) doMove(p.from, p.to, piece);
          else this.render();
        }, () => {
          _pendingPromotion = null;
          _overlay = null;
          this.render();
        });
      } else if (_overlay === "result") {
        renderResult(hmUI, _widgets, _layout, _state, _role, {
          onPlayAgain: () => {
            _resultDismissedFor = _state.revision;
            _overlay = null;
            doAction("offer_restart");
          },
          onClose: () => {
            _resultDismissedFor = _state.revision;
            _overlay = null;
            this.render();
          },
        });
      }
    },
  }),
);
