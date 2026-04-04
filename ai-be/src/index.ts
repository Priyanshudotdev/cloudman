import { config } from 'dotenv';
config();
import express from 'express';
import cors from 'cors';

const app = express();

app.use(express.json());
app.use(cors());

app.get('/', (_, res) => {
  res.status(200).json({ message: 'success' });
});

app.listen(process.env.PORT, () => {
  console.log('Listening on port', process.env.PORT);
});
