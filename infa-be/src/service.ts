import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { getVariables, varsType } from './content';

const iacDir = path.join(__dirname, 'iac');

export const generateFiles = async (vars: varsType) => {
  await fs.mkdir(iacDir, { recursive: true });
  const targetDir = path.join(iacDir, vars.name);
  await fs.mkdir(targetDir, { recursive: true });

  const filesContent = await getVariables(vars);

  const files = [
    { relPath: 'main.tf', content: filesContent.main },
    { relPath: 'providers.tf', content: filesContent.provider },
    { relPath: 'variables.tf', content: filesContent.variables },
    { relPath: 'output.tf', content: filesContent.output },
  ];

  for (const f of files) {
    const full = path.join(targetDir, f.relPath);
    await fs.writeFile(full, f.content || '', 'utf8');
  }

  return {
    success: true,
    files: files.map((f) => f.relPath),
  };
};

export const initTofu = async (projectName: string) => {
  const targetFolder = path.join(iacDir, projectName);
  return await new Promise<{
    success: boolean;
    output?: string;
    error?: string;
  }>((resolve) => {
    let output = '';
    let error = '';

    console.log('\n\n', targetFolder, '\n\n');

    const child = spawn('tofu', ['init'], {
      cwd: targetFolder,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        output += data.toString();
        console.log(output);
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        error += data.toString();
        console.log(error);
      });
    }

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output });
      } else {
        resolve({ success: false, error: error || `Exited with code ${code}` });
      }
    });

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
};

export const planTofu = async (projectName: string) => {
  const targetFolder = path.join(iacDir, projectName);
  return await new Promise<{
    success: boolean;
    output?: string;
    error?: string;
  }>((resolve) => {
    let output = '';
    let error = '';

    const child = spawn('tofu', ['plan'], {
      cwd: targetFolder,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        error += data.toString();
      });
    }

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output });
      } else {
        resolve({ success: false, error: error || `Exited with code ${code}` });
      }
    });

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
};

export const applyTofu = async (projectName: string) => {
  const targetFolder = path.join(iacDir, projectName);
  return await new Promise<{
    success: boolean;
    output?: string;
    outputs?: Record<string, string>;
    error?: string;
  }>((resolve) => {
    let output = '';
    let error = '';

    const child = spawn('tofu', ['apply', '-auto-approve'], {
      cwd: targetFolder,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        error += data.toString();
      });
    }

    child.on('close', (code) => {
      if (code === 0) {
        // Extract outputs from the command output (assuming standard Tofu output)
        // Example: output contains lines like "instance_id = i-1234567890abcdef"
        const outputs: Record<string, string> = {};
        const outputRegex = /^\s*([a-zA-Z0-9_]+)\s*=\s*(.+)$/gm;
        let match;
        while ((match = outputRegex.exec(output)) !== null) {
          outputs[match[1]] = match[2];
        }
        console.log('Outputs:', outputs);
        resolve({ success: true, output, outputs });
      } else {
        resolve({ success: false, error: error || `Exited with code ${code}` });
      }
    });

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
};
