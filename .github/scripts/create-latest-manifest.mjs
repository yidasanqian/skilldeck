import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const artifactsDir = process.argv[2];
const outputPath = process.argv[3] ?? "latest.json";

if (!artifactsDir) {
  throw new Error("Usage: node create-latest-manifest.mjs <artifacts-dir> [output-path]");
}

const requiredPlatforms = [
  {
    artifact: "skilldeck-macos-intel",
    key: "darwin-x86_64",
    releaseAssetName: "SkillDeck_x64.app.tar.gz",
    signaturePattern: ".app.tar.gz.sig",
  },
  {
    artifact: "skilldeck-macos-arm64",
    key: "darwin-aarch64",
    releaseAssetName: "SkillDeck_aarch64.app.tar.gz",
    signaturePattern: ".app.tar.gz.sig",
  },
  {
    artifact: "skilldeck-windows-x64",
    key: "windows-x86_64",
    signaturePatterns: [".msi.sig", "-setup.exe.sig"],
  },
  {
    artifact: "skilldeck-windows-arm64",
    key: "windows-aarch64",
    signaturePatterns: [".msi.sig", "-setup.exe.sig"],
  },
  {
    artifact: "skilldeck-linux-x64",
    key: "linux-x86_64",
    signaturePatterns: [".AppImage.sig"],
  },
  {
    artifact: "skilldeck-linux-arm64",
    key: "linux-aarch64",
    signaturePatterns: [".AppImage.sig"],
  },
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : path;
    }),
  );
  return files.flat();
}

function normalizeVersion(value) {
  return value?.replace(/^v/, "") || "";
}

function assetUrl(assetName) {
  const repo = process.env.GITHUB_REPOSITORY;
  const tag = process.env.GITHUB_REF_NAME;
  if (!repo || !tag) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_REF_NAME are required");
  }
  return `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(assetName)}`;
}

const version = normalizeVersion(process.env.GITHUB_REF_NAME);
if (!version) {
  throw new Error("Unable to infer version from GITHUB_REF_NAME");
}

const platforms = {};
for (const platform of requiredPlatforms) {
  const artifactDir = join(artifactsDir, platform.artifact);
  const files = await walk(artifactDir);
  const signaturePatterns = platform.signaturePatterns ?? [platform.signaturePattern];
  const signaturePath = signaturePatterns
    .flatMap((pattern) => files.filter((file) => file.endsWith(pattern)))
    .sort((a, b) => a.localeCompare(b))[0];

  if (!signaturePath) {
    throw new Error(
      `Missing ${platform.key} updater signature (${signaturePatterns.join(" or ")}) in ${relative(process.cwd(), artifactDir)}`,
    );
  }

  const bundlePath = signaturePath.slice(0, -".sig".length);
  const signature = (await readFile(signaturePath, "utf8")).trim();
  const assetName = platform.releaseAssetName ?? basename(bundlePath);
  platforms[platform.key] = {
    signature,
    url: assetUrl(assetName),
  };
}

const manifest = {
  version,
  notes: process.env.RELEASE_NOTES ?? "SkillDeck desktop update.",
  pub_date: new Date().toISOString(),
  platforms,
};

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${outputPath} with ${Object.keys(platforms).length} platforms.`);
