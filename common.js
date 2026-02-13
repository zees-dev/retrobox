// ============================================
// P2P Protocol Constants
// ============================================
export const P2P_PING = 0;
export const P2P_DIGITAL = 1;
export const P2P_ANALOG = 2;
export const P2P_TOGGLE_FPS = 3;
export const P2P_SAVE_STATE = 4;
export const P2P_LOAD_STATE = 5;
export const P2P_RESET_MENU = 6;
export const P2P_HARD_REFRESH = 7;
export const P2P_STATE_UPDATE = 129;
export const P2P_RTT_ECHO = 128;

export const P2P_STATES = ['game-selection', 'game-pending', 'game-ready'];

// ============================================
// Resolution Options per Core
// ============================================
export const RESOLUTION_OPTIONS = {
    psx: {
        key: 'pcsx_rearmed_neon_enhancement_enable',
        options: [
            { label: '1x (Native)', value: 'disabled' },
            { label: '2x', value: 'enabled' },
        ],
        default: 'disabled'
    },
    mednafen_psx_hw: {
        key: 'beetle_psx_hw_internal_resolution',
        options: [
            { label: '1x (Native)', value: '1x(native)' },
            { label: '2x', value: '2x' },
            { label: '4x', value: '4x' },
            { label: '8x', value: '8x' },
            { label: '16x', value: '16x' },
        ],
        default: '2x'
    },
    n64: {
        key: 'mupen64plus-43screensize',
        options: [
            { label: '240p (Native)', value: '320x240' },
            { label: '480p', value: '640x480' },
            { label: '720p', value: '960x720' },
            { label: '960p', value: '1280x960' },
            { label: '1440p', value: '1920x1440' },
        ],
        default: '320x240'
    },
};
// Core aliases
RESOLUTION_OPTIONS.pcsx_rearmed = RESOLUTION_OPTIONS.psx;
RESOLUTION_OPTIONS.mupen64plus_next = RESOLUTION_OPTIONS.n64;

// ============================================
// Timing Constants
// ============================================
export const HEARTBEAT_INTERVAL = 3000;
export const RECONNECT_DELAY = 2000;

// ============================================
// WebSocket URL Helper
// ============================================
export function getWebSocketUrl() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/ws`;
}

// ============================================
// WebSocket Manager
// ============================================
export class WebSocketManager {
    constructor(handlers) {
        this.ws = null;
        this.heartbeatInterval = null;
        this.handlers = handlers; // { onOpen, onMessage, onClose, onError }
    }

    connect() {
        if (this.ws?.readyState === WebSocket.OPEN) return;
        this.ws = new WebSocket(getWebSocketUrl());

        this.ws.onopen = () => {
            this.startHeartbeat();
            this.handlers.onOpen?.();
        };

        this.ws.onmessage = e => this.handlers.onMessage?.(JSON.parse(e.data));

        this.ws.onclose = () => {
            this.stopHeartbeat();
            this.handlers.onClose?.();
            setTimeout(() => this.connect(), RECONNECT_DELAY);
        };

        this.ws.onerror = err => this.handlers.onError?.(err);
    }

    send(msg) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            this.send({ type: 'heartbeat' });
        }, HEARTBEAT_INTERVAL);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    disconnect() {
        this.stopHeartbeat();
        this.ws?.close();
        this.ws = null;
    }

    get isOpen() {
        return this.ws?.readyState === WebSocket.OPEN;
    }
}

// ============================================
// ICE Candidate Buffer
// ============================================
export class IceCandidateBuffer {
    constructor() {
        this.buffer = [];
        this.remoteDescSet = false;
    }

    add(candidate, pc) {
        if (this.remoteDescSet) {
            pc.addIceCandidate(candidate).catch(() => {});
        } else {
            this.buffer.push(candidate);
        }
    }

    flush(pc) {
        this.remoteDescSet = true;
        this.buffer.forEach(c => pc.addIceCandidate(c).catch(() => {}));
        this.buffer = [];
    }

    reset() {
        this.buffer = [];
        this.remoteDescSet = false;
    }
}

// ============================================
// Game Menu Loader
// ============================================
export async function loadGameMenuComponent(onGameStart, onResetToMenu) {
    try {
        const res = await fetch('game-menu.html');
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const script = doc.querySelector('script[type="module"]');
        if (script) {
            const el = document.createElement('script');
            el.type = 'module';
            el.textContent = script.textContent;
            document.head.appendChild(el);
            await customElements.whenDefined('game-menu');
            const gameMenu = document.getElementById('gameMenu');
            if (onGameStart) gameMenu?.addEventListener('gamestart', e => onGameStart(e.detail));
            if (onResetToMenu) gameMenu?.addEventListener('resetToMenu', () => onResetToMenu());
            return gameMenu;
        }
    } catch(e) { console.error('Failed to load game menu:', e); }
    return null;
}
