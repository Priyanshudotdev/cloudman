import { config } from 'dotenv';
config();
import express, { Request, Response } from 'express';
import { varsType } from './content';
import {
  applyTofu,
  destroyTofu,
  generateFiles,
  initTofu,
  planTofu,
  sshDeploy,
} from './service';
import cors from 'cors';

const app = express();

export type AIResponseType = {
  message: string;
  fileContent: {
    status: string;
    analysis: {
      app_type: string;
      traffic_level: string;
      instance_type: string;
      region: string;
    };
    main_tf: string;
    variables_tf: string;
    provider_tf: string;
    output_tf: string;
    estimated_cost: string;
    risk_level: string;
    notes: string;
  };
};

// CORS middleware with explicit headers
app.use(cors({ origin: '*' }));

app.use(express.json());

app.get('/', async (_: Request, res: Response) => {
  res.status(200).json({
    message: 'Ok',
  });
});

app.post('/generate', async (req, res) => {
  const vars = req.body.vars as varsType;
  const aiResponseFromReq = req.body.aiResponse as AIResponseType | undefined;

  if (!vars) {
    return res.status(400).json({
      error: 'Missing required "vars" field in request body.',
      success: false,
    });
  }

  try {
    let aiResponse = aiResponseFromReq;
    if (!aiResponse) {
      const data = await fetch('http://localhost:8081/ai/iac', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userPrompt:
            vars.userPrompt ||
            'Deploy my React app on AWS EC2 with low cost. It is a small project with around 100 daily users.',
        }),
      });

      aiResponse = (await data.json()) as AIResponseType;
    }

    const response = await generateFiles(vars, aiResponse);
    res.status(200).json({
      message: 'Ok',
      response,
      aiResponse,
    });
  } catch (error) {
    res.status(500).json({
      error: (error as Error).message || 'Internal server error',
      success: false,
    });
  }
});

app.post('/deploy', async (req, res) => {
  const vars = req.body.vars as varsType;
  const aiResponse = req.body.aiResponse as AIResponseType | undefined;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  if (!vars || !aiResponse) {
    send({ step: 'error', message: 'Missing vars or aiResponse' });
    return res.end();
  }

  try {
    const varsForGeneration: varsType = {
      ...vars,
      buildCommand:
        vars.buildCommand ??
        (vars.projectType === 'static-html' ? 'none' : 'npm run build'),
      outputDir:
        vars.outputDir ??
        (vars.projectType === 'react-vite'
          ? 'dist'
          : vars.projectType === 'react-cra'
          ? 'build'
          : '.'),
      nodeVersion: vars.nodeVersion ?? '18',
    };

    send({ step: 'files_generated', message: 'Writing Terraform files...' });
    await generateFiles(varsForGeneration, aiResponse);
    send({
      step: 'files_generated',
      message: 'Terraform files written',
      success: true,
    });

    send({ step: 'init', message: 'Running tofu init...' });
    const initResult = await initTofu(varsForGeneration.name);
    send({ step: 'init', ...initResult });
    if (!initResult.success) {
      return res.end();
    }

    send({ step: 'plan', message: 'Running tofu plan...' });
    const planResult = await planTofu(varsForGeneration.name);
    send({ step: 'plan', ...planResult });
    if (!planResult.success) {
      return res.end();
    }

    send({ step: 'apply', message: 'Running tofu apply (this takes ~45 seconds)...' });
    const applyResult = await applyTofu(varsForGeneration.name);
    send({ step: 'apply', ...applyResult });
    if (!applyResult.success) {
      return res.end();
    }

    const publicIp = (applyResult.outputs?.public_ip || '').replace(/"/g, '').trim();
    if (!publicIp) {
      send({ step: 'error', message: 'No public IP returned from apply' });
      return res.end();
    }

    send({ step: 'apply', message: `EC2 instance created. Public IP: ${publicIp}` });
    send({ step: 'ssh_deploy', message: 'Starting SSH deployment...' });

    const deployResult = await sshDeploy(publicIp, varsForGeneration, (log) => {
      send(log);
    });
    if (!deployResult.success) {
      send({ step: 'error', message: deployResult.error });
    }
  } catch (error) {
    send({ step: 'error', message: (error as Error).message });
  }

  res.end();
});

app.post('/init', async (req, res) => {
  const name = req.body.name;
  try {
    const response = await initTofu(name);
    res.status(200).json({
      message: 'Ok',
      response,
    });
  } catch (error) {
    res.status(500).json({
      error: (error as Error).message || 'Internal server error',
      success: false,
    });
  }
});

app.post('/plan', async (req, res) => {
  const name = req.body.name;

  try {
    const response = await planTofu(name);
    res.status(200).json({
      message: 'Ok',
      response,
    });
  } catch (error) {
    res.status(500).json({
      error: (error as Error).message || 'Internal server error',
      success: false,
    });
  }
});

app.post('/apply', async (req, res) => {
  const name = req.body.name;

  try {
    const response = await applyTofu(name);
    res.status(200).json({
      message: 'Ok',
      response,
    });
  } catch (error) {
    res.status(500).json({
      error: (error as Error).message || 'Internal server error',
      success: false,
    });
  }
});

app.post('/destroy', async (req, res) => {
  const name = req.body.name;
  if (!name) {
    return res.status(400).json({
      error: 'Missing required "name" field in request body.',
      success: false,
    });
  }

  try {
    const response = await destroyTofu(name);
    res.status(200).json({
      message: 'Ok',
      response,
    });
  } catch (error) {
    res.status(500).json({
      error: (error as Error).message || 'Internal server error',
      success: false,
    });
  }
});

app.listen(process.env.PORT, () => {
  console.log('Server is listening on port ' + process.env.PORT);
});
