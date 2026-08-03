import fs from 'fs';
import path from 'path';
import { ProjectProfile } from './types';

export function detectProjectProfile(): ProjectProfile {
  const cwd = process.cwd();

  // Node.js / TypeScript
  if (fs.existsSync(path.join(cwd, 'package.json'))) {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
    const testCmd = pkg.scripts?.test ? 'npm test' : 'npx jest';
    return { language: 'nodejs', testCommand: testCmd, packageManager: 'npm' };
  }

  // Go
  if (fs.existsSync(path.join(cwd, 'go.mod'))) {
    return { language: 'go', testCommand: 'go test ./...', packageManager: 'go' };
  }

  // Python
  if (fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'requirements.txt'))) {
    return { language: 'python', testCommand: 'pytest', packageManager: 'pip' };
  }

  // Mặc định nếu không phát hiện được
  return { language: 'unknown', testCommand: 'echo "No tests found"', packageManager: 'unknown' };
}