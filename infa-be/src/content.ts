export type varsType = {
  name: string;
  ami: string;
  instanceType: string;
  keyName: string;
  region: string;
  accessKey: string;
  privateKey: string;
  sgName: string;
  userPrompt?: string;
  pemKeyPath: string;
  githubRepoUrl: string;
  projectType: 'react-vite' | 'react-cra' | 'static-html';
  nodeVersion?: '18' | '20';
  buildCommand?: string;
  outputDir?: string;
};
