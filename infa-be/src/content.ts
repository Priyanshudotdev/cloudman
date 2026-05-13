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
  githubRepoUrl: string;
  buildCommand: string;
  outputDir: string;
  nodeVersion: string;
};
