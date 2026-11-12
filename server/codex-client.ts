import { execFileSync } from 'node:child_process';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

type JsonObject = Record<string, unknown>;
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

type RpcMessage = {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
  method?: string;
  params?: unknown;
};

const REQUEST_TIMEOUT_MS = 15_000;

function findCodexBinary(): string {
  if (process.env.CODEX_BINARY) return process.env.CODEX_BINARY;
  if (process.platform !== 'win32') return 'codex';

  try {
    const result = execFileSync('where.exe', ['codex'], { encoding: 'utf8', windowsHide: true });
    const candidate = result
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line.toLowerCase().endsWith('codex.exe'));
    if (candidate) return candidate;
  } catch {
    // Continue with the stable installer location and Windows command resolver.
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const installedBinary = join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
    if (existsSync(installedBinary)) return installedBinary;
  }

  try {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const resolved = execFileSync(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command', '(Get-Command codex -ErrorAction Stop).Source'],
      { encoding: 'utf8', windowsHide: true }
    ).trim();
    if (resolved && existsSync(resolved)) return resolved;
  } catch {
    // The startup error below includes the supported manual override.
  }

  throw new Error('Codex wurde nicht gefunden. Installiere die Codex CLI oder setze CODEX_BINARY auf den Pfad zu codex.exe.');
}

export class CodexClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private stderrTail: string[] = [];
  private starting: Promise<void> | null = null;
  private notificationListeners = new Set<(method: string, params: unknown) => void>();

  async start(): Promise<void> {
    if (this.process) return;
    if (this.starting) return this.starting;
    this.starting = this.startInternal();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async startInternal(): Promise<void> {
    const binary = findCodexBinary();
    const child = spawn(binary, ['app-server', '--stdio'], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.process = child;

    createInterface({ input: child.stdout }).on('line', line => this.handleLine(line));
    createInterface({ input: child.stderr }).on('line', line => {
      this.stderrTail.push(line);
      this.stderrTail = this.stderrTail.slice(-20);
    });

    child.once('error', error => this.handleExit(error));
    child.once('exit', (code, signal) => {
      const details = this.stderrTail.join('\n').trim();
      const suffix = details ? `\n${details}` : '';
      this.handleExit(new Error(`Codex App-Server wurde beendet (${signal ?? code ?? 'unbekannt'}).${suffix}`));
    });

    await this.request('initialize', {
      clientInfo: { name: 'workbench', title: 'Workbench', version: '0.1.0' },
      capabilities: { experimentalApi: true }
    });
    this.notify('initialized');
  }

  async request<T>(method: string, params: JsonObject = {}): Promise<T> {
    if (!this.process) throw new Error('Codex App-Server ist nicht gestartet.');
    const id = this.nextId++;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Zeitüberschreitung bei Codex-Anfrage: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: JsonObject): void {
    this.write(params ? { method, params } : { method });
  }

  stop(): void {
    const child = this.process;
    this.process = null;
    child?.kill();
  }

  onNotification(listener: (method: string, params: unknown) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  private write(message: RpcMessage): void {
    if (!this.process?.stdin.writable) throw new Error('Codex App-Server ist nicht erreichbar.');
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return;
    }
    if (typeof message.id !== 'number') {
      if (message.method) {
        for (const listener of this.notificationListeners) listener(message.method, message.params);
      }
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message ?? 'Unbekannter Codex-Fehler'));
    } else {
      pending.resolve(message.result);
    }
  }

  private handleExit(error: Error): void {
    this.process = null;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}
