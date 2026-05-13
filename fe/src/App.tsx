import { useMemo, useState } from 'react'

import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { Input } from './components/ui/input'
import { Textarea } from './components/ui/textarea'

type Vars = {
  name: string
  ami: string
  instanceType: string
  keyName: string
  region: string
  accessKey: string
  privateKey: string
  sgName: string
  userPrompt: string
  githubRepoUrl: string
  buildCommand: string
  outputDir: string
  nodeVersion: string
}

type AIResponse = {
  message: string
  fileContent: unknown
}

type DeployEvent = {
  step?: string
  [key: string]: unknown
}

const defaultVars: Vars = {
  name: 'cloudman-demo',
  ami: 'ami-0c02fb55956c7d316',
  instanceType: 't2.micro',
  keyName: 'my-key-pair',
  region: 'us-east-1',
  accessKey: '',
  privateKey: '',
  sgName: 'cloudman-sg',
  userPrompt:
    'Deploy my React app on AWS EC2 with low cost. It is a small project with around 100 daily users.',
  githubRepoUrl: 'https://github.com/example/repo',
  buildCommand: 'npm install && npm run build',
  outputDir: 'dist',
  nodeVersion: '20',
}

const jsonText = (value: unknown) => JSON.stringify(value, null, 2)

async function parseJsonOrThrow(response: Response) {
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as unknown) : null

  if (!response.ok) {
    const errorMessage =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `Request failed with status ${response.status}`

    throw new Error(errorMessage)
  }

  return payload
}

function App() {
  const aiBaseUrl = import.meta.env.VITE_AI_BASE_URL ?? 'http://localhost:8081'
  const infraBaseUrl = import.meta.env.VITE_INFA_BASE_URL ?? 'http://localhost:8080'

  const [vars, setVars] = useState<Vars>(defaultVars)
  const [aiResponse, setAiResponse] = useState<AIResponse | null>(null)
  const [generateResult, setGenerateResult] = useState<unknown>(null)
  const [destroyResult, setDestroyResult] = useState<unknown>(null)
  const [deployEvents, setDeployEvents] = useState<DeployEvent[]>([])
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isBusy = useMemo(() => loading !== null, [loading])

  const setField = (key: keyof Vars, value: string) => {
    setVars((prev) => ({ ...prev, [key]: value }))
  }

  const callAi = async () => {
    setError(null)
    setLoading('ai')
    try {
      const response = await fetch(`${aiBaseUrl}/ai/iac`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPrompt: vars.userPrompt }),
      })

      const payload = (await parseJsonOrThrow(response)) as AIResponse
      setAiResponse(payload)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(null)
    }
  }

  const callGenerate = async () => {
    setError(null)
    setLoading('generate')
    try {
      const response = await fetch(`${infraBaseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars, aiResponse }),
      })

      const payload = await parseJsonOrThrow(response)
      setGenerateResult(payload)

      if (
        typeof payload === 'object' &&
        payload !== null &&
        'aiResponse' in payload &&
        typeof payload.aiResponse === 'object' &&
        payload.aiResponse !== null
      ) {
        setAiResponse(payload.aiResponse as AIResponse)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(null)
    }
  }

  const callDeploy = async () => {
    if (!aiResponse) {
      setError('Generate AI response first using “Generate Terraform files”.')
      return
    }

    setError(null)
    setLoading('deploy')
    setDeployEvents([])

    try {
      const response = await fetch(`${infraBaseUrl}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars, aiResponse }),
      })

      if (!response.ok || !response.body) {
        const payload = await parseJsonOrThrow(response)
        setDeployEvents([{ step: 'error', payload }])
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const line = part
            .split('\n')
            .find((entry) => entry.trimStart().startsWith('data:'))

          if (!line) {
            continue
          }

          const raw = line.replace(/^\s*data:\s*/, '')
          if (!raw) {
            continue
          }

          const event = JSON.parse(raw) as DeployEvent
          setDeployEvents((prev) => [...prev, event])
        }
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(null)
    }
  }

  const callDestroy = async () => {
    setError(null)
    setLoading('destroy')

    try {
      const response = await fetch(`${infraBaseUrl}/destroy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: vars.name }),
      })

      const payload = await parseJsonOrThrow(response)
      setDestroyResult(payload)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(null)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Cloudman UI</CardTitle>
          <CardDescription>
            React + shadcn + Tailwind v4 frontend connected to AI and infra services.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium" htmlFor="userPrompt">
              User prompt
            </label>
            <Textarea
              id="userPrompt"
              value={vars.userPrompt}
              onChange={(e) => setField('userPrompt', e.target.value)}
            />
          </div>

          {(
            [
              ['name', 'Project name'],
              ['githubRepoUrl', 'GitHub repo URL'],
              ['region', 'Region'],
              ['ami', 'AMI'],
              ['instanceType', 'Instance type'],
              ['keyName', 'Key pair name'],
              ['sgName', 'Security group name'],
              ['nodeVersion', 'Node version'],
              ['buildCommand', 'Build command'],
              ['outputDir', 'Output directory'],
              ['accessKey', 'AWS access key'],
              ['privateKey', 'AWS secret key'],
            ] as Array<[keyof Vars, string]>
          ).map(([key, label]) => (
            <div key={key} className="space-y-2">
              <label className="text-sm font-medium" htmlFor={key}>
                {label}
              </label>
              <Input
                id={key}
                value={vars[key]}
                type={key === 'privateKey' ? 'password' : 'text'}
                onChange={(e) => setField(key, e.target.value)}
              />
            </div>
          ))}

          <div className="md:col-span-2 flex flex-wrap gap-2 pt-2">
            <Button onClick={callAi} disabled={isBusy}>
              {loading === 'ai' ? 'Loading AI...' : 'Call /ai/iac'}
            </Button>
            <Button onClick={callGenerate} disabled={isBusy} variant="secondary">
              {loading === 'generate' ? 'Generating...' : 'Call /generate'}
            </Button>
            <Button onClick={callDeploy} disabled={isBusy}>
              {loading === 'deploy' ? 'Deploying...' : 'Call /deploy (SSE)'}
            </Button>
            <Button onClick={callDestroy} disabled={isBusy} variant="destructive">
              {loading === 'destroy' ? 'Destroying...' : 'Call /destroy'}
            </Button>
            <Badge variant="outline">AI: {aiBaseUrl}</Badge>
            <Badge variant="outline">Infra: {infraBaseUrl}</Badge>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>AI response</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-80 overflow-auto rounded-md border p-3 text-xs">
              {aiResponse ? jsonText(aiResponse) : 'No AI response yet.'}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Generate response</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-80 overflow-auto rounded-md border p-3 text-xs">
              {generateResult ? jsonText(generateResult) : 'No generate output yet.'}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Destroy response</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-80 overflow-auto rounded-md border p-3 text-xs">
              {destroyResult ? jsonText(destroyResult) : 'No destroy output yet.'}
            </pre>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Deploy stream events</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-auto rounded-md border p-3 text-xs">
            {deployEvents.length > 0 ? jsonText(deployEvents) : 'No deploy events yet.'}
          </pre>
        </CardContent>
      </Card>
    </main>
  )
}

export default App
