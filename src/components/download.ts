export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

export function downloadHar(filename: string, data: unknown) {
  const name = filename.endsWith(".har") ? filename : `${filename.replace(/\.json$/i, "")}.har`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/har+json" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
  URL.revokeObjectURL(href);
}
