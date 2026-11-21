import { setStatusBarVisible } from "@zos/ui";
import { BaseApp } from "@zeppos/zml/base-app";

App(
  BaseApp({
    globalData: {},

    onCreate() {
      try {
        setStatusBarVisible(false);
      } catch (_) {}
    },

    onDestroy() {},
  }),
);
