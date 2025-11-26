#!/usr/bin/env node
/**
 * rtfmbro-mcp (PATH N)
 *
 * MCP tool for Chrome DevTools Protocol automation.
 * Provides: run_js_in_page(), click(selector), call window.Anchor method
 */

import WebSocket from 'ws';

const DEBUG_PORT = process.env.CDP_PORT || 9222;
const CDP_URL = `http://localhost:${DEBUG_PORT}`;

class MCPTool {
  constructor() {
    this.ws = null;
    this.messageId = 0;
    this.pending = new Map();
  }

  async connect() {
    // Get WebSocket debugger URL
    const response = await fetch(`${CDP_URL}/json/list`);
    const targets = await response.json();
    const page = targets.find(t => t.type === 'page');
    
    if (!page) {
      throw new Error('No page target found');
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(page.webSocketDebuggerUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', (data) => this.handleMessage(data));
    });
  }

  handleMessage(data) {
    const msg = JSON.parse(data.toString());
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) {
        reject(new Error(msg.error.message));
      } else {
        resolve(msg.result);
      }
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Execute JavaScript in page context
   */
  async run_js_in_page(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return result.result?.value;
  }

  /**
   * Click element by selector
   */
  async click(selector) {
    const js = `
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        el.click();
        true;
      } else {
        false;
      }
    `;
    return this.run_js_in_page(js);
  }

  /**
   * Call window.Anchor method (overlay API)
   */
  async callAnchor(method, ...args) {
    const js = `
      if (window.Anchor && typeof window.Anchor.${method} === 'function') {
        window.Anchor.${method}(${args.map(a => JSON.stringify(a)).join(', ')});
        true;
      } else {
        false;
      }
    `;
    return this.run_js_in_page(js);
  }

  /**
   * Get DOM field map
   */
  async getFieldMap() {
    return this.run_js_in_page(`
      if (window.Anchor && window.Anchor.getFieldMap) {
        JSON.stringify(window.Anchor.getFieldMap());
      } else {
        null;
      }
    `);
  }

  /**
   * Fill field by ID
   */
  async fillField(fieldId, value) {
    return this.callAnchor('fillField', fieldId, value);
  }

  /**
   * Get current patient info
   */
  async getPatientInfo() {
    return this.run_js_in_page(`
      if (window.Anchor && window.Anchor.getPatientInfo) {
        JSON.stringify(window.Anchor.getPatientInfo());
      } else {
        null;
      }
    `);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log('Usage: rtfmbro-mcp <command> [args...]');
    console.log('Commands:');
    console.log('  eval <js>        - Run JavaScript in page');
    console.log('  click <selector> - Click element');
    console.log('  anchor <method>  - Call window.Anchor method');
    console.log('  fields           - Get field map');
    console.log('  patient          - Get patient info');
    process.exit(1);
  }

  const mcp = new MCPTool();
  
  try {
    await mcp.connect();
    console.log('[MCP] Connected to Chrome');

    let result;
    switch (command) {
      case 'eval':
        result = await mcp.run_js_in_page(args.slice(1).join(' '));
        break;
      case 'click':
        result = await mcp.click(args[1]);
        break;
      case 'anchor':
        result = await mcp.callAnchor(args[1], ...args.slice(2));
        break;
      case 'fields':
        result = await mcp.getFieldMap();
        break;
      case 'patient':
        result = await mcp.getPatientInfo();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('[MCP] Error:', error.message);
    process.exit(1);
  } finally {
    mcp.disconnect();
  }
}

main();

export { MCPTool };
