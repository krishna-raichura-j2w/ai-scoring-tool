// Lightweight structured logger for backend processes — zero dependencies.
//
//   import { logger } from "./log.js";
//   const log = logger("resume");
//   log.info("scoring started", { id });
//   const done = log.step("AI scoreResume", { id });   // logs "→ ..."
//   ... await work ...
//   done({ score });                                   // logs "✓ ... ms=1234 score=87"
//
// Verbosity is controlled by LOG_LEVEL (debug | info | warn | error; default info).
// Colors auto-disable when stdout is not a TTY or NO_COLOR is set.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[String(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LEVELS.info;
const useColor = !!process.stdout.isTTY && process.env.NO_COLOR == null;

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m",
  gray: "\x1b[90m", red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", magenta: "\x1b[35m", cyan: "\x1b[36m",
};
const paint = (s, c) => (useColor ? c + s + C.reset : s);
const LEVEL_COLOR = { debug: C.gray, info: C.cyan, warn: C.yellow, error: C.red };

function ts() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function fmtMeta(meta) {
  if (!meta || typeof meta !== "object") return "";
  const parts = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  return parts.length ? " " + paint(parts.join(" "), C.dim) : "";
}

function emit(level, scope, msg, meta) {
  if (LEVELS[level] < threshold) return;
  const tag = paint(level.toUpperCase().padEnd(5), LEVEL_COLOR[level]);
  const scopeStr = scope ? paint(`[${scope}]`, C.magenta) + " " : "";
  const line = `${paint(ts(), C.gray)} ${tag} ${scopeStr}${msg}${fmtMeta(meta)}`;
  (level === "error" ? console.error : console.log)(line);
}

function make(scope) {
  return {
    debug: (msg, meta) => emit("debug", scope, msg, meta),
    info: (msg, meta) => emit("info", scope, msg, meta),
    warn: (msg, meta) => emit("warn", scope, msg, meta),
    error: (msg, meta) => emit("error", scope, msg, meta),
    // Log the start of a unit of work and return a done() that logs elapsed ms.
    step(msg, meta) {
      const start = Date.now();
      emit("info", scope, "→ " + msg, meta);
      return (doneMeta) => {
        const ms = Date.now() - start;
        emit("info", scope, "✓ " + msg, { ms, ...doneMeta });
        return ms;
      };
    },
    child: (sub) => make(scope ? `${scope}:${sub}` : sub),
  };
}

export const logger = (scope = "") => make(scope);
export const log = make("app");
