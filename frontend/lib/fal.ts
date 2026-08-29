import fs from "node:fs/promises";
import path from "node:path";

type ImageGenerationInput = {
  prompt: string;
  outputPath: string;
  label: string;
};

export interface FalClient {
  generateImage(input: ImageGenerationInput): Promise<string>;
}

function buildPlaceholderSvg(label: string, prompt: string) {
  const safePrompt = prompt
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#193a5d" />
      <stop offset="50%" stop-color="#7a5a2f" />
      <stop offset="100%" stop-color="#0a111d" />
    </linearGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#bg)" />
  <circle cx="1260" cy="160" r="220" fill="rgba(255,255,255,0.05)" />
  <circle cx="340" cy="720" r="260" fill="rgba(212,177,106,0.10)" />
  <text x="100" y="150" fill="#f4ead5" font-size="64" font-family="Georgia, serif">${label}</text>
  <text x="100" y="240" fill="#d4b16a" font-size="28" font-family="Arial, sans-serif" letter-spacing="6">MOCK FAL OUTPUT</text>
  <foreignObject x="100" y="320" width="1200" height="420">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:#f4ead5;font-family:Arial,sans-serif;font-size:34px;line-height:1.45;">
      ${safePrompt}
    </div>
  </foreignObject>
</svg>`;
}

export function createMockFalClient(): FalClient {
  return {
    async generateImage({ prompt, outputPath, label }) {
      const absolutePath = path.join(process.cwd(), "public", outputPath.replace(/^\//, ""));

      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, buildPlaceholderSvg(label, prompt), "utf8");

      return `/${outputPath.replace(/^\//, "")}`;
    }
  };
}
