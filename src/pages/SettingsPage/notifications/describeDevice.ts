function detectOs(userAgent: string): string {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Macintosh/i.test(userAgent)) return "macOS";
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "Unknown";
}

function detectBrowser(userAgent: string): string {
  if (/Edg\//i.test(userAgent)) return "Edge";
  if (/Firefox\//i.test(userAgent)) return "Firefox";
  if (/Chrome\//i.test(userAgent)) return "Chrome";
  if (/Safari\//i.test(userAgent)) return "Safari";
  return "Browser";
}

/** Turns a stored user agent into something a person can recognise in a list. */
export default function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  return `${detectBrowser(userAgent)} on ${detectOs(userAgent)}`;
}
