/**
 * widget-api.js — Flux Widget Runtime API
 *
 * Served at flux-module://_flux/widget-api.js
 * Include this file in any module to get access to system metrics and widget controls.
 *
 * Exposes: window.WidgetAPI
 */

(function () {
  'use strict';

  if (!window.__TAURI__) {
    console.error('[WidgetAPI] window.__TAURI__ not available');
    return;
  }

  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  const { getCurrentWindow } = window.__TAURI__.window;

  const appWindow = getCurrentWindow();
  const windowLabel = appWindow.label;

  // --- Platform detection ---
  let _isLayerShell = false;
  (async () => {
    try {
      _isLayerShell = await invoke('is_layer_shell_window');
    } catch (e) {
      _isLayerShell = false;
    }
  })();

  // --- WidgetAPI.system ---

  const system = {
    _counts: new Map(),   // category → active listener count
    _windowId: windowLabel,

    cpu()     { return invoke('system_cpu'); },
    memory()  { return invoke('system_memory'); },
    disk()    { return invoke('system_disk'); },
    network() { return invoke('system_network'); },
    gpu()     { return invoke('system_gpu'); },
    battery() { return invoke('system_battery'); },
    uptime()  { return invoke('system_uptime'); },
    os()      { return invoke('system_os'); },

    history(metric, n) { return invoke('get_metric_history', { metric, n }); },

    /**
     * Subscribe to a pushed metric broadcast event.
     */
    subscribe(metric, callback) {
      const eventName = `system:${metric}`;
      const wid = this._windowId;

      const count = this._counts.get(metric) || 0;
      this._counts.set(metric, count + 1);

      // Register interest with backend if this is the first listener
      if (count === 0) {
        invoke('register_metric_interest', {
          args: {
            windowId: wid,
            categories: [metric],
          }
        }).catch(e => console.error(`[WidgetAPI] Backend registration failed for ${metric}:`, e));
      }

      let unlistenFn = null;
      let cancelled = false;

      const unlistenPromise = appWindow.listen(eventName, (event) => {
        callback(event.payload);
      });

      unlistenPromise.then((fn) => {
        unlistenFn = fn;
        if (cancelled) fn();
      });

      return function unlisten() {
        const currentCount = system._counts.get(metric) || 0;
        const newCount = Math.max(0, currentCount - 1);
        system._counts.set(metric, newCount);

        if (newCount === 0 && currentCount > 0) {
          invoke('unregister_metric_interest', {
            args: {
              windowId: system._windowId,
              categories: [metric],
            }
          }).catch(e => console.error(`[WidgetAPI] Backend unregistration failed for ${metric}:`, e));
        }

        if (unlistenFn) {
          unlistenFn();
        } else {
          cancelled = true;
        }
      };
    },
  };

  // --- WidgetAPI.widget ---

  const widget = {
    drag(mousedownEvent) {
      if (!_isLayerShell) {
        appWindow.startDragging().catch((e) => console.warn('[WidgetAPI] startDragging failed:', e));
        return;
      }

      let lastX = mousedownEvent.screenX;
      let lastY = mousedownEvent.screenY;

      function onMouseMove(e) {
        const dx = Math.round(e.screenX - lastX);
        const dy = Math.round(e.screenY - lastY);
        lastX = e.screenX;
        lastY = e.screenY;
        if (dx !== 0 || dy !== 0) {
          invoke('move_module', { id: windowLabel, dx, dy }).catch((e) => console.warn('[WidgetAPI] move_module failed:', e));
        }
      }

      function onMouseUp() {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },

    resize(direction, mousedownEvent) {
      if (!_isLayerShell) {
        appWindow.startResizeDragging(direction).catch((e) => console.warn('[WidgetAPI] startResizeDragging failed:', e));
        return;
      }

      let lastX = mousedownEvent.screenX;
      let lastY = mousedownEvent.screenY;

      function onMouseMove(e) {
        const dx = Math.round(e.screenX - lastX);
        const dy = Math.round(e.screenY - lastY);
        lastX = e.screenX;
        lastY = e.screenY;
        if (dx !== 0 || dy !== 0) {
          invoke('resize_module', { id: windowLabel, direction, dx, dy }).catch((e) => console.warn('[WidgetAPI] resize_module failed:', e));
        }
      }

      function onMouseUp() {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },

    openSettings() {
      return invoke('open_module_settings', { id: windowLabel });
    },

    close() {
      return invoke('close_window', { label: windowLabel });
    },

    getSettings() {
      return invoke('get_module_settings', { module_id: windowLabel });
    },

    saveSetting(key, value) {
      return invoke('set_module_setting', { module_id: windowLabel, key, value });
    },
  };

  // --- WidgetAPI.alerts ---

  const alerts = {
    register({ metric, field, op, value, duration = 10, delivery = 'notification', label = '' }) {
      return invoke('register_alert', {
        metric,
        field,
        op,
        value,
        duration_secs: duration,
        delivery,
        label,
        window_id: windowLabel,
      });
    },

    unregister(id) {
      return invoke('unregister_alert', { id });
    },

    onAlert(callback) {
      let unlistenFn = null;
      let cancelled = false;
      const unlistenPromise = listen('flux:alert', (event) => {
        callback(event.payload);
      });
      unlistenPromise.then((fn) => {
        unlistenFn = fn;
        if (cancelled) fn();
      });
      return function unlisten() {
        if (unlistenFn) {
          unlistenFn();
        } else {
          cancelled = true;
        }
      };
    },
  };

  // --- Expose ---
  window.WidgetAPI = { system, widget, alerts, invoke };
})();
