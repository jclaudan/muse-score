// Helpers purs : titres et détection de format.
import { parse } from "node:path";

export function isMidiFile(filename: string): boolean {
  return /\.(mid|midi)$/i.test(filename);
}

export function isXmlFile(filename: string): boolean {
  return /\.(musicxml|xml)$/i.test(filename);
}

export function isSupportedFile(filename: string): boolean {
  return isMidiFile(filename) || isXmlFile(filename);
}

// Titre lu dans le fichier (<work-title>), sinon null.
export function titleFromMusicXml(xml: Buffer): string | null {
  const m = xml
    .toString("utf-8", 0, Math.min(xml.length, 200_000))
    .match(/<work-title>([\s\S]*?)<\/work-title>/);
  if (!m) return null;
  const title = m[1].replace(/<[^>]*>/g, "").trim();
  return title ? title.slice(0, 255) : null;
}

// Nom de téléchargement ASCII sûr.
export function downloadBase(filename: string): string {
  return (
    parse(filename).name.replace(/[^\w-]+/g, "_").slice(0, 80) || "output"
  );
}

// Titre d'affichage : <work-title> puis nom de fichier brut (accents gardés).
export function displayTitle(
  xml: Buffer | null,
  filename: string,
  override?: string,
): string {
  if (override?.trim()) return override.trim().slice(0, 255);
  if (xml) {
    const t = titleFromMusicXml(xml);
    if (t) return t;
  }
  return parse(filename).name.slice(0, 255) || "output";
}
