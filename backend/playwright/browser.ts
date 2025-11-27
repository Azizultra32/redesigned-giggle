/**
 * Browser Connection Manager
 *
 * Manages Playwright browser connections for EHR automation.
 * Supports connecting to existing browser instances via CDP.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { EventEmitter } from 'events';
import {
  BrowserConnection,
  PageInfo,
  EhrType,
  OrchestratorEvent
} from './types.js';

// EHR detection patterns
const EHR_PATTERNS: Record<EhrType, RegExp[]> = {
  epic: [/epic/i, /mychart/i, /hyperspace/i],
  cerner: [/cerner/i, /powerchart/i, /millennium/i],
  allscripts: [/allscripts/i, /touchworks/i],
  athena: [/athena/i, /athenahealth/i],
  meditech: [/meditech/i],
  nextgen: [/nextgen/i],
  eclinicalworks: [/eclinicalworks/i, /ecw/i],
  unknown: []
};

export class BrowserManager extends EventEmitter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private activePage: Page | null = null;
  private connection: BrowserConnection | null = null;
  private pageMap: Map<string, Page> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;

  constructor() {
    super();
  }

  /**
   * Connect to an existing browser instance via WebSocket endpoint
   */
  async connect(wsEndpoint: string): Promise<BrowserConnection> {
    try {
      // Disconnect existing connection first
      if (this.browser) {
        await this.disconnect();
      }

      // Connect to browser via CDP
      this.browser = await chromium.connectOverCDP(wsEndpoint);
      this.context = this.browser.contexts()[0] || await this.browser.newContext();

      // Set up page tracking
      await this.initializePageTracking();

      // Create connection info
      this.connection = {
        id: `conn_${Date.now()}`,
        wsEndpoint,
        isConnected: true,
        browserType: 'chromium',
        pageCount: this.context.pages().length,
        createdAt: Date.now(),
        lastActivity: Date.now()
      };

      this.reconnectAttempts = 0;

      this.emit('event', {
        kind: 'connected',
        connection: this.connection
      } as OrchestratorEvent);

      return this.connection;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.emit('event', {
        kind: 'error',
        message: `Failed to connect: ${message}`,
        details: error
      } as OrchestratorEvent);
      throw error;
    }
  }

  /**
   * Launch a new browser instance (for development/testing)
   */
  async launch(options?: {
    headless?: boolean;
    devtools?: boolean;
  }): Promise<BrowserConnection> {
    try {
      if (this.browser) {
        await this.disconnect();
      }

      this.browser = await chromium.launch({
        headless: options?.headless ?? false,
        devtools: options?.devtools ?? true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars'
        ]
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1920, height: 1080 }
      });

      await this.initializePageTracking();

      this.connection = {
        id: `conn_${Date.now()}`,
        wsEndpoint: this.browser.wsEndpoint(),
        isConnected: true,
        browserType: 'chromium',
        pageCount: this.context.pages().length,
        createdAt: Date.now(),
        lastActivity: Date.now()
      };

      this.emit('event', {
        kind: 'connected',
        connection: this.connection
      } as OrchestratorEvent);

      return this.connection;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.emit('event', {
        kind: 'error',
        message: `Failed to launch browser: ${message}`,
        details: error
      } as OrchestratorEvent);
      throw error;
    }
  }

  /**
   * Disconnect from the browser
   */
  async disconnect(): Promise<void> {
    try {
      if (this.browser) {
        await this.browser.close();
      }
    } catch {
      // Ignore close errors
    } finally {
      this.browser = null;
      this.context = null;
      this.activePage = null;
      this.pageMap.clear();

      if (this.connection) {
        this.connection.isConnected = false;
      }

      this.emit('event', {
        kind: 'disconnected',
        reason: 'Manual disconnect'
      } as OrchestratorEvent);
    }
  }

  /**
   * Get the active page
   */
  getActivePage(): Page | null {
    return this.activePage;
  }

  /**
   * Get page info for the active page
   */
  async getActivePageInfo(): Promise<PageInfo | null> {
    if (!this.activePage) return null;

    const url = this.activePage.url();
    const title = await this.activePage.title();
    const ehrType = this.detectEhrType(url, title);

    return {
      id: this.getPageId(this.activePage),
      url,
      title,
      isActive: true,
      ehrType
    };
  }

  /**
   * Get all pages
   */
  async getAllPages(): Promise<PageInfo[]> {
    if (!this.context) return [];

    const pages = this.context.pages();
    const pageInfos: PageInfo[] = [];

    for (const page of pages) {
      const url = page.url();
      const title = await page.title().catch(() => 'Untitled');
      const ehrType = this.detectEhrType(url, title);

      pageInfos.push({
        id: this.getPageId(page),
        url,
        title,
        isActive: page === this.activePage,
        ehrType
      });
    }

    return pageInfos;
  }

  /**
   * Switch to a specific page
   */
  async switchToPage(pageId: string): Promise<PageInfo | null> {
    const page = this.pageMap.get(pageId);
    if (!page) return null;

    this.activePage = page;
    await page.bringToFront();

    const pageInfo = await this.getActivePageInfo();
    if (pageInfo) {
      this.emit('event', {
        kind: 'page-changed',
        page: pageInfo
      } as OrchestratorEvent);
    }

    this.updateActivity();
    return pageInfo;
  }

  /**
   * Navigate to a URL
   */
  async navigate(url: string): Promise<void> {
    if (!this.activePage) {
      throw new Error('No active page');
    }

    await this.activePage.goto(url, { waitUntil: 'domcontentloaded' });
    this.updateActivity();

    const pageInfo = await this.getActivePageInfo();
    if (pageInfo) {
      this.emit('event', {
        kind: 'page-changed',
        page: pageInfo
      } as OrchestratorEvent);
    }
  }

  /**
   * Get connection status
   */
  getConnection(): BrowserConnection | null {
    return this.connection;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.browser?.isConnected() ?? false;
  }

  // ============================================
  // Private Methods
  // ============================================

  private async initializePageTracking(): Promise<void> {
    if (!this.context) return;

    // Track existing pages
    const pages = this.context.pages();
    for (const page of pages) {
      this.trackPage(page);
    }

    // Set active page to the first one
    if (pages.length > 0) {
      this.activePage = pages[0];
    }

    // Listen for new pages
    this.context.on('page', (page) => {
      this.trackPage(page);
      this.activePage = page;
    });

    // Listen for disconnection
    this.browser?.on('disconnected', () => {
      this.handleDisconnection();
    });
  }

  private trackPage(page: Page): void {
    const pageId = this.getPageId(page);
    this.pageMap.set(pageId, page);

    page.on('close', () => {
      this.pageMap.delete(pageId);
      if (this.activePage === page) {
        // Switch to another page
        const remaining = this.context?.pages() ?? [];
        this.activePage = remaining[0] ?? null;
      }
    });

    // Track navigation
    page.on('framenavigated', async (frame) => {
      if (frame === page.mainFrame()) {
        const pageInfo = await this.getActivePageInfo();
        if (pageInfo && page === this.activePage) {
          this.emit('event', {
            kind: 'page-changed',
            page: pageInfo
          } as OrchestratorEvent);
        }
      }
    });
  }

  private getPageId(page: Page): string {
    // Use a stable identifier based on the page's internal ID
    return `page_${page.url().replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50)}_${Date.now()}`;
  }

  private detectEhrType(url: string, title: string): EhrType {
    const combined = `${url} ${title}`.toLowerCase();

    for (const [ehrType, patterns] of Object.entries(EHR_PATTERNS)) {
      if (ehrType === 'unknown') continue;
      for (const pattern of patterns) {
        if (pattern.test(combined)) {
          return ehrType as EhrType;
        }
      }
    }

    return 'unknown';
  }

  private handleDisconnection(): void {
    this.connection = null;
    this.browser = null;
    this.context = null;
    this.activePage = null;
    this.pageMap.clear();

    this.emit('event', {
      kind: 'disconnected',
      reason: 'Browser disconnected'
    } as OrchestratorEvent);
  }

  private updateActivity(): void {
    if (this.connection) {
      this.connection.lastActivity = Date.now();
    }
  }
}

// Singleton instance
let browserManager: BrowserManager | null = null;

export function getBrowserManager(): BrowserManager {
  if (!browserManager) {
    browserManager = new BrowserManager();
  }
  return browserManager;
}
