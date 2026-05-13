import { GoogleGenAI } from '@google/genai';
import {
  analyzeRepoPrompt,
  planGenerationPrompt,
  simplerSystemPrompt,
} from './prompts';

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY!,
});

export const fetchIaCFileContents = async (userPrompt: string) => {
  const res = await generateJSONResponse(simplerSystemPrompt, {
    userPrompt,
  });

  return res;
};

export const analyzeRepositoryContext = async (repoContext: unknown) => {
  const res = await generateJSONResponse(analyzeRepoPrompt, { repoContext });
  return res;
};

export const generateDeploymentPlan = async (
  repoAnalysis: unknown,
  userMeta: unknown,
) => {
  const res = await generateJSONResponse(planGenerationPrompt, {
    repoAnalysis,
    userMeta,
  });

  return res;
};

const generateJSONResponse = async (
  systemInstruction: string,
  payload: unknown,
) => {
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction,
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: JSON.stringify(payload),
          },
        ],
      },
    ],
  });

  if (res.text) {
    const normalizedText = res.text
      .replace(/```json/gi, '')
      .replace(/```/gi, '');
    try {
      return JSON.parse(normalizedText);
    } catch (parseError) {
      throw new Error(
        `Failed to parse AI response as JSON: ${(parseError as Error).message}. Response: ${normalizedText.slice(0, 240)}`,
      );
    }
  }

  return null;
};
