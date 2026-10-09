import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const MUSESCORE_BIN =
  process.env.MUSESCORE_BIN ??
  (process.platform === "win32"
    ? "C:\\Program Files\\MuseScore 4\\bin\\MuseScore4.exe"
    : "mscore");

// Candidats si MUSESCORE_BIN n'existe pas / n'est pas dans le PATH
const CANDIDATES =
  process.platform === "win32"
    ? [
        MUSESCORE_BIN,
        "C:\\Program Files\\MuseScore 4\\bin\\MuseScore4.exe",
        "mscore.exe",
        "MuseScore4.exe",
      ]
    : [
        MUSESCORE_BIN,
        "/usr/local/bin/mscore-wrapper",
        "/opt/mscore/bin/mscore4portable",
        "mscore",
        "musescore",
        "MuseScore4",
      ];

export function qtEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    QT_QPA_PLATFORM: process.env.QT_QPA_PLATFORM ?? "offscreen",
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? "/tmp/runtime-root",
  };
}

// Bruit QML normal de MuseScore 4 — pas une erreur
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

export async function resolveBinary(): Promise<string> {
  for (const bin of CANDIDATES) {
    try {
      await execFileAsync(bin, ["--version"], { env: qtEnv() });
      return bin;
    } catch {
      // essayer le suivant
    }
  }
  throw new Error(
    `MuseScore introuvable. Installe MuseScore 4 puis définis MUSESCORE_BIN (actuel: ${MUSESCORE_BIN})`,
  );
}

export async function convertMidiToMusicxml(
  bin: string,
  inputPath: string,
  outputPath: string,
): Promise<void> {
  // Équivalent CLI : mscore -o sortie.musicxml entree.mid
  try {
    await execFileAsync(bin, ["-o", outputPath, inputPath], {
      timeout: 120_000,
      env: qtEnv(),
    });
  } catch (e: any) {
    // MuseScore écrit ses warnings QML sur stderr même en cas de succès.
    // Si le fichier de sortie existe et n'est pas vide, on considère que c'est OK.
    try {
      const st = await stat(outputPath);
      if (st.size > 0) return;
    } catch {
      // pas de sortie -> vraie erreur, voir ci-dessous
    }
    const stderr: string = String(e?.stderr ?? e?.message ?? e);
    const useful = cleanStderr(stderr).slice(-2000) || "pas de détail stderr";
    throw new Error(`MuseScore exit=${e?.code ?? "?"} : ${useful}`);
  }
}
