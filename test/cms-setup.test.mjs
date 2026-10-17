import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createPrompter } from "../scripts/cms-setup.mjs";
import { passwordHash } from "../src/auth.js";

const script = fileURLToPath(
  new URL("../scripts/cms-setup.mjs", import.meta.url),
);
const testPassword = "test-only-password-123456789";
const testToken = "github_pat_test_only_not_a_real_token";
const answers = [
  "owner",
  "مدیر باران",
  "admin",
  testPassword,
  testPassword,
  testToken,
];

function terminal() {
  const input = new PassThrough();
  const modes = [];
  input.isTTY = true;
  input.setRawMode = (enabled) => modes.push(enabled);
  let output = "";
  const stream = new Writable({
    write(chunk, encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  stream.isTTY = true;
  stream.columns = 80;
  const prompter = createPrompter(input, stream);
  return { input, modes, prompter, output: () => output };
}

async function runSetup(t, lines = answers, options = {}) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "lux-cms-setup-"));
  t.after(async () => {
    const resolved = path.resolve(cwd);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith("lux-cms-setup-")
    ) {
      throw new Error("Refusing to remove an unexpected fixture directory.");
    }
    await fs.rm(resolved, { recursive: true, force: true });
  });
  if (options.existing) {
    await fs.mkdir(path.join(cwd, ".cms-local"), { recursive: true });
    await fs.writeFile(
      path.join(cwd, ".cms-local/secrets.json"),
      JSON.stringify(options.existing),
    );
  }
  if (options.deploy) {
    // A local stand-in only: never load real Wrangler or contact an online service.
    const bin = path.join(cwd, "node_modules/wrangler/bin");
    await fs.mkdir(bin, { recursive: true });
    await fs.writeFile(
      path.join(bin, "wrangler.js"),
      `
      import fs from "node:fs/promises";
      const args = process.argv.slice(2);
      const config = JSON.parse(await fs.readFile(args[2], "utf8"));
      await fs.writeFile("wrangler-call.json", JSON.stringify({
        args, userCount: JSON.parse(config.CMS_USERS).length,
        tokenConfigured: !!config.CMS_GITHUB_TOKEN,
        sessionSecretLength: config.CMS_SESSION_SECRET.length,
        node: process.version, inputIsTTY: process.stdin.isTTY === true
      }));
      process.exitCode = Number(process.env.FAKE_WRANGLER_EXIT || 0);
    `,
    );
  }
  await fs.writeFile(
    path.join(cwd, "package.json"),
    JSON.stringify({
      name: "cms-setup-regression-fixture",
      private: true,
      type: "module",
      scripts: { "cms:setup": `node "${script}"` },
    }),
  );
  let executable = process.execPath;
  let args = [script, ...(options.deploy ? ["--deploy"] : [])];
  if (options.shell === "cmd") {
    executable = process.env.ComSpec || "cmd.exe";
    args = [
      "/d",
      "/s",
      "/c",
      `npm.cmd run cms:setup${options.deploy ? " -- --deploy" : ""}`,
    ];
  } else if (options.shell === "powershell") {
    executable = "powershell.exe";
    args = [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `npm.cmd run cms:setup${options.deploy ? " -- --deploy" : ""}; exit $LASTEXITCODE`,
    ];
  }
  const child = spawn(executable, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
      FAKE_WRANGLER_EXIT: String(options.deployExit || 0),
    },
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stdin.on("error", () => {});
  const timer = setTimeout(() => child.kill(), 20000);
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
  child.stdin.end(
    lines.length
      ? lines.join(options.eol || "\r\n") +
          (options.finalEol === false ? "" : options.eol || "\r\n")
      : "",
  );
  let code;
  try {
    code = await exit;
  } finally {
    clearTimeout(timer);
  }
  const config = await fs
    .readFile(path.join(cwd, ".cms-local/secrets.json"), "utf8")
    .then(JSON.parse, () => null);
  const vars = await fs
    .readFile(path.join(cwd, ".dev.vars"), "utf8")
    .catch(() => null);
  const deployCall = await fs
    .readFile(path.join(cwd, "wrangler-call.json"), "utf8")
    .then(JSON.parse, () => null);
  return { code, output, config, vars, deployCall, cwd };
}

test("TTY input is preserved across prompts and hidden values never echo", async () => {
  const io = terminal();
  try {
    const visible = io.prompter.question("Username: ");
    io.input.write("owner\r\n");
    assert.equal(await visible, "owner");
    const password = io.prompter.question("Password: ", {
      hidden: true,
      trim: false,
    });
    io.input.write(testPassword + "\r\n");
    assert.equal(await password, testPassword);
    const token = io.prompter.question("Token: ", { hidden: true });
    io.input.write(testToken + "\r\n");
    assert.equal(await token, testToken);
    assert.ok(io.output().includes("owner"));
    assert.ok(!io.output().includes(testPassword), "password must not echo");
    assert.ok(!io.output().includes(testToken), "token must not echo");
  } finally {
    io.prompter.close();
  }
  assert.deepEqual(io.modes, [true, false]);
});

test("multiline TTY paste is queued without echoing future secrets", async () => {
  const io = terminal();
  try {
    const first = io.prompter.question("Username: ");
    io.input.write(`owner\r\n${testPassword}\r\n${testToken}\r\n`);
    assert.equal(await first, "owner");
    assert.equal(
      await io.prompter.question("Password: ", { hidden: true }),
      testPassword,
    );
    assert.equal(
      await io.prompter.question("Token: ", { hidden: true }),
      testToken,
    );
    assert.ok(
      !io.output().includes(testPassword),
      "pasted password must not echo",
    );
    assert.ok(!io.output().includes(testToken), "pasted token must not echo");
  } finally {
    io.prompter.close();
  }
});

test("split Windows CRLF does not create a phantom empty answer", async () => {
  const io = terminal();
  try {
    const first = io.prompter.question("Username: ");
    io.input.write("owner\r");
    assert.equal(await first, "owner");
    const next = io.prompter.question("Password: ", { hidden: true });
    await new Promise((resolve) => setTimeout(resolve, 160));
    io.input.write(`\n${testPassword}\r\n`);
    assert.equal(await next, testPassword);
  } finally {
    io.prompter.close();
  }
});

test("hidden entries are not recoverable through readline history", async () => {
  const io = terminal();
  try {
    const hidden = io.prompter.question("Password: ", { hidden: true });
    io.input.write(testPassword + "\r");
    await hidden;
    const visible = io.prompter.question("Visible: ");
    io.input.write("\u001b[A\r");
    assert.equal(await visible, "");
    assert.ok(!io.output().includes(testPassword));
  } finally {
    io.prompter.close();
  }
});

test("hidden TTY fields retain normal backspace editing", async () => {
  const io = terminal();
  try {
    const answer = io.prompter.question("Password: ", {
      hidden: true,
      trim: false,
    });
    io.input.write("secret-value-123456x");
    io.input.write("\b");
    io.input.write("7\r");
    assert.equal(await answer, "secret-value-1234567");
    assert.ok(!io.output().includes("secret-value"));
  } finally {
    io.prompter.close();
  }
});

test("Ctrl+C cancels pending input and restores console mode", async () => {
  const io = terminal();
  const answer = io.prompter.question("Password: ", { hidden: true });
  const cancelled = assert.rejects(
    answer,
    (error) => error.code === "CMS_SETUP_INPUT" && error.exitCode === 130,
  );
  io.input.write("\u0003");
  await cancelled;
  assert.deepEqual(io.modes, [true, false]);
});

test("EOF rejects a pending prompt instead of leaving an unsettled await", async () => {
  const input = new PassThrough();
  const prompter = createPrompter(
    input,
    new Writable({
      write(chunk, encoding, callback) {
        callback();
      },
    }),
  );
  const answer = prompter.question("Username: ");
  const ended = assert.rejects(
    answer,
    (error) => error.code === "CMS_SETUP_INPUT" && error.exitCode === 1,
  );
  input.end();
  await ended;
  prompter.close();
});

test("the complete CLI accepts a single CRLF paste and saves only a password hash", async (t) => {
  const result = await runSetup(t);
  assert.equal(result.code, 0);
  const [user] = JSON.parse(result.config.CMS_USERS);
  assert.equal(user.username, "owner");
  assert.equal(user.name, "مدیر باران");
  assert.equal(user.role, "admin");
  assert.equal(user.hash, await passwordHash(testPassword, user.salt));
  assert.ok(!JSON.stringify(result.config).includes(testPassword));
  assert.ok(!result.vars.includes(testPassword));
  assert.ok(!result.output.includes(testPassword));
  assert.ok(!result.output.includes(testToken));
  assert.ok(result.config.CMS_SESSION_SECRET.length >= 40);
  assert.equal(result.config.CMS_GITHUB_TOKEN, testToken);
  assert.equal(result.deployCall, null);
});

test("invalid username, role, password, confirmation and token can all be retried", async (t) => {
  const result = await runSetup(t, [
    "",
    "bad user",
    "owner",
    "",
    "invalid-role",
    "EDITOR",
    "short",
    "short" + " ".repeat(16),
    "x".repeat(201),
    " ".repeat(16),
    testPassword,
    "different-test-password",
    testPassword,
    "bad token with spaces",
    testToken,
  ]);
  assert.equal(result.code, 0);
  const [user] = JSON.parse(result.config.CMS_USERS);
  assert.equal(user.name, "owner");
  assert.equal(user.role, "editor");
  for (const message of [
    "Invalid username.",
    "Invalid role.",
    "Password must contain 16 to 200 characters.",
    "Passwords do not match.",
    "GitHub token must not contain whitespace.",
  ]) {
    assert.ok(result.output.includes(message));
  }
  assert.ok(!result.output.includes(testPassword));
  assert.ok(!result.output.includes(testToken));
  assert.ok(!result.output.includes("different-test-password"));
});

test("password whitespace is preserved exactly and empty optional fields keep defaults", async (t) => {
  const password = "  test-password-with-spaces  ";
  const result = await runSetup(
    t,
    [" owner ", "", "", password, password, ""],
    { eol: "\n" },
  );
  assert.equal(result.code, 0);
  const [user] = JSON.parse(result.config.CMS_USERS);
  assert.equal(user.username, "owner");
  assert.equal(user.name, "owner");
  assert.equal(user.role, "admin");
  assert.equal(user.hash, await passwordHash(password, user.salt));
  assert.ok(!result.output.includes(password));
});

test("an existing account, session secret and token survive an account update", async (t) => {
  const existing = {
    CMS_USERS: JSON.stringify([
      { username: "owner", role: "admin", hash: "old-hash", salt: "old-salt" },
      {
        username: "other",
        role: "editor",
        hash: "other-hash",
        salt: "other-salt",
      },
    ]),
    CMS_SESSION_SECRET: "existing-session-secret-".repeat(3),
    CMS_GITHUB_TOKEN: testToken,
  };
  const result = await runSetup(
    t,
    ["owner", "نام جدید", "editor", testPassword, testPassword, ""],
    { existing },
  );
  assert.equal(result.code, 0);
  const users = JSON.parse(result.config.CMS_USERS);
  assert.equal(users.length, 2);
  assert.equal(users.find((u) => u.username === "owner").role, "editor");
  assert.equal(users.find((u) => u.username === "other").hash, "other-hash");
  assert.equal(result.config.CMS_SESSION_SECRET, existing.CMS_SESSION_SECRET);
  assert.equal(result.config.CMS_GITHUB_TOKEN, existing.CMS_GITHUB_TOKEN);
});

test("a missing deploy token is retried before calling the local Wrangler stand-in", async (t) => {
  const result = await runSetup(t, [...answers.slice(0, 5), "", testToken], {
    deploy: true,
  });
  assert.equal(result.code, 0);
  assert.ok(result.output.includes("A GitHub token is required for --deploy."));
  assert.deepEqual(result.deployCall.args, [
    "secret",
    "bulk",
    path.join(result.cwd, ".cms-local", "secrets.json"),
  ]);
  assert.equal(result.deployCall.tokenConfigured, true);
  assert.equal(result.deployCall.node, process.version);
  assert.ok(!result.output.includes(testToken));
});

test("a failed fake deploy retains local configuration and exits unsuccessfully", async (t) => {
  const result = await runSetup(t, answers, { deploy: true, deployExit: 2 });
  assert.equal(result.code, 1);
  assert.ok(result.config);
  assert.ok(
    result.output.includes(
      "Uploading secrets failed. Local configuration is retained.",
    ),
  );
  assert.ok(!result.output.includes(testPassword));
  assert.ok(!result.output.includes(testToken));
});

test("EOF before completing setup exits clearly and never calls Wrangler", async (t) => {
  for (const lines of [[], ["owner"], answers.slice(0, 4)]) {
    const result = await runSetup(t, lines, { deploy: true });
    assert.equal(result.code, 1);
    assert.ok(result.output.includes("Input ended before setup was complete."));
    assert.equal(result.config, null);
    assert.equal(result.deployCall, null);
  }
});

for (const shell of ["cmd", "powershell"]) {
  test(
    `npm.cmd setup works through Windows ${shell} (fake deploy only)`,
    { skip: process.platform !== "win32" },
    async (t) => {
      const result = await runSetup(t, answers, { shell, deploy: true });
      assert.equal(
        result.code,
        0,
        result.output
          .replaceAll(testPassword, "[test password]")
          .replaceAll(testToken, "[test token]"),
      );
      assert.equal(JSON.parse(result.config.CMS_USERS)[0].username, "owner");
      assert.equal(result.deployCall.node, process.version);
      assert.ok(!result.output.includes(testPassword));
      assert.ok(!result.output.includes(testToken));
    },
  );
}
