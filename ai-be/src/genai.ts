import { GoogleGenAI } from '@google/genai';
import { simplerSystemPrompt } from './prompts';

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY!,
});

export const fetchIaCFileContents = async (userPrompt: string) => {
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: simplerSystemPrompt,
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: userPrompt,
          },
        ],
      },
    ],
  });

  if (res.text) {
    return await JSON.parse(
      res.text.replace(/```json/i, '').replace(/```/i, ''),
    );
  }
};
