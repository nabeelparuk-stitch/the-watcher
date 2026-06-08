import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type CheckoutReportPaymentMethod = {
  position: number;
  label: string;
  is_stitch_express?: boolean;
};

export type SheetsAppendMeta =
  | { ok: true; spreadsheetId: string; sheetName: string; updatedRange?: string }
  | { ok: false; error: string };

export type CheckoutReport = {
  input_url: string;
  status: string;
  verdict: string;
  stitch_express_is_top?: boolean | null;
  stitch_express_signature?: string;
  first_payment_method_text?: string | null;
  payment_methods?: string[];
  payment_methods_found?: CheckoutReportPaymentMethod[];
  stitch_index?: number;
  payment_method_count?: number;
  step?: string;
  error_message?: string | null;
  final_url?: string;
  product_url?: string | null;
  duration_ms?: number;
  checked_at: string;
  sheets_append?: SheetsAppendMeta;
};

function resolveCheckoutWorkerDir(): string {
  const fromEnv = process.env.CHECKOUT_WORKER_DIR;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return path.resolve(fromEnv);
  }
  const candidates = [
    path.resolve(process.cwd(), "../checkout-worker"),
    path.resolve(process.cwd(), "apps/checkout-worker"),
    path.resolve(process.cwd(), "../../apps/checkout-worker"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "watcher_checkout", "report.py"))) {
      return dir;
    }
  }
  throw new Error(
    "Checkout worker not found. Set CHECKOUT_WORKER_DIR to apps/checkout-worker."
  );
}

function resolvePlaywrightBrowsersPath(workerDir: string): string {
  const fromEnv = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const projectBrowsers = path.join(workerDir, ".playwright-browsers");
  if (fs.existsSync(projectBrowsers)) {
    return projectBrowsers;
  }
  if (fromEnv && fs.existsSync(fromEnv) && !fromEnv.includes("cursor-sandbox-cache")) {
    return path.resolve(fromEnv);
  }
  return projectBrowsers;
}

function resolvePythonBin(workerDir: string): string {
  const fromEnv = process.env.CHECKOUT_PYTHON;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return path.resolve(fromEnv);
  }
  const venvPython = path.join(workerDir, ".venv", "bin", "python");
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return "python3";
}

export function runCheckoutReport(
  url: string,
  timeoutSeconds: number
): Promise<CheckoutReport> {
  const workerDir = resolveCheckoutWorkerDir();
  const python = resolvePythonBin(workerDir);
  const browsersPath = resolvePlaywrightBrowsersPath(workerDir);
  const maxMs = (timeoutSeconds + 60) * 1000;

  const childEnv: NodeJS.ProcessEnv = { ...process.env, PYTHONUNBUFFERED: "1" };
  childEnv.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
  delete childEnv.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD;

  return new Promise((resolve, reject) => {
    const child = spawn(
      python,
      ["-m", "watcher_checkout.report", url, String(timeoutSeconds)],
      {
        cwd: workerDir,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Checkout report timed out after ${maxMs / 1000}s`));
    }, maxMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const line = stdout.trim().split("\n").pop() ?? "";
      try {
        const parsed = JSON.parse(line) as CheckoutReport;
        resolve(parsed);
        return;
      } catch {
        /* fall through */
      }
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              stdout.trim() ||
              `Checkout worker exited with code ${code ?? "unknown"}`
          )
        );
        return;
      }
      reject(new Error("Checkout worker returned no JSON report"));
    });
  });
}
