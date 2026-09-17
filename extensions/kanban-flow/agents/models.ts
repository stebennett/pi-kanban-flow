import { parseModelSelector, type ThinkingLevel } from "../board/schemas.ts";

export interface ParentModel { provider: string; id: string; thinking: ThinkingLevel }
export interface ResolvedModel { provider: string; id: string; thinking: ThinkingLevel; inherited: boolean }
export interface ModelCapability { provider: string; id: string; authenticated: boolean; supportsTools: boolean }
export interface ModelResolver { resolve(provider: string, id: string): Promise<ModelCapability | null> }

export async function resolveDispatchModel(parent: ParentModel, agentName: string, overrides: Readonly<Record<string, string | undefined>>, resolver: ModelResolver): Promise<ResolvedModel> {
  const selector = overrides[agentName];
  if (!selector) return { ...parent, inherited: true };
  const parsed = parseModelSelector(selector);
  const model = await resolver.resolve(parsed.provider, parsed.model);
  if (!model) throw new Error(`Configured model is unavailable for ${agentName}: ${parsed.provider}/${parsed.model}`);
  if (!model.authenticated) throw new Error(`Configured model is not authenticated for ${agentName}`);
  if (!model.supportsTools) throw new Error(`Configured model does not support custom tools for ${agentName}`);
  return { provider: model.provider, id: model.id, thinking: parsed.thinking ?? parent.thinking, inherited: false };
}
