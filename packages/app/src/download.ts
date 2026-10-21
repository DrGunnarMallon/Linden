export function download(filename: string, content: string | Blob, mime: string): void {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking right away can cancel large downloads (big PNGs) in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
