import type { PageAnalysis } from "./types";

const KEY = "netpulse.reports.v1";
const MAX = 12;

export type SavedReport = {
  id: string;
  title: string;
  savedAt: string;
  data: PageAnalysis;
};

function readAll(): SavedReport[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedReport[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(rows: SavedReport[]) {
  localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX)));
}

export function listReports(): SavedReport[] {
  return readAll();
}

export function saveReport(data: PageAnalysis): SavedReport {
  const row: SavedReport = {
    id: `${Date.now()}`,
    title: data.document.finalUrl || data.document.url,
    savedAt: new Date().toISOString(),
    data,
  };
  writeAll([row, ...readAll().filter((r) => r.title !== row.title || r.savedAt !== row.savedAt)]);
  return row;
}

export function deleteReport(id: string) {
  writeAll(readAll().filter((r) => r.id !== id));
}
