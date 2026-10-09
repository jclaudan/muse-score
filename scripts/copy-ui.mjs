import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(join(root, "dist"), { recursive: true });
await copyFile(join(root, "src", "ui.html"), join(root, "dist", "ui.html"));
console.log("ui.html -> dist/");
