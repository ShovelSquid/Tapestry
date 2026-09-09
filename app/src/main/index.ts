/**
 * Electron main process entry point.
 *
 * Plan 02 will wire this up with BrowserWindow creation, menu setup,
 * and IPC handler registration via KernelBridge.registerHandlers().
 * This file exists now so the electron-vite config has a valid entry.
 */

export { KernelBridge } from './kernel-bridge'
