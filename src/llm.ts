import {
  BaseChatModel,
  SimpleChatModel,
  BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import { BaseMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { execa } from "execa";

export interface ChatAntigravityCLIFields extends BaseChatModelParams {
  modelName?: string;
  dangerouslySkipPermissions?: boolean;
  boundTools?: any[];
}

export class ChatAntigravityCLI extends SimpleChatModel {
  modelName?: string;
  dangerouslySkipPermissions: boolean;
  boundTools?: any[];

  constructor(fields?: ChatAntigravityCLIFields) {
    super(fields ?? {});
    this.modelName = fields?.modelName || "claude-sonnet-4.5";
    this.dangerouslySkipPermissions =
      fields?.dangerouslySkipPermissions ?? true;
    this.boundTools = fields?.boundTools || [];
  }

  _llmType(): string {
    return "antigravity_cli";
  }

  override bindTools(tools: any[], _options?: any): BaseChatModel {
    return new ChatAntigravityCLI({
      modelName: this.modelName!,
      dangerouslySkipPermissions: this.dangerouslySkipPermissions,
      boundTools: tools,
    });
  }

  async _call(messages: BaseMessage[]): Promise<string> {
    let prompt = messages
      .map((m) => {
        if (typeof m.content === "string") return m.content;
        return JSON.stringify(m.content);
      })
      .join("\n\n");

    if (this.boundTools && this.boundTools.length > 0) {
      const toolDescriptions = this.boundTools
        .map((t: any) => `- ${t.name || t.title}: ${t.description || ""}`)
        .join("\n");
      prompt += `\n\n[AVAILABLE TOOLS IN LOCAL WORKSPACE]:\n${toolDescriptions}`;
    }

    const isWindows = process.platform === "win32";
    const cliPrompt = isWindows
      ? prompt
          .replace(/[\r\n]+/g, " ")
          .trim()
          .slice(0, 2500)
      : prompt;

    const cwd = process.cwd();
    const args = ["--add-dir", cwd, "-p", cliPrompt];
    if (this.dangerouslySkipPermissions) {
      args.push("--dangerously-skip-permissions");
    }
    if (this.modelName) {
      args.push("--model", this.modelName);
    }

    try {
      const { stdout } = await execa("agy", args, {
        cwd,
        env: process.env,
      });
      return stdout.trim();
    } catch (err: any) {
      if (err.code === "ENOENT" || err.message?.includes("ENOENT")) {
        throw new Error(
          `Antigravity CLI ('agy') was not found in your system PATH.\n` +
            `👉 Option 1: Add 'agy' executable to your Windows PATH environment variable.\n` +
            `👉 Option 2: Use a cloud provider by running with '--provider gemini' or '--provider anthropic'.`,
        );
      }
      const detail = err.stderr || err.stdout || err.message;
      throw new Error(`Antigravity CLI (agy) execution failed: ${detail}`);
    }
  }
}

export interface LlmOptions {
  provider?: string | undefined;
  model?: string | undefined;
  apiKey?: string | undefined;
}

export function getLlm(options: LlmOptions = {}): BaseChatModel {
  const provider = (
    options.provider ||
    process.env.LLM_PROVIDER ||
    "anthropic"
  ).toLowerCase();

  switch (provider) {
    case "antigravity":
    case "antigravity-cli":
    case "gemini-cli":
    case "agy": {
      return new ChatAntigravityCLI({
        modelName:
          options.model || process.env.ANTIGRAVITY_MODEL || "gemini-2.5-flash",
        dangerouslySkipPermissions: true,
      });
    }

    case "gemini":
    case "google": {
      const model =
        options.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
      const apiKey =
        options.apiKey ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY;

      const config: { model: string; temperature: number; apiKey?: string } = {
        model,
        temperature: 0,
      };
      if (apiKey) config.apiKey = apiKey;

      return new ChatGoogleGenerativeAI(config);
    }

    case "openrouter": {
      const modelName =
        options.model ||
        process.env.OPENROUTER_MODEL ||
        "anthropic/claude-3.5-sonnet";
      const apiKey =
        options.apiKey ||
        process.env.OPENROUTER_API_KEY ||
        process.env.OPENAI_API_KEY;

      const config: {
        modelName: string;
        temperature: number;
        apiKey?: string;
        configuration: { baseURL: string };
      } = {
        modelName,
        temperature: 0,
        configuration: {
          baseURL: "https://openrouter.ai/api/v1",
        },
      };
      if (apiKey) config.apiKey = apiKey;

      return new ChatOpenAI(config);
    }

    case "openai": {
      const modelName = options.model || process.env.OPENAI_MODEL || "gpt-4o";
      const apiKey = options.apiKey || process.env.OPENAI_API_KEY;

      const config: {
        modelName: string;
        temperature: number;
        apiKey?: string;
      } = {
        modelName,
        temperature: 0,
      };
      if (apiKey) config.apiKey = apiKey;

      return new ChatOpenAI(config);
    }

    case "anthropic":
    default: {
      const model =
        options.model ||
        process.env.ANTHROPIC_MODEL ||
        "claude-3-5-sonnet-20241022";
      const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;

      const config: { model: string; temperature: number; apiKey?: string } = {
        model,
        temperature: 0,
      };
      if (apiKey) config.apiKey = apiKey;

      return new ChatAnthropic(config);
    }
  }
}
