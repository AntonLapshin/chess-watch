// Local copy of zepp-web-runner/components/WatchPage.jsx, adapted so the
// widget collector uses the SAME hmUI module instance as the page.
//
// Why not import the runner's WatchPage directly? The runner's file imports
// _reset/_collect from "zepp-web-runner/shims/hmUI", while the page imports
// "@zos/ui" (resolved by the runner plugin to the same file). Vite serves
// those two specifiers as different URLs (one with ?v=, one without), i.e.
// two module instances with separate widget lists — created widgets never
// reached the collector and the board rendered empty. Importing _reset /
// _collect from "@zos/ui" here guarantees one instance. WidgetRenderer and
// the device constants come from the runner unchanged.
import React, { useState, useEffect } from "react";
import { _reset, _collect } from "@zos/ui";
import { renderWidget } from "zepp-web-runner/components/WidgetRenderer";
import { DEVICE_WIDTH, DEVICE_HEIGHT } from "zepp-web-runner/constants";

let _pageConfig = null;
let _triggerRender = null;

export function _setPageConfig(config) {
  const originalBuild = config.build;
  const originalRender = config.render;

  config.build = function () {
    originalBuild.call(config);
  };

  config.render = function () {
    _reset();
    originalRender.call(config);
    const widgets = _collect();
    if (_triggerRender) _triggerRender(widgets);
  };

  _pageConfig = config;
}

export function getPageConfig() {
  return _pageConfig;
}

export function triggerRender() {
  if (_pageConfig) _pageConfig.render();
}

export function WatchPage({ width, height }) {
  const [widgets, setWidgets] = useState([]);
  _triggerRender = setWidgets;

  const w = width ?? DEVICE_WIDTH;
  const h = height ?? DEVICE_HEIGHT;

  useEffect(() => {
    if (!_pageConfig) return;
    // Re-assert the render trigger here, before build(): when the preset
    // switcher remounts this component (the wrapper div is keyed by
    // device), React runs the OLD component's cleanup AFTER the new one
    // renders but BEFORE its effects run — so the old cleanup's
    // `_triggerRender = null` wipes the new component's setter. Without
    // this line the build's render (and every later poll render) is
    // collected but never delivered to React state, and the frame stays
    // black after switching presets — while loading ?device=active-3
    // directly works fine, because no remount happens. Assigning in the
    // effect (which runs after all cleanups) restores it.
    _triggerRender = setWidgets;
    _pageConfig.build();
    return () => {
      // Only clear the trigger if it is still ours: a newer mount may
      // already have replaced it (see above), and nulling it would black
      // out that mount the same way.
      if (_triggerRender === setWidgets) _triggerRender = null;
      if (_pageConfig?.onDestroy) _pageConfig.onDestroy();
    };
  }, []);

  return (
    <div
      style={{
        position: "relative",
        width: w,
        height: h,
        overflow: "hidden",
        flexShrink: 0,
        borderRadius: 84,
        boxShadow: "0 0 0 4px #333, 0 8px 32px rgba(0,0,0,0.5)",
      }}
    >
      {widgets.map((w) => renderWidget(w)).filter(Boolean)}
    </div>
  );
}
