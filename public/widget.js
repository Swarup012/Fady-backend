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
    baseUrl: 'http://localhost:3000', // Change this to your production URL
    position: 'bottom-right',
    color: '#3b82f6',
    zIndex: 9999,
  };

  // Widget state
  let widgetState = {
    isOpen: false,
    iframe: null,
    container: null,
    toggleButton: null,
    currentUser: null,
  };

  // Message types for postMessage communication
  const MESSAGE_TYPES = {
    INIT: 'INIT',
    IDENTIFY: 'IDENTIFY',
    OPEN: 'OPEN',
    CLOSE: 'CLOSE',
    READY: 'READY',
    FEEDBACK_SUBMITTED: 'FEEDBACK_SUBMITTED',
    ERROR: 'ERROR',
  };

  /**
   * Generate unique ID for widget container
   */
  function generateWidgetId() {
    return 'feedy-widget-' + Math.random().toString(36).substr(2, 9);
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
    container.appendChild(toggleButton);
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
        // Send user context if available
        if (widgetState.currentUser) {
          widgetState.iframe.contentWindow.postMessage(
            {
              type: MESSAGE_TYPES.IDENTIFY,
              data: widgetState.currentUser,
            },
            config.baseUrl
          );
          console.log('✅ Feedy Widget: Sent user data to iframe after READY');
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
   * Send identify message to iframe
   */
  function sendIdentify() {
    if (!widgetState.iframe || !widgetState.currentUser) {
      return;
    }

    widgetState.iframe.contentWindow.postMessage(
      {
        type: MESSAGE_TYPES.IDENTIFY,
        data: widgetState.currentUser,
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
        config.baseUrl
      );
    } else {
      widgetState.iframe.style.display = 'none';
      widgetState.iframe.contentWindow.postMessage(
        { type: MESSAGE_TYPES.CLOSE },
        config.baseUrl
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
   * Identify user
   * Can be called anytime to update user context
   */
  function identify(user) {
    if (!user.id) {
      console.error('❌ Feedy Widget: User ID is required for identify()');
      return;
    }

    widgetState.currentUser = user;

    // Send to iframe if it's ready
    if (widgetState.iframe && widgetState.iframe.contentWindow) {
      widgetState.iframe.contentWindow.postMessage(
        {
          type: MESSAGE_TYPES.IDENTIFY,
          data: user,
        },
        config.baseUrl
      );
      console.log('✅ Feedy Widget: User identified, message sent to iframe');
    } else {
      console.warn('⚠️ Feedy Widget: Iframe not ready yet, user data stored but not sent');
      console.log('💡 Tip: Call identify() after widget is fully loaded, or wait for READY event');
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
    open,
    close,
    destroy,
  };

  console.log('✅ Feedy Widget SDK loaded');
})(window);
