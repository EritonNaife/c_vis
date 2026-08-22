import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { parseMiLine, miQuote } from './mi.js';

const OPERATION_RE = /^(sa|sb|ss|pa|pb|ra|rb|rr|rra|rrb|rrr)$/;
const PUSH_SWAP_TRACE_SKIP_FILES = ['src/utils.c', 'src/print_numbers.c', 'src/benchmark.c'];
const PUSH_SWAP_TRACE_SKIP_FUNCTIONS = [
  'ft_strlen',
  'ft_strcmp',
  'ft_isspace',
  'ft_isdigit',
  'ft_putstr_fd',
  'ft_putnbr_fd',
  'ft_put_percent_fd'
];

function unwrapList(value, key) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => entry?.[key] ?? entry).filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function executionTimeout(command, timeoutMs) {
  const error = new Error(`Timed out waiting for the debugged program to stop after ${timeoutMs}ms`);
  error.code = 'EXEC_TIMEOUT';
  error.command = command;
  return error;
}

export class GdbClient extends EventEmitter {
  constructor({ cwd, executable, args = [], adapterScript = null, stopTimeoutMs = 30000 }) {
    super();
    this.cwd = cwd;
    this.executable = executable;
    this.args = args;
    this.adapterScript = adapterScript;
    this.stopTimeoutMs = stopTimeoutMs;
    this.proc = null;
    this.buffer = '';
    this.token = 1;
    this.pending = new Map();
    this.stopWaiters = [];
    this.consoleLines = [];
    this.targetLines = [];
    this.lastStop = null;
    this.lastPushSwap = null;
    this.gdbExited = false;
    this.inferiorExited = false;
    this.running = false;
  }

  async start() {
    this.proc = spawn('gdb', ['--quiet', '--nx', '--interpreter=mi2'], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this.#onData(chunk));
    this.proc.stderr.on('data', (chunk) => this.emit('stderr', chunk));
    this.proc.on('exit', (code, signal) => {
      this.gdbExited = true;
      this.running = false;
      const error = new Error(`GDB exited (${code ?? signal ?? 'unknown'})`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      for (const waiter of this.stopWaiters.splice(0)) waiter.resolve({ reason: 'gdb-exited' });
    });

    await this.command('-gdb-set pagination off');
    await this.command('-gdb-set confirm off');
    await this.command('-gdb-set print pretty on');
    await this.command(`-environment-cd ${miQuote(this.cwd)}`);
    await this.command(`-file-exec-and-symbols ${miQuote(this.executable)}`);
    if (this.args.length) await this.command(`-exec-arguments ${this.args.map(miQuote).join(' ')}`);
    if (this.adapterScript) {
      await this.command(`-interpreter-exec console ${miQuote(`source ${this.adapterScript}`)}`);
      // Source-level tracing should show the target's decisions, not spend a
      // step on the output/formatting helpers called by every operation.
      // GDB's skip list keeps `-exec-step` inside the algorithm while stepping
      // over these helper calls reliably (including libc calls they make).
      for (const file of PUSH_SWAP_TRACE_SKIP_FILES) {
        await this.command(`-interpreter-exec console ${miQuote(`skip file ${file}`)}`);
      }
      for (const func of PUSH_SWAP_TRACE_SKIP_FUNCTIONS) {
        await this.command(`-interpreter-exec console ${miQuote(`skip function ${func}`)}`);
      }
    }
    await this.command('-break-insert main');
    await this.exec('-exec-run');
    return this.snapshot();
  }

  command(command, timeoutMs = 10000) {
    if (!this.proc || this.gdbExited) return Promise.reject(new Error('GDB is not running'));
    const token = this.token++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(token);
        reject(new Error(`GDB command timed out: ${command}`));
      }, timeoutMs);
      this.pending.set(token, {
        resolve: (record) => { clearTimeout(timer); resolve(record); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      this.proc.stdin.write(`${token}${command}\n`);
    });
  }

  async exec(command, timeoutMs = this.stopTimeoutMs) {
    if (this.inferiorExited) return { reason: 'exited' };
    const stopPromise = this.#waitForStop(command, timeoutMs);
    const result = await this.command(command);
    if (!['running', 'done'].includes(result.class)) throw new Error(`Unexpected GDB result: ${result.class}`);
    try {
      return await stopPromise;
    } catch (error) {
      if (error.code === 'EXEC_TIMEOUT') {
        await this.#recoverFromTimeout();
        error.recovered = !this.running;
      }
      throw error;
    }
  }

  async action(name) {
    const commands = { next: '-exec-next', step: '-exec-step', finish: '-exec-finish', continue: '-exec-continue' };
    if (!commands[name]) throw new Error(`Unknown debugger action: ${name}`);
    await this.exec(commands[name]);
    return this.snapshot();
  }

  async interrupt() {
    if (!this.proc || this.gdbExited || this.inferiorExited || !this.running) return;
    try {
      await this.command('-exec-interrupt', 3000);
    } catch (error) {
      if (this.running) throw error;
    }
  }

  async snapshot() {
    if (this.inferiorExited) {
      const pushSwap = this.adapterScript ? await this.#readPushSwapState() : null;
      return {
        status: 'exited',
        stop: this.lastStop,
        frame: null,
        frames: [],
        locals: [],
        targetOutput: this.targetLines.join(''),
        operations: this.#operations(),
        pushSwap: pushSwap ?? this.lastPushSwap
      };
    }

    const [frameRecord, stackRecord, localsRecord] = await Promise.all([
      this.command('-stack-info-frame'),
      this.command('-stack-list-frames 0 12'),
      this.command('-stack-list-variables --simple-values')
    ]);

    const pushSwap = this.adapterScript ? await this.#readPushSwapState() : null;

    return {
      status: 'paused',
      stop: this.lastStop,
      frame: frameRecord.results.frame ?? null,
      frames: unwrapList(stackRecord.results.stack, 'frame'),
      locals: unwrapList(localsRecord.results.variables, 'variable'),
      targetOutput: this.targetLines.join(''),
      operations: this.#operations(),
      pushSwap
    };
  }

  async stop() {
    if (!this.proc) return;
    try {
      if (!this.gdbExited) await this.command('-gdb-exit', 2000);
    } catch {
      this.proc.kill('SIGKILL');
    }
    this.gdbExited = true;
    this.running = false;
  }

  async #readPushSwapState() {
    const startIndex = this.consoleLines.length;
    try {
      await this.command(`-interpreter-exec console ${miQuote('cvis-push-swap-state')}`);
      const added = this.consoleLines.slice(startIndex);
      const stateLine = [...added].reverse().find((line) => line.startsWith('CVIS_PUSH_SWAP_STATE '));
      if (!stateLine) return this.lastPushSwap;
      const state = JSON.parse(stateLine.slice('CVIS_PUSH_SWAP_STATE '.length));
      if (state?.available && state.initialized !== false) this.lastPushSwap = state;
      return state;
    } catch (error) {
      if (this.lastPushSwap) return this.lastPushSwap;
      return { available: false, reason: error.message };
    }
  }

  #operations() {
    return this.targetLines
      .join('')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => OPERATION_RE.test(line));
  }

  #waitForStop(command, timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      const timer = setTimeout(() => {
        const index = this.stopWaiters.indexOf(waiter);
        if (index >= 0) this.stopWaiters.splice(index, 1);
        reject(executionTimeout(command, timeoutMs));
      }, timeoutMs);
      waiter.resolve = (record) => { clearTimeout(timer); resolve(record); };
      this.stopWaiters.push(waiter);
    });
  }

  async #recoverFromTimeout() {
    if (this.gdbExited || this.inferiorExited || !this.running) return;
    try {
      await this.command('-exec-interrupt', 3000);
    } catch {
      if (!this.running) return;
    }
    const deadline = Date.now() + 5000;
    while (this.running && Date.now() < deadline) await sleep(25);
  }

  #appendRawTargetLine(text) {
    if (!text) return;
    this.targetLines.push(text.endsWith('\n') ? text : `${text}\n`);
  }

  #onData(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      const record = parseMiLine(line);
      if (record) this.#handleRecord(record);
    }
  }

  #handleRecord(record) {
    if (record.type === '^' && record.token !== null) {
      const pending = this.pending.get(record.token);
      if (pending) {
        this.pending.delete(record.token);
        if (record.class === 'error') pending.reject(new Error(record.results.msg || 'GDB error'));
        else pending.resolve(record);
      }
      return;
    }
    if (record.type === '*' && record.class === 'running') {
      this.running = true;
      return;
    }
    if (record.type === '*' && record.class === 'stopped') {
      this.running = false;
      this.lastStop = { reason: record.results.reason ?? 'stopped', ...record.results };
      if (String(record.results.reason ?? '').startsWith('exited')) this.inferiorExited = true;
      const waiter = this.stopWaiters.shift();
      if (waiter) waiter.resolve(this.lastStop);
      return;
    }
    if (record.type === '@') {
      this.targetLines.push(record.text);
      return;
    }
    if (record.type === 'raw') {
      this.#appendRawTargetLine(record.text);
      return;
    }
    if (record.type === '~') this.consoleLines.push(record.text.replace(/\r?\n$/, ''));
  }
}
