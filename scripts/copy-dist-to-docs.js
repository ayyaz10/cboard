import {
  rmSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

const src = "dist";
const dest = "docs";

function copyRecursive(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const sourcePath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(sourcePath, destPath);
    } else {
      copyFileSync(sourcePath, destPath);
    }
  }
}

rmSync(dest, { recursive: true, force: true });
copyRecursive(src, dest);
console.log("Copied dist to docs/");
