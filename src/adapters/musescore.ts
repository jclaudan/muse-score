// Adaptateur ConverterPort : MuseScore en ligne de commande.
// Équivalent CLI : mscore -o sortie.musicxml entree.mid
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { AppError } from "../core/errors.js";
import type { ConverterPort } from "../core/ports.js";

const execFileAsync = promisify(execFile);

const CONFIGURED_BIN =
  process.env.MUSESCORE_BIN ??
  (process.platform === "win32"
    ? "C:\\Program Files\\MuseScore 4\\bin\\MuseScore4.exe"
    : "mscore");

const CANDIDATES =
  process.platform === "win32"
    ? [
        CONFIGURED_BIN,
        "C:\\Program Files\\MuseScore 4\\bin\\MuseScore4.exe",
        "mscore.exe",
        "MuseScore4.exe",
      ]
    : [
        CONFIGURED_BIN,
        "/usr/local/bin/mscore-wrapper",
        "/opt/mscore/bin/mscore4portable",
        "mscore",
        "musescore",
        "MuseScore4",
      ];

function qtEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    QT_QPA_PLATFORM: process.env.QT_QPA_PLATFORM ?? "offscreen",
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? "/tmp/runtime-root",
  };
}

// Bruit QML normal de MuseScore 4 — pas une erreur.
function cleanStderr(stderr: string): string {
  return stderr
    .split("\n")
    .filter(
      (l) =>
        l.trim() &&
        !l.includes("qt.qml.typeregistration") &&
        !l.includes("XDG_RUNTIME_DIR"),
    )
    .join("\n");
}

export class MuseScoreConverter implements ConverterPort {
  name(): string {
    return "MuseScore";
  }

  // Binaire détecté, ou erreur explicite.
  async status(): Promise<string> {
    for (const bin of CANDIDATES) {
      try {
        await execFileAsync(bin, ["--version"], { env: qtEnv() });
        return bin;
      } catch {
        // essayer le suivant
      }
    }
    throw new AppError(
      "CONVERSION_FAILED",
      `MuseScore introuvable. Installe MuseScore 4 puis définis MUSESCORE_BIN (actuel: ${CONFIGURED_BIN})`,
    );
  }

  async convertMidi(input: Buffer, _filename: string): Promise<Buffer> {
    const bin = await this.status();
    const tmp = await mkdtemp(join(tmpdir(), "mscore-"));
    const inPath = join(tmp, "input.mid");
    const outPath = join(tmp, "output.musicxml");
    await writeFile(inPath, input);
    try {
      await execFileAsync(bin, ["-o", outPath, inPath], {
        timeout: 120_000,
        env: qtEnv(),
      });
    } catch (e: any) {
      // Warnings QML sur stderr même en cas de succès : si la sortie
      // existe et n'est pas vide, on considère que c'est OK.
      try {
        const st = await stat(outPath);
        if (st.size > 0) return readFile(outPath);
      } catch {
        // pas de sortie -> vraie erreur
      }
      const stderr: string = String(e?.stderr ?? e?.message ?? e);
      const useful = cleanStderr(stderr).slice(-2000) || "pas de détail stderr";
      throw new AppError(
        "CONVERSION_FAILED",
        `MuseScore exit=${e?.code ?? "?"} : ${useful}`,
      );
    }
    return readFile(outPath);
  }
}
