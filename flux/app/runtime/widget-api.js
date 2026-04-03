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
    console.error('[WidgetAPI] window.__TAURI__ not available — ensure withGlobalTauri is enabled in tauri.conf.json');
    return;
  }

  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  const { getCurrentWindow } = window.__TAURI__.window;

  const appWindow = getCurrentWindow();
  const windowLabel = appWindow.label;

  // --- Platform detection ---
  // Platform detection — called once at load. Safe because drag() is always
  // user-initiated and fires well after page load completes.
  // Cached at load time. Drag logic checks this at call time.
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

    /**
     * Pull (on-demand) system metrics. Each returns a Promise.
     */
    cpu()     { return invoke('system_cpu'); },
    memory()  { return invoke('system_memory'); },
    disk()    { return invoke('system_disk'); },
    network() { return invoke('system_network'); },
    gpu()     { return invoke('system_gpu'); },
    battery() { return invoke('system_battery'); },
    uptime()  { return invoke('system_uptime'); },
    os()      { return invoke('system_os'); },

    /**
     * Subscribe to a pushed metric broadcast event.
     *
     * @param {string} metric - One of: 'cpu', 'memory', 'disk', 'network',
     *                          'gpu', 'disk-io', 'battery'
     * @param {function} callback - Called with the event payload on each update.
     * @returns {function} unlisten - Call to stop listening.
     */
    subscribe(metric, callback) {
      const eventName = `system:${metric}`;

      // First listener for this category — register with Rust broadcaster
      const count = this._counts.get(metric) || 0;
      if (count === 0) {
        invoke('register_metric_interest', {
          windowId: this._windowId,
          categories: [metric],
        }).catch(() => {}); // fire-and-forget
      }
      this._counts.set(metric, count + 1);

      let unlistenFn = null;
      const unlistenPromise = listen(eventName, (event) => {
        callback(event.payload);
      });

      // Return a synchronous unlisten wrapper
      let cancelled = false;
      unlistenPromise.then((fn) => {
        unlistenFn = fn;
        if (cancelled) {
          fn();
        }
      });

      return function unlisten() {
        // Decrement listener count; unregister from broadcaster when last listener removed
        const newCount = (system._counts.get(metric) || 1) - 1;
        system._counts.set(metric, newCount);
        if (newCount === 0) {
          invoke('unregister_metric_interest', {
            windowId: system._windowId,
            categories: [metric],
          }).catch(() => {}); // fire-and-forget
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
    /**
     * Start dragging this module window.
     *
     * Platform-aware:
     * - Non-layer-shell (X11, Windows, macOS): delegates to appWindow.startDragging()
     * - Wayland layer-shell: tracks mousemove deltas and calls move_module on the backend
     *
     * @param {MouseEvent} mousedownEvent - The mousedown event that initiated the drag.
     */
    drag(mousedownEvent) {
      if (!_isLayerShell) {
        appWindow.startDragging().catch((e) => console.warn('[WidgetAPI] startDragging failed:', e));
        return;
      }

      // Wayland layer-shell drag via delta tracking
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

    /**
     * Start a resize drag in the given direction.
     *
     * Platform-aware:
     * - Non-layer-shell: delegates to appWindow.startResizeDragging()
     * - Wayland layer-shell: tracks mousemove deltas and calls resize_module on the backend
     *
     * @param {string} direction - Tauri resize direction string, e.g. 'South', 'East', etc.
     * @param {MouseEvent} mousedownEvent - The mousedown event that initiated the resize.
     */
    resize(direction, mousedownEvent) {
      if (!_isLayerShell) {
        appWindow.startResizeDragging(direction).catch((e) => console.warn('[WidgetAPI] startResizeDragging failed:', e));
        return;
      }

      // Wayland layer-shell resize via delta tracking
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

    /**
     * Open the settings window for this module.
     */
    openSettings() {
      return invoke('open_module_settings', { id: windowLabel });
    },

    /**
     * Close this module's window.
     */
    close() {
      return invoke('close_window', { label: windowLabel });
    },

    /**
     * Get the current settings for this module.
     * Returns a Promise that resolves to a plain object { key: value, ... }.
     */
    getSettings() {
      return invoke('get_module_settings', { moduleId: windowLabel });
    },

    /**
     * Save a single setting value for this module.
     * @param {string} key
     * @param {*} value
     */
    saveSetting(key, value) {
      return invoke('set_module_setting', { moduleId: windowLabel, key, value });
    },
  };

  // --- Expose ---

  window.WidgetAPI = { system, widget };
})();
