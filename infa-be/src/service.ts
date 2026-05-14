import fs from 'fs/promises';
import { chmodSync, existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { varsType } from './content';
import { AIResponseType } from '.';
import { NodeSSH } from 'node-ssh';

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
  validateTemplateVars(vars);
  if (
    vars.projectType !== 'react-vite' &&
    vars.projectType !== 'react-cra' &&
    vars.projectType !== 'static-html'
  ) {
    throw new Error('Invalid projectType for security reasons.');
  }
  assertSafeValue(
    path.basename(vars.pemKeyPath),
    /^[A-Za-z0-9._-]+\.pem$/,
    'pemKeyPath',
  );
};

const validateTemplateVars = (vars: varsType) => {
  assertSafeValue(
    vars.githubRepoUrl,
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/,
    'githubRepoUrl',
  );
  if (vars.nodeVersion && vars.nodeVersion !== '18' && vars.nodeVersion !== '20') {
    throw new Error('Invalid nodeVersion for security reasons.');
  }
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
      .replace(/\{\{NODE_VERSION\}\}/g, vars.nodeVersion || '18');

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
  validateTemplateVars(vars);
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

export type SshDeployLog = {
  step: string;
  message: string;
  success?: boolean;
  url?: string;
};

const resolvePemKeyPath = (pemKeyPath: string) => {
  const keysDir = path.resolve(__dirname, 'keys');
  const fileName = path.basename(pemKeyPath);
  assertSafeValue(fileName, /^[A-Za-z0-9._-]+\.pem$/, 'pemKeyPath');
  const resolved = path.resolve(keysDir, fileName);
  if (!resolved.startsWith(`${keysDir}${path.sep}`)) {
    throw new Error('Invalid pemKeyPath for security reasons.');
  }
  return resolved;
};

export const sshDeploy = async (
  publicIp: string,
  vars: varsType,
  onLog: (log: SshDeployLog) => void,
): Promise<{ success: boolean; url?: string; error?: string }> => {
  validateDeployVars(vars);
  const ssh = new NodeSSH();
  const pemPath = resolvePemKeyPath(vars.pemKeyPath);

  if (!existsSync(pemPath)) {
    return {
      success: false,
      error: `PEM key file not found at ${pemPath}`,
    };
  }

  if (process.platform !== 'win32') {
    try {
      chmodSync(pemPath, 0o400);
    } catch (error) {
      // Best-effort only: some environments/filesystems may not allow chmod here.
      onLog({
        step: 'connecting',
        message: `Warning: could not set PEM permission to 400 (${(error as Error).message})`,
      });
    }
  }

  onLog({
    step: 'connecting',
    message: 'Waiting for EC2 instance to accept SSH...',
  });

  let connected = false;
  for (let attempt = 1; attempt <= 18; attempt++) {
    try {
      await ssh.connect({
        host: publicIp,
        username: 'ec2-user',
        privateKeyPath: pemPath,
        readyTimeout: 8000,
      });
      connected = true;
      onLog({ step: 'connecting', message: `SSH connected on attempt ${attempt}` });
      break;
    } catch {
      onLog({
        step: 'connecting',
        message: `Attempt ${attempt}/18 failed, retrying in 10s...`,
      });
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }

  if (!connected) {
    return { success: false, error: 'Could not connect via SSH after 18 attempts (~3 minutes)' };
  }

  const run = async (
    step: string,
    command: string,
  ): Promise<{ stdout: string; stderr: string; code: number }> => {
    onLog({ step, message: `$ ${command}` });
    const result = await ssh.execCommand(command, { cwd: '/home/ec2-user' });
    if (result.stdout) {
      onLog({ step, message: result.stdout });
    }
    if (result.stderr) {
      onLog({ step, message: result.stderr });
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code ?? 0,
    };
  };

  try {
    const nodeVersion = vars.nodeVersion || '18';
    onLog({
      step: 'installing_node',
      message: `Detecting OS and installing Node.js ${nodeVersion}...`,
    });
    const osCheck = await run('installing_node', 'cat /etc/os-release');
    const isAL2023 =
      osCheck.stdout.includes('Amazon Linux 2023') ||
      osCheck.stdout.includes('VERSION_ID="2023"');

    if (isAL2023) {
      if (nodeVersion === '20') {
        const installResult = await run('installing_node', 'sudo dnf install -y nodejs20 git');
        if (installResult.code !== 0) {
          throw new Error(`Node.js 20 installation failed: ${installResult.stderr}`);
        }
      } else {
        const installResult = await run('installing_node', 'sudo dnf install -y nodejs git');
        if (installResult.code !== 0) {
          throw new Error(`Node.js installation failed: ${installResult.stderr}`);
        }
      }
    } else {
      if (nodeVersion === '20') {
        throw new Error(
          'Node.js 20 is not supported via amazon-linux-extras on Amazon Linux 2. Use nodeVersion "18" for Amazon Linux 2.',
        );
      } else {
        const installResult = await run(
          'installing_node',
          'sudo amazon-linux-extras enable nodejs18 && sudo yum clean metadata && sudo yum install -y nodejs',
        );
        if (installResult.code !== 0) {
          throw new Error(`Node.js installation failed: ${installResult.stderr}`);
        }
      }
      const gitInstallResult = await run('installing_node', 'sudo yum install -y git');
      if (gitInstallResult.code !== 0) {
        throw new Error(`Git installation failed: ${gitInstallResult.stderr}`);
      }
    }

    const nodeCheck = await run('installing_node', 'node -v');
    if (nodeCheck.code !== 0 || !nodeCheck.stdout.includes('v')) {
      throw new Error(`Node.js installation failed: ${nodeCheck.stderr}`);
    }
    onLog({
      step: 'installing_node',
      message: `Node.js installed: ${nodeCheck.stdout.trim()}`,
    });

    onLog({ step: 'installing_node', message: 'Installing serve...' });
    const serveInstall = await run('installing_node', 'sudo npm install -g serve');
    if (serveInstall.code !== 0) {
      throw new Error(`serve installation failed: ${serveInstall.stderr}`);
    }

    onLog({ step: 'cloning', message: `Cloning ${vars.githubRepoUrl}...` });
    await run('cloning', 'rm -rf /home/ec2-user/app');
    const cloneResult = await run(
      'cloning',
      `git clone ${vars.githubRepoUrl} /home/ec2-user/app`,
    );
    if (cloneResult.code !== 0) {
      throw new Error(`git clone failed: ${cloneResult.stderr}`);
    }
    onLog({ step: 'cloning', message: 'Repository cloned successfully' });

    if (vars.projectType !== 'static-html') {
      onLog({ step: 'installing_deps', message: 'Running npm install...' });
      const installResult = await ssh.execCommand('npm install', {
        cwd: '/home/ec2-user/app',
      });
      if (installResult.stdout) {
        onLog({ step: 'installing_deps', message: installResult.stdout });
      }
      if (installResult.stderr) {
        onLog({ step: 'installing_deps', message: installResult.stderr });
      }
      if ((installResult.code ?? 0) !== 0) {
        throw new Error(`npm install failed: ${installResult.stderr}`);
      }
      onLog({ step: 'installing_deps', message: 'Dependencies installed' });
    }

    let serveDir = '.';
    if (vars.projectType === 'react-vite') {
      onLog({ step: 'building', message: 'Building React (Vite) app...' });
      const buildResult = await ssh.execCommand('npm run build', {
        cwd: '/home/ec2-user/app',
      });
      if (buildResult.stdout) {
        onLog({ step: 'building', message: buildResult.stdout });
      }
      if (buildResult.stderr) {
        onLog({ step: 'building', message: buildResult.stderr });
      }
      if ((buildResult.code ?? 0) !== 0) {
        throw new Error(`npm run build failed: ${buildResult.stderr}`);
      }
      serveDir = 'dist';
      onLog({ step: 'building', message: 'Build complete → dist/' });
    } else if (vars.projectType === 'react-cra') {
      onLog({ step: 'building', message: 'Building React (CRA) app...' });
      const buildResult = await ssh.execCommand('npm run build', {
        cwd: '/home/ec2-user/app',
      });
      if (buildResult.stdout) {
        onLog({ step: 'building', message: buildResult.stdout });
      }
      if (buildResult.stderr) {
        onLog({ step: 'building', message: buildResult.stderr });
      }
      if ((buildResult.code ?? 0) !== 0) {
        throw new Error(`npm run build failed: ${buildResult.stderr}`);
      }
      serveDir = 'build';
      onLog({ step: 'building', message: 'Build complete → build/' });
    } else {
      onLog({
        step: 'building',
        message: 'Static HTML project — skipping build step',
      });
    }

    onLog({
      step: 'serving',
      message: `Starting serve on port 80 from ${serveDir}/...`,
    });
    await run('serving', 'sudo fuser -k 80/tcp || true');
    const serveCmdMap = {
      'react-vite': 'nohup sudo serve dist -l 80 > /var/log/cloudman-serve.log 2>&1 &',
      'react-cra': 'nohup sudo serve build -l 80 > /var/log/cloudman-serve.log 2>&1 &',
      'static-html': 'nohup sudo serve . -l 80 > /var/log/cloudman-serve.log 2>&1 &',
    } as const;
    const serveCmd = serveCmdMap[vars.projectType];
    await ssh.execCommand(serveCmd, { cwd: '/home/ec2-user/app' });

    await new Promise((r) => setTimeout(r, 5000));
    const checkServe = await run('serving', 'ps aux | grep serve | grep -v grep');
    if (checkServe.code !== 0 || !checkServe.stdout.includes('serve')) {
      const serveLog = await run('serving', 'cat /var/log/cloudman-serve.log');
      throw new Error(`serve process not running. Log: ${serveLog.stdout}`);
    }
    onLog({ step: 'serving', message: 'serve is running on port 80' });

    onLog({ step: 'health_check', message: 'Verifying app is reachable...' });
    const curlCheck = await run(
      'health_check',
      'curl -s -o /dev/null -w "%{http_code}" http://localhost:80',
    );
    const httpCode = curlCheck.stdout.trim();
    if (httpCode === '200' || httpCode === '304') {
      onLog({
        step: 'health_check',
        message: `App responded with HTTP ${httpCode} ✓`,
      });
    } else {
      onLog({
        step: 'health_check',
        message: `Warning: App returned HTTP ${httpCode} — may still be starting`,
      });
    }

    const url = `http://${publicIp}`;
    onLog({
      step: 'done',
      message: `🚀 App is live at ${url}`,
      success: true,
      url,
    });

    ssh.dispose();
    return { success: true, url };
  } catch (error) {
    const msg = (error as Error).message || 'Unknown SSH deploy error';
    onLog({
      step: 'error',
      message: `Deploy failed: ${msg}`,
      success: false,
    });
    ssh.dispose();
    return { success: false, error: msg };
  }
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
