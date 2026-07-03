/**
 * Feedy Widget SDK
 * Embeddable feedback widget for external applications
 *
 * Usage:
 * <script src="https://yourapp.com/widget.js"></script>
 * <script>
 *   FeedyWidget.init({
 *     apiKey: 'org-abc123',
 *     widgetId: 'product-feedback' // optional
 *   });
 *
 *   FeedyWidget.identify({
 *     id: 'user-123',
 *     email: 'user@example.com',
 *     plan: 'enterprise',
 *     company: 'Acme Corp'
 *   });
 * </script>
 */

(function (window) {
  'use strict';

  // Widget configuration
  let config = {
    apiKey: null,
    widgetId: null,
    apiSecret: null, // DEV ONLY — never expose in production client code
    baseUrl: 'http://localhost:3000', // Change this to your production URL
    position: 'bottom-right',
    color: '#3b82f6',
    zIndex: 9999,
    hideButton: false, // New setting to hide the floating bubble natively
  };

  // Widget state
  let widgetState = {
    isOpen: false,
    iframe: null,
    container: null,
    toggleButton: null,
    currentUser: null,
    context: {},
  };

  // Message types for postMessage communication
  const MESSAGE_TYPES = {
    INIT: 'INIT',
    IDENTIFY: 'IDENTIFY',
    OPEN: 'OPEN',
    CLOSE: 'CLOSE',
    FEEDBACK_SUBMITTED: 'FEEDBACK_SUBMITTED',
    ERROR: 'ERROR',
    SHOW_PROMPT: 'SHOW_PROMPT',
    TRACK: 'TRACK',
    READY: 'READY',
  };

  /**
   * Generate unique ID for widget container
   */
  function generateWidgetId() {
    return 'feedy-widget-' + Math.random().toString(36).substr(2, 9);
  }

  const RESERVED_IDENTITY_KEYS = new Set([
    'userID', 'id', 'userId', 'email', 'name', 'timestamp', 'hash', 'custom_fields',
  ]);

  function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map(function (b) { return b.toString(16).padStart(2, '0'); })
      .join('');
  }

  /**
   * HMAC-SHA256(api_secret, userID + ":" + email + ":" + timestamp)
   */
  async function generateIdentityHash(apiSecret, userID, email, timestamp) {
    var payload = userID + ':' + email + ':' + timestamp;
    var enc = new TextEncoder();
    var key = await crypto.subtle.importKey(
      'raw',
      enc.encode(apiSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    var signature = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    return bufferToHex(signature);
  }

  /**
   * Build signed identity for widget API (verified SDK path).
   */
  async function buildSignedIdentity(user) {
    var userID = user.userID || user.id || user.userId;
    var email = user.email ? String(user.email).trim().toLowerCase() : null;
    var name = user.name || null;

    if (!userID) {
      console.error('❌ Feedy Widget: userID (or id) is required');
      return null;
    }
    if (!email) {
      console.error('❌ Feedy Widget: email is required for verified SDK identity');
      return null;
    }

    var timestamp = user.timestamp;
    var hash = user.hash;

    if (!hash) {
      if (!config.apiSecret) {
        console.error('❌ Feedy Widget: Provide hash+timestamp from your server, or apiSecret in init() for local dev ONLY');
        return null;
      }
      console.warn('⚠️ Feedy Widget: Browser-side signing — DEV ONLY. Use server-side HMAC in production.');
      timestamp = Math.floor(Date.now() / 1000);
      hash = await generateIdentityHash(config.apiSecret, userID, email, String(timestamp));
    }

    var custom_fields = user.custom_fields && typeof user.custom_fields === 'object'
      ? Object.assign({}, user.custom_fields)
      : {};

    Object.keys(user).forEach(function (key) {
      if (!RESERVED_IDENTITY_KEYS.has(key) && user[key] !== undefined && user[key] !== null) {
        custom_fields[key] = user[key];
      }
    });

    return {
      userID: userID,
      email: email,
      name: name,
      timestamp: timestamp,
      hash: hash,
      custom_fields: custom_fields,
    };
  }

  /**
   * Create widget container and iframe
   */
  function createWidget() {
    // Create container
    const container = document.createElement('div');
    container.id = generateWidgetId();
    container.style.cssText = `
      position: fixed;
      ${config.position.includes('bottom') ? 'bottom: 20px;' : 'top: 20px;'}
      ${config.position.includes('right') ? 'right: 20px;' : 'left: 20px;'}
      z-index: ${config.zIndex};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Create toggle button
    const toggleButton = document.createElement('button');
    toggleButton.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
    `;
    toggleButton.style.cssText = `
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background-color: ${config.color};
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transition: transform 0.2s, box-shadow 0.2s;
      color: white;
    `;
    toggleButton.onmouseenter = () => {
      toggleButton.style.transform = 'scale(1.05)';
      toggleButton.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.2)';
    };
    toggleButton.onmouseleave = () => {
      toggleButton.style.transform = 'scale(1)';
      toggleButton.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
    };
    toggleButton.onclick = toggleWidget;

    // Create iframe
    const iframe = document.createElement('iframe');
    const widgetUrl = `${config.baseUrl}/widget.html?apiKey=${config.apiKey}${config.widgetId ? '&widgetId=' + config.widgetId : ''}`;
    iframe.src = widgetUrl;
    iframe.style.cssText = `
      position: fixed;
      ${config.position.includes('bottom') ? 'bottom: 80px;' : 'top: 80px;'}
      ${config.position.includes('right') ? 'right: 20px;' : 'left: 20px;'}
      width: 400px;
      height: 600px;
      border: none;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      background: white;
      display: none;
      z-index: ${config.zIndex + 1};
    `;

    // Add elements to container
    container.appendChild(iframe);
    
    // Only add toggle button if not hidden
    if (!config.hideButton) {
      container.appendChild(toggleButton);
    }
    document.body.appendChild(container);

    // Store references
    widgetState.container = container;
    widgetState.iframe = iframe;
    widgetState.toggleButton = toggleButton;

    // Listen for messages from iframe
    window.addEventListener('message', handleMessage);

    console.log('✅ Feedy Widget created');
  }

  /**
   * Handle messages from iframe
   */
  function handleMessage(event) {
    // Verify origin
    if (event.origin !== config.baseUrl) {
      return;
    }

    const { type, data } = event.data;

    switch (type) {
      case MESSAGE_TYPES.READY:
        console.log('✅ Widget is ready');
        if (widgetState.currentUser) {
          sendIdentify();
        }
        break;

      case MESSAGE_TYPES.FEEDBACK_SUBMITTED:
        console.log('✅ Feedback submitted:', data);
        // Trigger custom event
        const customEvent = new CustomEvent('feedy:feedbackSubmitted', { detail: data });
        window.dispatchEvent(customEvent);
        break;

      case MESSAGE_TYPES.ERROR:
        console.error('❌ Widget error:', data);
        break;

      default:
        console.log('📩 Widget message:', type, data);
    }
  }

  /**
   * Send signed identify message to iframe
   */
  async function sendIdentify() {
    if (!widgetState.iframe || !widgetState.currentUser) {
      return;
    }

    var signed = await buildSignedIdentity(widgetState.currentUser);
    if (!signed) return;

    widgetState.currentUser = signed;
    widgetState.iframe.contentWindow.postMessage(
      {
        type: MESSAGE_TYPES.IDENTIFY,
        data: signed,
      },
      config.baseUrl
    );
  }

  /**
   * Toggle widget open/close
   */
  function toggleWidget() {
    widgetState.isOpen = !widgetState.isOpen;

    if (widgetState.isOpen) {
      widgetState.iframe.style.display = 'block';
      widgetState.iframe.contentWindow.postMessage(
        { type: MESSAGE_TYPES.OPEN },
        '*'
      );
    } else {
      widgetState.iframe.style.display = 'none';
      widgetState.iframe.contentWindow.postMessage(
        { type: MESSAGE_TYPES.CLOSE },
        '*'
      );
    }
  }

  /**
   * Initialize widget
   */
  function init(options) {
    if (!options.apiKey) {
      console.error('❌ Feedy Widget: API key is required');
      return;
    }

    // Merge config
    config = { ...config, ...options };

    // Create widget when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createWidget);
    } else {
      createWidget();
    }

    console.log('✅ Feedy Widget initialized');
  }

  /**
   * Identify user (requires email + userID; hash from server or apiSecret dev mode)
   */
  async function identify(user) {
    if (!user.id && !user.userID) {
      console.error('❌ Feedy Widget: User ID is required for identify()');
      return;
    }

    widgetState.currentUser = Object.assign({}, user, widgetState.context);

    if (widgetState.iframe && widgetState.iframe.contentWindow) {
      await sendIdentify();
      console.log('✅ Feedy Widget: User identified, signed payload sent to iframe');
    } else {
      console.warn('⚠️ Feedy Widget: Iframe not ready yet, user data stored');
    }
  }

  /**
   * Open widget
   */
  function open() {
    if (!widgetState.isOpen) {
      toggleWidget();
    }
  }

  /**
   * Close widget
   */
  function close() {
    if (widgetState.isOpen) {
      toggleWidget();
    }
  }

  /**
   * Set context
   * Updates contextual data for the user/session
   */
  function setContext(contextObj) {
    if (!contextObj || typeof contextObj !== 'object') return;
    
    widgetState.context = { ...widgetState.context, ...contextObj };
    
    // If user is already identified, re-identify to sync new context
    if (widgetState.currentUser && (widgetState.currentUser.id || widgetState.currentUser.userID)) {
      identify(Object.assign({}, widgetState.currentUser, widgetState.context));
    }
  }

  /**
   * Show feedback prompt with optional pre-filled data/context
   */
  function showFeedbackPrompt(options = {}) {
    open(); // Ensure it's open
    
    if (widgetState.iframe && widgetState.iframe.contentWindow) {
      widgetState.iframe.contentWindow.postMessage(
        {
          type: MESSAGE_TYPES.SHOW_PROMPT,
          data: options,
        },
        '*'
      );
    }
  }

  /**
   * Track an event
   */
  function track(eventName, eventData = {}) {
    if (widgetState.iframe && widgetState.iframe.contentWindow) {
      widgetState.iframe.contentWindow.postMessage(
        {
          type: MESSAGE_TYPES.TRACK,
          data: { event: eventName, properties: eventData },
        },
        config.baseUrl
      );
    }
  }

  /**
   * Destroy widget
   */
  function destroy() {
    if (widgetState.container) {
      document.body.removeChild(widgetState.container);
    }
    window.removeEventListener('message', handleMessage);
    widgetState = {
      isOpen: false,
      iframe: null,
      container: null,
      toggleButton: null,
      currentUser: null,
    };
    console.log('✅ Feedy Widget destroyed');
  }

  // Export API
  window.FeedyWidget = {
    init,
    identify,
    setContext,
    open,
    close,
    showFeedbackPrompt,
    track,
    destroy,
  };

  console.log('✅ Feedy Widget SDK loaded');
})(window);
