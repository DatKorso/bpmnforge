/** Deterministic Arial-compatible advances, shared by layout and the SVG viewer.
 * Values deliberately include a small margin for platform font differences.
 * No canvas/font loading is needed, so file:// and Node produce identical wraps.
 */
import { READABLE } from './profile.ts';
const NARROW = new Set("ilIjtfr!|.,:;'` ");
const WIDE = new Set('MWmw@%ЖШЩЮЫФжшщюыф');
const LOWER = new Set('abcdefghknopqsuvxyzабвгдеёзийклмнопрстухьэ0123456789');
const UPPER = new Set('ABCDEFGHKNOPQRSTUVXYZАБВГДЕЁЗИЙКЛМНОПРСТУХЬЭ');

export function textWidth(text: string, fontSize = 14): number {
  let units = 0;
  for (const char of text) {
    if (/\p{Mark}/u.test(char)) continue;
    units += NARROW.has(char) ? (char === ' ' ? .29 : .34)
      : WIDE.has(char) ? 1.04 : char === 'М' ? .88 : char === 'м' ? .73
      : UPPER.has(char) ? .82 : LOWER.has(char) ? .65
      : char === '-' || char === '_' || char === '/' || char === '\\' ? .42
      : /[\u2e80-\ua4cf\uac00-\ud7ff\uf900-\ufaff]|\p{Extended_Pictographic}/u.test(char) ? 1.06 : .84;
  }
  return units * fontSize;
}

/** Greedy word wrapping; exceptionally long identifiers split at code points. */
export function textLines(text: string, width: number, fontSize = 14): string[] {
  const limit = Math.max(1, width), lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (line && textWidth(`${line} ${word}`, fontSize) <= limit) { line += ` ${word}`; continue; }
      if (line) { lines.push(line); line = ''; }
      if (textWidth(word, fontSize) <= limit) { line = word; continue; }
      for (const char of word) {
        if (line && textWidth(line + char, fontSize) > limit) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

export function textHeight(text: string, width: number, fontSize = 14, lineHeight = 18): number {
  return textLines(text, width, fontSize).length * lineHeight;
}

export function taskSize(name: string): { width: number; height: number } {
  // Keep short tasks compact. Widen longer captions before adding more rows.
  const compactLines = textLines(name, 168).length;
  const width = READABLE.taskWidths[compactLines <= 3 ? 0 : compactLines <= 5 ? 1 : 2];
  const padding = READABLE.taskPadding * 2, step = READABLE.taskHeightStep;
  return { width, height: Math.max(80, Math.ceil((textHeight(name, width - padding) + padding) / step) * step) };
}
