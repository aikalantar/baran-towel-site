import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { spawn } from "node:child_process";
import { passwordHash } from "../src/auth.js";

// Keep passwords and repository tokens out of shell history, source control and output.
async function question(label, hidden = false) {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const prompt = createInterface({
    input: process.stdin,
    output,
    terminal: process.stdin.isTTY,
  });
  process.stdout.write(label);
  muted = hidden;
  try {
    return (await prompt.question("")).trim();
  } finally {
    prompt.close();
    if (hidden) process.stdout.write("\n");
  }
}
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
console.log(
  "CMS account setup. Values are stored only in the ignored .cms-local directory.",
);
const username = await question(
  "Username (English letters/numbers, e.g. owner): ",
);
if (!/^[a-zA-Z0-9_.-]{2,50}$/.test(username))
  throw new Error("Invalid username.");
const name = (await question("Display name: ")) || username;
const role = (await question("Role: admin or editor [admin]: ")) || "admin";
if (!["admin", "editor"].includes(role)) throw new Error("Invalid role.");
const password = await question(
  "Password (at least 16 characters, hidden): ",
  true,
);
if (password.length < 16 || password.length > 200)
  throw new Error("Password must contain 16 to 200 characters.");
if ((await question("Repeat password (hidden): ", true)) !== password)
  throw new Error("Passwords do not match.");
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
const token = await question(
  "GitHub fine-grained token (hidden; Enter keeps existing): ",
  true,
);
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
if (process.argv.includes("--deploy")) {
  if (!config.CMS_GITHUB_TOKEN)
    throw new Error("Configure a repository Contents read/write token first.");
  const wrangler = path.resolve("node_modules/wrangler/bin/wrangler.js");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wrangler, "secret", "bulk", file], {
      stdio: "inherit",
    });
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
