import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { handleCMS } from "../src/cms-worker.js";
import { CMSFailure } from "../src/content.js";

const exec = promisify(execFile);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".webmanifest": "application/manifest+json",
};
export class LocalRepository {
  constructor(root) {
    this.root = path.resolve(root);
    this.busy = false;
  }
  file(relative) {
    const resolved = path.resolve(this.root, relative);
    if (
      !relative.startsWith("public/") ||
      !resolved.startsWith(this.root + path.sep) ||
      relative.includes("..") ||
      relative.includes("\\")
    )
      throw new CMSFailure("مسیر فایل معتبر نیست.");
    return resolved;
  }
  async head() {
    const files = await this.tree();
    const signatures = await Promise.all(
      files.map(async (file) => {
        const stat = await fs.stat(this.file(file.path));
        return `${file.path}:${stat.size}:${stat.mtimeMs}`;
      }),
    );
    return sha(signatures.sort().join("\n"));
  }
  async tree() {
    const walk = async (directory) =>
      (
        await Promise.all(
          (await fs.readdir(directory, { withFileTypes: true }))
            .filter((e) => !e.isSymbolicLink())
            .map(async (entry) => {
              const absolute = path.join(directory, entry.name);
              if (entry.isDirectory()) return walk(absolute);
              return [
                {
                  path: path
                    .relative(this.root, absolute)
                    .replaceAll("\\", "/"),
                  size: (await fs.stat(absolute)).size,
                },
              ];
            }),
        )
      ).flat();
    return walk(path.join(this.root, "public"));
  }
  async read(relative, ref) {
    this.file(relative);
    try {
      const content =
        ref && /^[a-f0-9]{40}$/.test(ref)
          ? (
              await exec("git", ["show", `${ref}:${relative}`], {
                cwd: this.root,
                maxBuffer: 4 * 1024 * 1024,
              })
            ).stdout
          : await fs.readFile(this.file(relative), "utf8");
      return { content, sha: sha(content) };
    } catch {
      throw new CMSFailure("فایل پیدا نشد.", 404);
    }
  }
  async readBytes(relative) { return new Uint8Array(await fs.readFile(this.file(relative))); }
  async publicationStatus() { return { commit:"local", deployment:"not_applicable", evidence:null }; }
  async commit(base, changes) {
    if (this.busy)
      throw new CMSFailure(
        "فایل‌ها تغییر کرده‌اند؛ دوباره بارگذاری کنید.",
        409,
      );
    this.busy = true;
    const backups = [];
    try {
      if ((await this.head()) !== base) throw new CMSFailure("فایل‌ها تغییر کرده‌اند؛ دوباره بارگذاری کنید.",409);
      for (const change of changes) {
        const target = this.file(change.path);
        const existing = await fs.readFile(target).catch(() => null);
        backups.push({ target, existing });
        await fs.mkdir(path.dirname(target), { recursive: true });
        const temporary = target + `.cms-${randomUUID()}.tmp`;
        await fs.writeFile(
          temporary,
          change.encoding === "base64"
            ? Buffer.from(change.content, "base64")
            : change.content,
        );
        await fs.rename(temporary, target);
      }
      return { sha: base, mode: "local" };
    } catch (error) {
      for (const { target, existing } of backups.reverse()) {
        if (existing) await fs.writeFile(target, existing);
        else await fs.unlink(target).catch(() => {});
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async history(relative) {
    this.file(relative);
    const output = (
      await exec(
        "git",
        ["log", "-15", "--format=%H%x09%aI%x09%s", "--", relative],
        { cwd: this.root },
      )
    ).stdout;
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, date, ...message] = line.split("\t");
        return { sha, date, message: message.join("\t") };
      });
  }
  async status() {
    return { state: "local", checks: [] };
  }
}
export async function startLocal(root = process.cwd(), port = 4175) {
  const repository = new LocalRepository(root);
  const server = http.createServer(async (req, res) => {
    try {
      if (
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          req.socket.remoteAddress,
        ) ||
        !/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || "")
      ) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/cms/")) {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16 * 1024 * 1024) {
            res.writeHead(413);
            res.end();
            return;
          }
          chunks.push(chunk);
        }
        const response = await handleCMS(
          new Request(url, {
            method: req.method,
            headers: req.headers,
            body: ["GET", "HEAD"].includes(req.method)
              ? undefined
              : Buffer.concat(chunks),
          }),
          {},
          { repo: repository, localMode: true },
        );
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (!["GET", "HEAD"].includes(req.method)) {
        res.writeHead(405);
        return res.end();
      }
      let pathname = decodeURIComponent(url.pathname);
      if (
        pathname.includes("..") ||
        pathname.includes("\\") ||
        pathname.split("/").some((s) => s.startsWith("."))
      ) {
        res.writeHead(404);
        return res.end();
      }
      const filename = repository.file(
        "public" + pathname + (pathname.endsWith("/") ? "index.html" : ""),
      );
      let data;
      try {
        data = await fs.readFile(filename);
      } catch {
        try {
          await fs.access(path.join(filename, "index.html"));
          res.writeHead(301, { Location: pathname + "/" });
          return res.end();
        } catch {
          res.writeHead(404);
          return res.end("Not found");
        }
      }
      const security = pathname.startsWith("/admin/")
        ? {
            "X-Robots-Tag": "noindex, nofollow",
            "Content-Security-Policy":
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' about:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
          }
        : {};
      res.writeHead(200, {
        "Content-Type":
          mime[path.extname(filename)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...security,
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(500);
      res.end("Local server error");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  let server;
  try {
    server = await startLocal(process.cwd(), Number(process.env.PORT) || 4175);
  } catch (error) {
    if (!["EACCES", "EADDRINUSE"].includes(error.code)) throw error;
    server = await startLocal(process.cwd(), 0);
  }
  console.log(
    `Local CMS: http://127.0.0.1:${server.address().port}/admin/\nLocal mode: saves files in this project. No automatic commit or push.`,
  );
}
