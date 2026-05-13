import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { varsType } from './content';
import { AIResponseType } from '.';

const iacDir = path.join(__dirname, 'iac');

const getTargetFolder = (projectName: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectName)) {
    throw new Error(
      'Invalid project name. Use only letters, numbers, hyphens, and underscores.',
    );
  }

  const targetFolder = path.resolve(iacDir, projectName);
  const rootFolder = `${path.resolve(iacDir)}${path.sep}`;
  if (!targetFolder.startsWith(rootFolder)) {
    throw new Error('Invalid project path.');
  }

  return targetFolder;
};

const assertSafeValue = (value: string, regex: RegExp, label: string) => {
  if (!regex.test(value)) {
    throw new Error(`Invalid ${label} for security reasons.`);
  }
};

const validateDeployVars = (vars: varsType) => {
  assertSafeValue(
    vars.githubRepoUrl,
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/,
    'githubRepoUrl',
  );
  const allowedBuildCommands = new Set([
    'none',
    'npm run build',
    'npm install && npm run build',
  ]);
  if (!allowedBuildCommands.has(vars.buildCommand.trim())) {
    throw new Error('Invalid buildCommand for security reasons.');
  }

  assertSafeValue(vars.outputDir, /^(\.|[A-Za-z0-9._-]+)$/, 'outputDir');
  assertSafeValue(vars.nodeVersion, /^[0-9]{1,2}$/, 'nodeVersion');
};

export const parseFiles = (
  { fileContent }: AIResponseType,
  vars: varsType,
): {
  variables: string;
  main: string;
  output: string;
  provider: string;
} => {
  const replacePlaceholders = (value: string) =>
    value
      .replace(/\{\{NAME\}\}/g, vars.name)
      .replace(/\{\{ACCESS_KEY\}\}/g, vars.accessKey)
      .replace(/\{\{SECRET_KEY\}\}/g, vars.privateKey)
      .replace(/\{\{AMI_ID\}\}/g, vars.ami)
      .replace(/\{\{INSTANCE_TYPE\}\}/g, vars.instanceType)
      .replace(/\{\{REGION\}\}/g, vars.region)
      .replace(/\{\{KEY_NAME\}\}/g, vars.keyName)
      .replace(/\{\{SG_NAME\}\}/g, vars.sgName)
      .replace(/\{\{GITHUB_REPO_URL\}\}/g, vars.githubRepoUrl)
      .replace(/\{\{BUILD_COMMAND\}\}/g, vars.buildCommand)
      .replace(/\{\{OUTPUT_DIR\}\}/g, vars.outputDir)
      .replace(/\{\{NODE_VERSION\}\}/g, vars.nodeVersion);

  return {
    variables: replacePlaceholders(fileContent.variables_tf),
    main: replacePlaceholders(fileContent.main_tf),
    output: replacePlaceholders(fileContent.output_tf),
    provider: replacePlaceholders(fileContent.provider_tf),
  };
};

export const generateFiles = async (
  vars: varsType,
  fileContent: AIResponseType,
) => {
  validateDeployVars(vars);
  await fs.mkdir(iacDir, { recursive: true });
  const targetDir = getTargetFolder(vars.name);
  await fs.mkdir(targetDir, { recursive: true });

  const parsedFiles = parseFiles(fileContent, vars);

  const files = [
    { relPath: 'main.tf', content: parsedFiles.main },
    { relPath: 'providers.tf', content: parsedFiles.provider },
    { relPath: 'variables.tf', content: parsedFiles.variables },
    { relPath: 'output.tf', content: parsedFiles.output },
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
  const targetFolder = getTargetFolder(projectName);
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
  const targetFolder = getTargetFolder(projectName);
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
  const targetFolder = getTargetFolder(projectName);
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

export const destroyTofu = async (projectName: string) => {
  const targetFolder = getTargetFolder(projectName);
  return await new Promise<{
    success: boolean;
    output?: string;
    error?: string;
  }>((resolve) => {
    let output = '';
    let error = '';

    const child = spawn('tofu', ['destroy', '-auto-approve'], {
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
