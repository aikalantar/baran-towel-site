import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { passwordHash } from "../src/auth.js";

// Keep passwords and repository tokens out of shell history, source control and output.
export function createPrompter(input = process.stdin, output = process.stdout) {
  let muted = true;
  let closed = false;
  let cancelled = false;
  let pending = null;
  const lines = [];
  const terminal = input.isTTY === true;
  const quietOutput = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) output.write(chunk, encoding);
      callback();
    },
  });
  Object.defineProperty(quietOutput, "columns", {
    get: () => output.columns || 80,
  });
  // One interface owns stdin for the entire form. Closing it after each answer
  // loses buffered/pasted lines and repeatedly resets the Windows console mode.
  const prompt = createInterface({
    input,
    output: quietOutput,
    terminal,
    crlfDelay: Infinity,
    historySize: 0,
  });
  const inputError = () =>
    Object.assign(
      new Error(
        cancelled
          ? "CMS setup cancelled."
          : "Input ended before setup was complete. Run again in CMD or PowerShell and answer every prompt.",
      ),
      { code: "CMS_SETUP_INPUT", exitCode: cancelled ? 130 : 1 },
    );
  prompt.on("line", (line) => {
    // Suppress any characters pasted ahead of the next prompt, including secrets.
    muted = true;
    if (closed) return;
    if (pending) {
      const { resolve } = pending;
      pending = null;
      resolve(line);
    } else lines.push(line);
  });
  prompt.on("close", () => {
    closed = true;
    muted = true;
    if (pending) {
      pending.reject(inputError());
      pending = null;
    }
  });
  prompt.on("SIGINT", () => {
    cancelled = true;
    lines.length = 0;
    output.write("\n");
    prompt.close();
  });
  prompt.on("error", () => {
    lines.length = 0;
    prompt.close();
  });

  return {
    async question(label, { hidden = false, trim = true, validate } = {}) {
      while (true) {
        if (cancelled || (closed && !lines.length)) throw inputError();
        const buffered = lines.length > 0;
        prompt.setPrompt(label);
        muted = hidden || buffered;
        output.write(label);
        let answer;
        try {
          answer = buffered
            ? lines.shift()
            : await new Promise((resolve, reject) => {
                pending = { resolve, reject };
              });
        } finally {
          muted = true;
          if (hidden || buffered || !terminal) output.write("\n");
        }
        if (trim) answer = answer.trim();
        const error = validate?.(answer);
        if (!error) return answer;
        output.write(`${error} Please try again.\n`);
      }
    },
    close() {
      lines.length = 0;
      prompt.close();
    },
  };
}

async function main() {
  const directory = path.resolve(".cms-local");
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, "secrets.json");
  let config;
  try {
    config = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    config = {};
  }
  const users = JSON.parse(config.CMS_USERS || "[]");
  const deploy = process.argv.includes("--deploy");
  console.log(
    "CMS account setup. Values are stored only in the ignored .cms-local directory.",
  );
  const prompter = createPrompter();
  let username, name, role, password, token;
  try {
    username = await prompter.question(
      "Username (English letters/numbers, e.g. owner): ",
      {
        validate: (value) =>
          /^[a-zA-Z0-9_.-]{2,50}$/.test(value) ? null : "Invalid username.",
      },
    );
    name = (await prompter.question("Display name: ")) || username;
    role =
      (
        await prompter.question("Role: admin or editor [admin]: ", {
          validate: (value) =>
            !value || ["admin", "editor"].includes(value.toLowerCase())
              ? null
              : "Invalid role.",
        })
      ).toLowerCase() || "admin";
    password = await prompter.question(
      "Password (at least 16 characters, hidden): ",
      {
        hidden: true,
        trim: false,
        validate: (value) =>
          value.trim().length >= 16 && value.length <= 200
            ? null
            : "Password must contain 16 to 200 characters.",
      },
    );
    await prompter.question("Repeat password (hidden): ", {
      hidden: true,
      trim: false,
      validate: (value) =>
        value === password ? null : "Passwords do not match.",
    });
    token = await prompter.question(
      "GitHub fine-grained token (hidden; Enter keeps existing): ",
      {
        hidden: true,
        validate: (value) =>
          /\s/.test(value)
            ? "GitHub token must not contain whitespace."
            : deploy && !value && !config.CMS_GITHUB_TOKEN
              ? "A GitHub token is required for --deploy."
              : null,
      },
    );
  } finally {
    // Restore normal console input before hashing, writing secrets or Wrangler.
    prompter.close();
  }
  const salt = randomBytes(24).toString("base64");
  const user = {
    username,
    name,
    role,
    salt,
    hash: await passwordHash(password, salt),
  };
  const updated = users.filter((u) => u.username !== username);
  updated.push(user);
  config.CMS_USERS = JSON.stringify(updated);
  config.CMS_SESSION_SECRET ||= randomBytes(48).toString("base64");
  if (token) config.CMS_GITHUB_TOKEN = token;
  await fs.writeFile(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  await fs.writeFile(
    ".dev.vars",
    Object.entries(config)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  console.log(
    `Account ${username} configured with role ${role}. Secret values were not printed.`,
  );
  if (deploy) {
    const wrangler = path.resolve("node_modules/wrangler/bin/wrangler.js");
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [wrangler, "secret", "bulk", file],
        {
          stdio: "inherit",
        },
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                "Uploading secrets failed. Local configuration is retained.",
              ),
            ),
      );
    });
    console.log(
      "Cloudflare secrets uploaded. Repeat setup to add another account or change a password.",
    );
  } else
    console.log(
      "For production, run npm run cms:setup -- --deploy when Cloudflare login is available.",
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    await main();
  } catch (error) {
    if (error.code !== "CMS_SETUP_INPUT") throw error;
    console.error(error.message);
    process.exitCode = error.exitCode;
  }
}
