import { config } from 'dotenv';
config();
import express from 'express';
import cors from 'cors';
import { fetchIaCFileContents } from './genai';

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

app.listen(process.env.PORT, () => {
  console.log('Listening on port', process.env.PORT);
});
