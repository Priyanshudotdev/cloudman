import { config } from 'dotenv';
config();
import express, { Request, Response } from 'express';
import { varsType } from './content';
import { applyTofu, generateFiles, initTofu, planTofu } from './service';
import cors from 'cors';

const app = express();

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

  if (!vars) {
    return res.status(400).json({
      error: 'Missing required "vars" field in request body.',
      success: false,
    });
  }

  try {
    const response = await generateFiles(vars);
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

app.listen(process.env.PORT, () => {
  console.log('Server is listening on port ' + process.env.PORT);
});
