import React, { FC, ReactNode, Suspense } from 'react'
import { OpenAI } from 'openai'
import { Code } from 'bright'
import { db } from '@/lib/db'
import yaml from 'js-yaml'
import { generateSchema } from '@/lib/schema'
import { FromSchema } from 'json-schema-to-ts'
import Markdown from 'react-markdown'
import md5 from 'md5'
import camelcaseKeys from 'camelcase-keys'
import { JSONSchema7 } from 'json-schema-to-ts/lib/types/definitions'
import { headers } from 'next/headers'
import { cn } from '@/lib/utils'
import { EmptyDiv } from './EmptyDiv'

// TODO Refactor this into an AI library and API Route Handler that's distinct from the UI Components

const openai = new OpenAI()

type Props<T extends Record<string, any> = Record<string, any>> = Partial<OpenAI.ChatCompletionCreateParamsNonStreaming> & {
  className?: string
  expert?: string
  system?: string
  prompt?: string
  user?: string
  markdown?: string
  list?: string
  json?: string
  keys?: 'camelCase' | 'snake_case' | 'kebab-case' | 'PascalCase' | 'Title Case' | 'Sentence case'
  function?: string
  description?: string
  schema?: T
  args?: any
  variations?: number
  children?: React.ReactNode
  fallback?: React.ReactElement
  component?: ReactNode | FC<T>
} & ({ prompt: string } | { user: string } | { markdown: string } | { list: string } | { 
  json: string 
} | { 
  function: string
  schema: Record<string, any>
  args: any
})

export const AI = (props: Props) => (
  <Suspense fallback={props.fallback ?? <EmptyDiv/>}> 
    <Completion {...props}/>
  </Suspense>
)

const Completion = async (props: Props) => {

  const requestedAt = new Date()
  const createdAt = requestedAt

  let { className, expert, system, json, user, prompt, description, args, markdown, list, seed, variations, tools, tool_choice } = props

  if (!system) {
    if (expert) {
      system = `You are an expert ${expert}.`
    } else {
      // system = 'You are a highly successful repeat YC founder.  You launching a new startup and are writing marketing content optimized for maximum conversion.'
    }
  }

  if (json) {
    system += ` Respond in JSON format with ${props.keys ?? 'Title Case'} keys.`
    user = json
  } else if (markdown) {
    system += ` Respond in Markdown format.`
    user = markdown
  } else if (list) {
    system += ` Respond with a numbered list.`
    user = 'List ' + list
  } else if (props.function && props.schema && props.args) {
    user += `Call ${props.function} given the context:\n${yaml.dump(args)}`
    tools = [{
      type: 'function',
      function: {
          name: props.function,
          description,
          parameters: generateSchema(props.schema) as OpenAI.FunctionParameters,
      }
    }]
    tool_choice = { type: 'function', function: { name: props.function }}
  } else if (prompt && !user) {
    user = prompt
  }


  const input: OpenAI.ChatCompletionCreateParamsNonStreaming = {
    model: props.model || 'gpt-4-turbo-preview',
    messages: system ? [{ role: 'system', content: system }, { role: 'assistant', content: user }] : [{ role: 'assistant', content: user }],
    response_format: json ?  { type: 'json_object' } : { type: 'text' },
    tools,
    tool_choice,
    // seed,
  }


  let data
  let error: string | undefined
  let content: string | undefined | null

  const promptHash = md5(JSON.stringify(input))
  const randomSeed = seed ? false : true

  if (!seed) {
    seed = variations ? Math.round(Math.random() * variations) : 1
    input.seed = seed
  }

  const hash = md5(JSON.stringify(input))

  let [
    doc, 
    // docs
  ] = await Promise.all([
    db.collection('completions').findOneAndUpdate({ hash }, { $set: { hash, promptHash, seed, randomSeed, props, input, ...headers(), requestedAt } }, { upsert: true, returnDocument: 'before', writeConcern: { w: 1 }}),
    // randomSeed ? db.collection('completions').find({ promptHash }).project({ data: 1, content: 1, list: 1 }).limit(10).toArray() : undefined
  ])

  // TODO: Figure out how to shuffle and return a random item from the array if a seed wasn't specified, but make sure the completion actually still completes
  // Can this be done by passing another suspense component back?

  const readCompletedAt = new Date()
  const readLatency = readCompletedAt.getTime() - requestedAt.getTime()

  if (!doc?.completion) {
    const completion = await openai.chat.completions.create(input)

    const updatedAt = new Date()
    const completionLatency = updatedAt.getTime() - readCompletedAt.getTime()
    const latency = updatedAt.getTime() - requestedAt.getTime()


    const { message } = completion.choices?.[0]
    // prompt.messages.push(message)
    content = message.content
    const { tool_calls } = message
    let rawJson = tool_calls ? tool_calls[0].function.arguments : content
    if (rawJson) {
      try {
        data = JSON.parse(rawJson)
      } catch (err: any) {
        error = err.message
      }
    } 
    const gpt4 = input.model.includes('gpt-4')
    const cost = completion.usage ? 
      Math.round(
        (gpt4
          ? completion.usage.prompt_tokens * 0.003 + completion.usage.completion_tokens * 0.006
          : completion.usage.prompt_tokens * 0.00015 + completion.usage.completion_tokens * 0.0002) * 100000
      ) / 100000 : undefined

    doc = await db.collection('completions').findOneAndUpdate({ hash }, { $set: { hash, props, data, content, prompt, completion, cost, requestedAt, createdAt, readCompletedAt, readLatency, completionLatency, latency, updatedAt,  } }, { upsert: true, returnDocument: 'after', writeConcern: { w: 1 }})
  }

  console.log(data, content)

  const componentProps = { ...data, data, content, seed }

  if (props.children) return (
    React.cloneElement(props.children as React.ReactElement, componentProps)
  )

  if (props.component && typeof props.component === 'function') return <props.component {...componentProps}/>
  if (props.component) return React.cloneElement(props.component as React.ReactElement, componentProps)


  return typeof data === 'object'
      ? <Code lang='yaml' className={className}>{yaml.dump(data, { lineWidth: -1 })}</Code> 
      : <Markdown className={cn(className, 'prose mx-auto')}>{data ?? doc?.content}</Markdown>

  // return (
  //   <div className='max-w-7xl mx-auto'>
  //     <Markdown className='prose prose-lg p-4'>{doc?.content}</Markdown>
  //     <Code lang='json'>{JSON.stringify(doc, null, 2)}</Code>
  //   </div>
  // )
}



