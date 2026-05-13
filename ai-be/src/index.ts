import { config } from 'dotenv';
config();
import express from 'express';
import cors from 'cors';
import {
  analyzeRepositoryContext,
  fetchIaCFileContents,
  generateDeploymentPlan,
} from './genai';

const app = express();

app.use(express.json());
app.use(cors());

app.post('/ai/iac', async (req, res) => {
  const { userPrompt } = req.body;

  if (!userPrompt) {
    return res.status(400).json({
      message: 'error',
      error: '"userPrompt" is required.',
    });
  }

  const fileContent = await fetchIaCFileContents(userPrompt);

  return res.status(200).json({
    message: 'success',
    fileContent,
  });
});

app.post('/ai/analyze', async (req, res) => {
  const { repoUrl, repoContext } = req.body;

  if (!repoUrl || !repoContext) {
    return res.status(400).json({
      message: 'error',
      error: '"repoUrl" and "repoContext" are required.',
    });
  }

  const analysis = await analyzeRepositoryContext({
    ...repoContext,
    repoUrl,
  });

  return res.status(200).json(analysis);
});

app.post('/ai/plan', async (req, res) => {
  const { repoAnalysis, userMeta } = req.body;

  if (!repoAnalysis || !userMeta) {
    return res.status(400).json({
      message: 'error',
      error: '"repoAnalysis" and "userMeta" are required.',
    });
  }

  const plan = await generateDeploymentPlan(repoAnalysis, userMeta);

  return res.status(200).json(plan);
});

app.listen(process.env.PORT, () => {
  console.log('Listening on port', process.env.PORT);
});
