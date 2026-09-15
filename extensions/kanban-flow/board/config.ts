import { isAbsolute } from "node:path";
import { parseModelSelector, type Config } from "./schemas.ts";

const AGENT_NAMES = new Set([
  "requirements-producer", "requirements-checker", "design-producer", "design-checker", "split-decider", "implementer", "reviewer", "ship-producer", "ship-checker",
]);
const SKILL_SEGMENT = /^[^\\/]+$/;

function fail(message: string): never { throw new Error(`Invalid kanban config: ${message}`); }
function singleLine(value: string): boolean { return value.length > 0 && !/[\u0000\r\n]/.test(value); }

/** Enforce cross-field config constraints that the structural schema cannot express. */
export function validateConfigSemantics(config: Config): void {
  if (config.lock.heartbeat_seconds * 3 >= config.lock.ttl_seconds) fail("lock heartbeat must be less than one third of TTL");
  if (new Set(config.review.lenses).size !== config.review.lenses.length) fail("review lenses must be unique");
  const overrides = Object.keys(config.agent_models.overrides);
  if (overrides.some((name) => !AGENT_NAMES.has(name))) fail(`unknown agent model override ${overrides.find((name) => !AGENT_NAMES.has(name))}`);
  for (const selector of Object.values(config.agent_models.overrides)) {
    if (selector !== undefined) {
      try { parseModelSelector(selector); } catch (error) { fail(error instanceof Error ? error.message : "model selector is invalid"); }
    }
  }
  for (const [name, command] of Object.entries(config.project_commands)) {
    if (!Array.isArray(command) || command.length < 1 || command.length > 64) fail(`${name} command must be a non-empty argv array`);
    if (command.some((argument) => !singleLine(argument) || argument.length > 4096)) fail(`${name} command contains an invalid argument`);
  }
  for (const skillPath of config.resources.broad_policy_allowed_skills) {
    if (isAbsolute(skillPath) || skillPath.includes("\\") || skillPath.split("/").some((segment) => !SKILL_SEGMENT.test(segment) || segment === "." || segment === "..")) fail(`skill path is not repository-relative: ${skillPath}`);
  }
  if ([...config.resources.broad_policy_allowed_skills].sort().some((path, index) => path !== config.resources.broad_policy_allowed_skills[index])) fail("allowed skill paths must be lexically sorted");
}
