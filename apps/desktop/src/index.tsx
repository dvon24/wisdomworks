/**
 * @wisdomworks/desktop — Tauri v2 Desktop Agent (Epic 5)
 *
 * Stories 5.1-5.4:
 * - Tauri app shell rendering web dashboard in WebView
 * - Desktop chat window (lightweight, always-on-top option)
 * - Terminal channel for programmatic agent commands
 * - Cross-channel unified logging (web, desktop, WhatsApp, voice)
 *
 * Full Tauri initialization requires Rust toolchain.
 * This scaffold defines the TypeScript-side interfaces.
 */

// Story 5.1 — App Shell
export interface DesktopAppConfig {
  windowTitle: string;
  defaultUrl: string; // web dashboard URL
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  startOnLogin: boolean;
  systemTray: boolean;
}

export const DEFAULT_DESKTOP_CONFIG: DesktopAppConfig = {
  windowTitle: 'WisdomWorks',
  defaultUrl: 'http://localhost:3000',
  width: 1440,
  height: 900,
  minWidth: 1024,
  minHeight: 768,
  startOnLogin: false,
  systemTray: true,
};

// Story 5.2 — Chat Window
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  channel: 'desktop_chat';
}

// Story 5.3 — Terminal Channel
export interface TerminalCommand {
  input: string;
  output: string;
  exitCode: number;
  executedAt: string;
}

// Story 5.4 — Cross-Channel Context
export interface ChannelContext {
  activeChannels: string[];
  lastInteraction: Record<string, string>; // channel → timestamp
  conversationContinuity: boolean;
  notificationDedup: boolean;
}

export {};
