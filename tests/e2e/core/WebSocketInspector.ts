import type { CDPSession, Page } from '@playwright/test';
import type { WSMessage } from './types';

export class WebSocketInspector {
  private cdp: CDPSession | null = null;
  private messages: WSMessage[] = [];
  private wsRequestId: string | null = null;
  private enabled = false;

  async attach(page: Page): Promise<void> {
    this.messages = [];
    this.wsRequestId = null;

    try {
      this.cdp = await page.context().newCDPSession(page);
      await this.cdp.send('Network.enable');
      this.enabled = true;
    } catch {
      this.enabled = false;
      this.cdp = null;
      return;
    }

    this.cdp.on('Network.webSocketCreated', (params) => {
      if (params.url.includes('/ws')) {
        this.wsRequestId = params.requestId;
      }
    });

    this.cdp.on('Network.webSocketFrameSent', (params) => {
      if (params.requestId !== this.wsRequestId) return;
      const data = this.parsePayload(params.response.payloadData);
      this.messages.push({ direction: 'sent', data, timestamp: Date.now() });
    });

    this.cdp.on('Network.webSocketFrameReceived', (params) => {
      if (params.requestId !== this.wsRequestId) return;
      const data = this.parsePayload(params.response.payloadData);
      this.messages.push({ direction: 'received', data, timestamp: Date.now() });
    });
  }

  getMessages(): WSMessage[] {
    return [...this.messages];
  }

  getSentMessages(): WSMessage[] {
    return this.messages.filter((msg) => msg.direction === 'sent');
  }

  getReceivedMessages(): WSMessage[] {
    return this.messages.filter((msg) => msg.direction === 'received');
  }

  findMessage(predicate: (msg: any) => boolean): WSMessage | undefined {
    return this.messages.find((msg) => predicate(msg.data));
  }

  waitForMessage(
    predicate: (msg: any) => boolean,
    timeout: number = 5000,
    interval: number = 50
  ): Promise<WSMessage> {
    const startTime = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const match = this.findMessage(predicate);
        if (match) {
          resolve(match);
          return;
        }

        if (Date.now() - startTime > timeout) {
          reject(new Error('Timeout waiting for WebSocket message'));
          return;
        }

        setTimeout(check, interval);
      };

      check();
    });
  }

  async detach(): Promise<void> {
    if (this.cdp) {
      await this.cdp.detach();
      this.cdp = null;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private parsePayload(payload: string): any {
    try {
      return JSON.parse(payload);
    } catch {
      return payload;
    }
  }
}
