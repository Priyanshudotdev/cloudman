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

  if (!vars || !aiResponse) {
    return res.status(400).json({
      error: 'Missing required "vars" or "aiResponse" field in request body.',
      success: false,
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const generationResult = await generateFiles(vars, aiResponse);
    res.write(
      `data: ${JSON.stringify({
        step: 'files_generated',
        ...generationResult,
      })}\n\n`,
    );

    const initResult = await initTofu(vars.name);
    res.write(`data: ${JSON.stringify({ step: 'init', ...initResult })}\n\n`);
    if (!initResult.success) {
      return res.end();
    }

    const planResult = await planTofu(vars.name);
    res.write(`data: ${JSON.stringify({ step: 'plan', ...planResult })}\n\n`);
    if (!planResult.success) {
      return res.end();
    }

    const applyResult = await applyTofu(vars.name);
    res.write(`data: ${JSON.stringify({ step: 'apply', ...applyResult })}\n\n`);
    if (!applyResult.success) {
      return res.end();
    }

    const rawIp = applyResult.outputs?.public_ip || '';
    const publicIp = rawIp.replace(/"/g, '').trim();
    const url = getValidatedHealthUrl(publicIp);
    const health = await checkHealth(url);

    res.write(
      `data: ${JSON.stringify({
        step: 'done',
        publicIp,
        url,
        health,
      })}\n\n`,
    );
    res.end();
  } catch (error) {
    res.write(
      `data: ${JSON.stringify({
        step: 'error',
        error: (error as Error).message || 'Internal server error',
      })}\n\n`,
    );
    res.end();
  }
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

const checkHealth = async (url: string | null) => {
  if (!url) {
    return { healthy: false, checks: 0, reason: 'missing_url' };
  }

  const maxChecks = Number(process.env.HEALTH_MAX_CHECKS || 12);
  const checkDelayMs = Number(process.env.HEALTH_CHECK_DELAY_MS || 10_000);
  for (let attempt = 1; attempt <= maxChecks; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) {
        return { healthy: true, checks: attempt };
      }
    } catch (error) {
      console.error(
        `Health check attempt ${attempt}/${maxChecks} failed for ${url}:`,
        error,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < maxChecks) {
      await new Promise((resolve) => setTimeout(resolve, checkDelayMs));
    }
  }

  return { healthy: false, checks: maxChecks, reason: 'timeout' };
};

const getValidatedHealthUrl = (publicIp: string) => {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(publicIp)) {
    return null;
  }

  const url = `http://${publicIp}`;
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:') {
    return null;
  }

  return url;
};
